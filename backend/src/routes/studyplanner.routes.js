/**
 * AI Study Planner.
 *
 * The student hands us a subject, an exam date and their module material
 * (photos and/or PDFs). PDFs are text-extracted locally with pdf-parse;
 * photos are read by a Groq multimodal model in batches (Groq caps images
 * per request and 4 MB of base64 per call), and the combined digest is
 * turned into a day-by-day revision plan with the regular Groq chat model.
 */

import { Router } from 'express'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'
import { requireAuth } from '../middleware/auth.js'
import { extractJson, groqChat, hasGroq, modelConfig } from '../utils/llm.js'

const MAX_FILES = 10
// PDFs are text-extracted locally so they can match the LMS's 20 MB budget;
// module photos are downscaled client-side to well under this.
const MAX_FILE_BYTES = 20 * 1024 * 1024
const DAY_MS = 24 * 60 * 60 * 1000
// Prompt tokens are charged per request, so the digest is kept tight:
// compressed (repeated page furniture removed) and sampled across the whole
// document rather than spending the budget on the first pages alone.
const PDF_CHAR_BUDGET = 9000 // per file
const PDF_TEXT_BUDGET = 15000 // all PDFs combined
const IMAGE_TEXT_BUDGET = 9000 // vision digest sent to the planner
const CONTENT_BUDGET = 20000 // everything the planner model reads

const PDF_MIME = new Set(['application/pdf', 'application/x-pdf'])
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

const moduleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
  fileFilter(_req, file, cb) {
    const isPdf = PDF_MIME.has(file.mimetype) || /\.pdf$/i.test(file.originalname || '')
    const isImage = IMAGE_MIME.has(file.mimetype)
    if (!isPdf && !isImage) return cb(new Error('Only module images (JPG, PNG, WebP) or PDFs are allowed.'))
    cb(null, true)
  },
})

/** multer errors surface as 4xx, not 500 — mirrors acceptPdf in utils/uploads.js. */
function acceptModules(req, res, next) {
  moduleUpload.array('modules', MAX_FILES)(req, res, (err) => {
    if (!err) return next()
    const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `"${err.field || 'file'}" is larger than the ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Attach at most ${MAX_FILES} files.`
          : err.message || 'Upload rejected.'
    next(Object.assign(err, { status: code, message }))
  })
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}

/** "YYYY-MM-DD" -> local midnight Date, or null when malformed. */
function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Date -> "YYYY-MM-DD" in the server's local timezone (toISOString is UTC
 *  and shifts to the previous day on servers east of Greenwich). */
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** PDF extractors emit stray control characters that break JSON strings. */
function sanitizeText(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
}

/**
 * Squeezes extracted text before it is paid for as prompt tokens: collapses
 * runs of whitespace, drops bare page numbers and — because page headers,
 * footers and watermarks repeat verbatim on every page of a scan — any long
 * line already seen. Short headings are allowed to repeat (sections do).
 */
function compressDigest(text) {
  const seen = new Set()
  const out = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t]+/g, ' ').trim()
    if (!line) continue
    if (/^\d{1,4}$/.test(line)) continue // page numbers
    if (/^page \d+( of \d+)?$/i.test(line)) continue
    if (line.length > 24) {
      const key = line.toLowerCase()
      if (seen.has(key)) continue // header/footer repeated per page
      seen.add(key)
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Spreads a budget across the whole document instead of slicing the head:
 * a textbook's first pages are its preface, while the units and end-of-chapter
 * questions — what the planner actually needs — sit in the middle and back.
 */
function spreadSlice(text, budget) {
  if (text.length <= budget) return text
  const head = Math.round(budget * 0.3)
  const rest = text.slice(head)
  const slots = 3
  const per = Math.floor((budget - head) / slots)
  const parts = [text.slice(0, head)]
  let prevEnd = 0
  for (let i = 0; i < slots; i += 1) {
    // Targets: start, middle, end of the remainder — never overlapping the
    // window already taken, so no text is paid for twice.
    const target = Math.floor((rest.length - per) * (i / (slots - 1)))
    const start = Math.min(Math.max(target, prevEnd), Math.max(prevEnd, rest.length - per))
    const end = Math.min(start + per, rest.length)
    if (start >= end) break
    parts.push(rest.slice(start, end))
    prevEnd = end
  }
  return parts.join('\n…\n')
}

async function extractPdfText(buffer) {
  const parser = new PDFParse(new Uint8Array(buffer))
  await parser.load()
  try {
    const result = await parser.getText()
    return (result.text || '').trim()
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const VISION_SYSTEM = [
  'You read photos/scan pages of academic study modules and turn them into faithful text.',
  'Transcribe unit and chapter names, every topic and subtopic, formulas, and any listed',
  'university exam questions (long answer, short answer, numericals, diagrams).',
  'Keep the original numbering and order; skip page numbers, headers and footers.',
  'Do not invent content that is not visible in the images.',
  'Respond with JSON only: {"modulesText": "<the full structured digest as plain text>"}',
].join(' ')

const PLAN_SYSTEM = [
  'You are an academic study-planner building day-by-day exam revision timetables from a module digest.',
  'Return one JSON object only:',
  '{"summary": string, "entries": [{"label": string, "date": "YYYY-MM-DD", "hours": number,',
  ' "focus": string, "topics": [string], "importantQuestions": [string], "tip": string}], "finalTips": [string]}',
  'Rules:',
  '- Plan starts TODAY and ends the day before the exam; the last entry is full revision and light recall.',
  '- One entry per calendar day, labelled "Day 1", "Day 2", ...; "date" is that real date (YYYY-MM-DD).',
  '- If more than 35 days remain, group the early stretch into weekly blocks ("Days 1-7", omit "date"),',
  '  then go day-by-day for the final 14 days.',
  '- "hours": realistic daily load 1-8, rising toward the exam, one lighter review day per week; a number.',
  '- "topics": syllabus topics from the digest in learning order; 2-4 per daily entry, up to 6 per weekly block.',
  '- "importantQuestions": exam-style questions from the digest (definitions, derivations, numericals,',
  '  long/short answer, diagrams); 2-3 per daily entry, up to 4 per weekly block; infer likely ones if the digest has none.',
  '- Keep every string terse: "focus" <= 8 words, each topic <= 8 words, each question <= 16 words,',
  '  "tip" <= 14 words (omit the field when it adds nothing), "summary" <= 45 words, "finalTips": 3 x <= 16 words.',
  '- Ground everything in the digest; if it is thin, use the standard curriculum and say so in "summary".',
].join(' ')

function toArray(value, max) {
  if (!Array.isArray(value)) return []
  return value.filter((v) => typeof v === 'string' && v.trim()).slice(0, max).map((v) => v.trim())
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Groq's 429 body says "Please try again in 14.7s" — honour it. */
function retryAfterMs(message) {
  const m = /try again in ([\d.]+)s/i.exec(String(message || ''))
  return m ? Math.ceil(Number(m[1]) * 1000) + 1000 : 20000
}

function isRateLimit(err) {
  return err?.status === 429 || /rate.?limit/i.test(String(err?.message || ''))
}

function isModelUnavailable(err) {
  return /model_not_found|does not exist|not have access/i.test(String(err?.message || ''))
}

/**
 * Groq caps vision requests by model (3 images for qwen3.8, 5 for llama-4)
 * and at 4 MB of base64 per call, so the module photos go through in small
 * batches and the digests are concatenated. Which vision models exist varies
 * by Groq account/tier, so we walk a candidate list until one is available.
 */
const VISION_CANDIDATES = [
  ...new Set([
    modelConfig.groqVisionModel,
    'qwen/qwen3.8-27b',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ]),
]

/** One vision pass: constrained JSON first, then plain text + salvage if the
 *  model's json output gets rejected (e.g. truncated by thinking tokens). */
async function visionDigestOnce(model, images, user) {
  const onUsage = (u) => console.log(`[study-planner] vision tokens: in=${u.prompt_tokens} out=${u.completion_tokens}`)
  try {
    const out = await groqChat({ model, system: VISION_SYSTEM, user, images, json: true, temperature: 0.1, maxTokens: 8000, onUsage })
    return out && typeof out.modulesText === 'string' ? out.modulesText : ''
  } catch (err) {
    if (!/json_validate_failed/.test(err.message)) throw err
    const out = await groqChat({ model, system: VISION_SYSTEM, user, images, json: false, temperature: 0.1, maxTokens: 9000, onUsage })
    const parsed = extractJson(String(out))
    return parsed && typeof parsed.modulesText === 'string' ? parsed.modulesText : ''
  }
}

async function digestModuleImages(files) {
  const batches = []
  let current = []
  let currentChars = 0
  const MAX_CHARS_PER_BATCH = 3 * 1024 * 1024 // ~3 MB of base64, leaves room for the prompt
  const MAX_IMAGES_PER_BATCH = 3

  for (const file of files) {
    const url = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
    // A single photo already over Groq's 4 MB base64 cap cannot be sent at
    // all — drop it with a warning instead of failing the whole request.
    if (url.length > MAX_CHARS_PER_BATCH) {
      console.warn('[study-planner] skipping oversized image:', file.originalname)
      continue
    }
    if (current.length && (current.length >= MAX_IMAGES_PER_BATCH || currentChars + url.length > MAX_CHARS_PER_BATCH)) {
      batches.push(current)
      current = []
      currentChars = 0
    }
    current.push(url)
    currentChars += url.length
  }
  if (current.length) batches.push(current)

  const digests = []
  let modelIdx = 0
  let lastErr = null

  for (let i = 0; i < batches.length; i += 1) {
    let text = ''
    let rateRetries = 0
    const prompt =
      batches.length > 1
        ? `Batch ${i + 1} of ${batches.length} of the module photos for this subject. Extract everything readable.`
        : 'Extract everything readable from these module pages.'

    while (!text && modelIdx < VISION_CANDIDATES.length) {
      try {
        text = await visionDigestOnce(VISION_CANDIDATES[modelIdx], batches[i], prompt)
      } catch (err) {
        lastErr = err
        // A 429 means the model works and we are simply throttled — wait out
        // Groq's stated window and retry the same model instead of walking on.
        if (isRateLimit(err) && rateRetries < 2) {
          rateRetries += 1
          const wait = retryAfterMs(err.message)
          console.warn(`[study-planner] vision rate limited — waiting ${wait}ms`)
          await sleep(wait)
          continue
        }
        if (isModelUnavailable(err)) {
          console.warn(`[study-planner] vision model ${VISION_CANDIDATES[modelIdx]} unavailable:`, err.message)
          modelIdx += 1
          continue
        }
        throw err
      }
    }
    if (!text) throw lastErr || new Error('No vision model available.')
    digests.push(text)
  }
  return sanitizeText(digests.filter(Boolean).join('\n\n'))
}

/**
 * Two-attempt plan generation.
 *
 * gpt-oss spends part of max_tokens on hidden reasoning, so a long plan can
 * hit the cap mid-object and Groq's json mode then rejects the truncated
 * output (json_validate_failed). Attempt 1 uses constrained JSON mode with
 * low reasoning effort; attempt 2 drops the constraint and salvages the JSON
 * from plain text with extra token headroom.
 */
async function generatePlanJson(user) {
  const attempts = [
    { json: true, maxTokens: 14000 },
    { json: false, maxTokens: 16000 },
  ]
  let lastErr = null
  let rateWaited = false
  let i = 0

  while (i < attempts.length) {
    const attempt = attempts[i]
    try {
      const out = await groqChat({
        system: PLAN_SYSTEM,
        user,
        json: attempt.json,
        temperature: 0.4,
        maxTokens: attempt.maxTokens,
        reasoningEffort: 'low',
        model: modelConfig.groqModel,
        onUsage: (u) =>
          console.log(
            `[study-planner] plan tokens: in=${u.prompt_tokens} out=${u.completion_tokens}` +
              ` (reasoning=${u.completion_tokens_details?.reasoning_tokens ?? '?'})`,
          ),
      })
      const parsed = attempt.json ? out : extractJson(String(out))
      // A payload without usable entries (occasional model hiccup) is treated
      // as a failed attempt so the ladder retries instead of 502ing the user.
      const usable = Array.isArray(parsed?.entries)
        ? parsed.entries.filter((e) => e && typeof e === 'object')
        : []
      if (!usable.length) throw new Error('Plan payload contained no entries')
      return parsed
    } catch (err) {
      lastErr = err
      console.warn(`[study-planner] plan attempt (json=${attempt.json}) failed:`, err.message)
      // One patient wait on a token-window limit before giving up or
      // switching strategies — Groq states the window in its error body.
      if (isRateLimit(err) && !rateWaited) {
        rateWaited = true
        const wait = retryAfterMs(err.message)
        console.warn(`[study-planner] plan rate limited — waiting ${wait}ms`)
        await sleep(wait)
        continue // same attempt index — retry this strategy
      }
      const retryable =
        !err.status || err.status === 429 || err.status >= 500 || /json_validate_failed/.test(err.message)
      if (!retryable) break
      i += 1
    }
  }

  throw Object.assign(
    new Error('The study planner could not build a valid plan — please try again.'),
    { status: lastErr?.status && lastErr.status < 500 ? lastErr.status : 502 },
  )
}

/** Defensive cleanup of whatever the model returns so the client gets a stable shape. */
function normalizePlan(raw, { subject, examDate, daysUntilExam, minDate, maxDate }) {
  const entries = Array.isArray(raw?.entries)
    ? raw.entries.filter((e) => e && typeof e === 'object').slice(0, 80)
    : []

  const clean = entries.map((e, i) => {
    const date = typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e.date : undefined
    // Dates outside the study window (model miscounts) are dropped — the
    // label still identifies the day.
    const inWindow = date && date >= minDate && date <= maxDate
    const hours = Math.min(12, Math.max(1, Math.round(Number(e.hours) || 2)))
    return {
      label: String(e.label || `Day ${i + 1}`).slice(0, 80),
      date: inWindow ? date : undefined,
      hours,
      focus: String(e.focus || '').slice(0, 220),
      topics: toArray(e.topics, 10).map((t) => t.slice(0, 180)),
      importantQuestions: toArray(e.importantQuestions, 10).map((q) => q.slice(0, 300)),
      tip: e.tip ? String(e.tip).slice(0, 260) : undefined,
    }
  })

  if (!clean.length) {
    console.warn('[study-planner] unusable plan payload:', JSON.stringify(raw ?? null).slice(0, 800))
    throw Object.assign(new Error('The planner returned an empty plan — please try again.'), { status: 502 })
  }

  return {
    subject,
    examDate,
    daysUntilExam,
    totalHours: clean.reduce((sum, e) => sum + e.hours, 0),
    summary: String(raw?.summary || '').slice(0, 700),
    entries: clean,
    finalTips: toArray(raw?.finalTips, 8).map((t) => t.slice(0, 260)),
  }
}

export const studyPlannerRoutes = Router()

studyPlannerRoutes.use(requireAuth)

studyPlannerRoutes.post('/generate', acceptModules, async (req, res, next) => {
  try {
    if (!hasGroq()) {
      return res.status(503).json({ error: 'AI is not configured on this server.' })
    }

    const subject = String(req.body?.subject || '').trim().slice(0, 120)
    if (!subject) throw badRequest('Subject is required.')

    const exam = parseDate(req.body?.examDate)
    if (!exam) throw badRequest('Exam date must be in YYYY-MM-DD format.')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (exam.getTime() < today.getTime()) throw badRequest('The exam date is in the past.')
    const todayStr = isoLocal(today)
    const dayBeforeExam = isoLocal(new Date(exam.getTime() - DAY_MS))
    const daysUntilExam = Math.max(1, Math.round((exam.getTime() - today.getTime()) / DAY_MS))
    if (daysUntilExam > 365) throw badRequest('That exam date is more than a year away.')

    const files = Array.isArray(req.files) ? req.files : []
    if (!files.length) throw badRequest('Attach at least one module image or PDF.')

    // 1. Local PDF text extraction.
    const pdfParts = []
    const images = []
    for (const file of files) {
      const isPdf = PDF_MIME.has(file.mimetype) || /\.pdf$/i.test(file.originalname || '')
      if (!isPdf) {
        images.push(file)
        continue
      }
      try {
        const text = await extractPdfText(file.buffer)
        if (text) pdfParts.push(spreadSlice(compressDigest(sanitizeText(text)), PDF_CHAR_BUDGET))
      } catch (err) {
        console.warn('[study-planner] could not read PDF:', err.message)
      }
    }
    const pdfText = spreadSlice(pdfParts.join('\n\n'), PDF_TEXT_BUDGET)

    // 2. Vision pass over the module photos. If it fails but we already have
    //    PDF text, carry on with that alone rather than losing the request.
    let imageText = ''
    if (images.length) {
      try {
        imageText = spreadSlice(compressDigest(await digestModuleImages(images)), IMAGE_TEXT_BUDGET)
      } catch (err) {
        console.warn('[study-planner] vision digest failed:', err.message)
        if (!pdfText) {
          throw Object.assign(
            new Error(
              isRateLimit(err)
                ? 'Groq rate limit reached — wait about a minute and try again.'
                : 'Could not read the attached module images — try clearer photos.',
            ),
            { status: 502 },
          )
        }
      }
    }

    const content = [
      pdfText && `## Text extracted from module PDFs\n${pdfText}`,
      imageText && `## Content read from module images\n${imageText}`,
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, CONTENT_BUDGET)

    if (!content) {
      throw badRequest('No readable content in the attached files — add clearer module photos or a text-based PDF.')
    }

    // 3. Build the plan.
    const user = [
      `Subject: ${subject}`,
      `Exam date: ${req.body.examDate} (${daysUntilExam} day${daysUntilExam === 1 ? '' : 's'} from today)`,
      `Today: ${todayStr} — this is Day 1, no entry may be dated before it`,
      `Files supplied: ${pdfParts.length} PDF(s), ${images.length} image(s)`,
      '',
      content,
    ].join('\n')

    const raw = await generatePlanJson(user)

    res.json(
      normalizePlan(raw, {
        subject,
        examDate: req.body.examDate,
        daysUntilExam,
        minDate: todayStr,
        maxDate: dayBeforeExam,
      }),
    )
  } catch (err) {
    next(err)
  }
})
