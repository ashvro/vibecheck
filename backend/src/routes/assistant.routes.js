import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../prisma.js'
import {
  groqChat,
  groqChatStream,
  groqTranscribe,
  hfEmotionAnalysis,
  hasGroq,
  modelConfig,
} from '../utils/llm.js'
import { ttsProvider, synthesizeSpeech, isAbortError } from '../utils/tts.js'
import { requireAuth } from '../middleware/auth.js'
import { resolveEvidence, detectSupportCategory, formatEvidence, knowledgeStatus } from '../rag.js'
import { buildUserContext } from '../userContext.js'

export const assistantRoutes = Router()

const INTENTS = ['general', 'career', 'academics', 'mental_health']
const RISK_LEVELS = ['low', 'moderate', 'high', 'critical']

const CRITICAL_PATTERNS = [
  'suicide', 'suicidal', 'kill myself', 'kill me', 'end my life', 'end it all',
  'hurt myself', 'harm myself', 'self harm', 'self-harm', 'no reason to live',
  "don't want to live", 'do not want to live', 'take my own life', 'want to die',
  'plan to hurt', 'want to kill',
]

const HIGH_PATTERNS = [
  "can't go on", 'cannot go on', 'give up', 'no way out', 'want to disappear',
  'i want to end', 'better off dead', 'wish i was dead',
]

function hardRiskCheck(text) {
  const lower = text.toLowerCase()
  if (CRITICAL_PATTERNS.some((p) => lower.includes(p))) return 'critical'
  if (HIGH_PATTERNS.some((p) => lower.includes(p))) return 'high'
  return null
}

function userIdOf(req) {
  return req.user?.id ?? null
}

/* ───────────────────────── sessions ───────────────────────── */

async function resolveSession(req, sessionId) {
  const where = { userId: userIdOf(req) }
  if (sessionId) {
    const found = await prisma.chatSession.findFirst({ where: { id: Number(sessionId), userId: where.userId } })
    if (found) return found
  }
  return prisma.chatSession.findFirst({ where, orderBy: { updatedAt: 'desc' } })
}

async function ensureSession(req, sessionId) {
  const existing = await resolveSession(req, sessionId)
  if (existing) return existing
  return prisma.chatSession.create({ data: { userId: userIdOf(req), title: 'New chat' } })
}

async function recomputeSessionSentiment(sessionId) {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, role: 'user', intent: 'mental_health', score: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { score: true },
  })
  if (!rows.length) return null

  const n = rows.length
  let weightedSum = 0
  let weightSum = 0
  rows.forEach((row, i) => {
    const w = Math.pow(0.65, n - 1 - i)
    weightedSum += row.score * w
    weightSum += w
  })
  return Math.round((weightedSum / weightSum) * 100) / 100
}

assistantRoutes.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: userIdOf(req) },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true } },
      },
    })
    res.json(
      sessions.map((s) => ({
        id: s.id,
        title: s.title,
        intent: s.intent,
        sentimentScore: s.sentimentScore,
        updatedAt: s.updatedAt,
        messageCount: s._count.messages,
        preview: s.messages[0]?.content ?? null,
      })),
    )
  } catch (err) {
    next(err)
  }
})

assistantRoutes.post('/sessions', async (req, res, next) => {
  try {
    const session = await prisma.chatSession.create({ data: { userId: userIdOf(req), title: 'New chat' } })
    res.status(201).json(session)
  } catch (err) {
    next(err)
  }
})

assistantRoutes.get('/messages', async (req, res, next) => {
  try {
    const sessionId = req.query.sessionId ? Number(req.query.sessionId) : null
    const where = { userId: userIdOf(req) }
    if (sessionId) {
      where.sessionId = sessionId
    } else {
      const latest = await prisma.chatSession.findFirst({
        where: { userId: userIdOf(req) },
        orderBy: { updatedAt: 'desc' },
      })
      if (latest) where.sessionId = latest.id
    }
    const messages = await prisma.chatMessage.findMany({ where, orderBy: { createdAt: 'asc' } })
    res.json(messages)
  } catch (err) {
    next(err)
  }
})

assistantRoutes.delete('/sessions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const session = await prisma.chatSession.findFirst({ where: { id, userId: userIdOf(req) } })
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' })
    }
    await prisma.chatMessage.deleteMany({ where: { sessionId: id } })
    await prisma.chatSession.delete({ where: { id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

assistantRoutes.get('/knowledge-status', async (req, res, next) => {
  try {
    res.json(await knowledgeStatus())
  } catch (err) {
    next(err)
  }
})

/* ────────────────────── pipeline stages ────────────────────── */

async function analyzeMessage(text, { signal } = {}) {
  const system = `You are the analysis stage of a student support assistant. Analyse the student's latest message and return BOTH its intent and its safety risk in a single pass.

INTENT (exactly one):
- general: casual conversation, greetings, small talk, open-ended questions about the assistant.
- career: placements, jobs, resumes, skills needed for roles, career roadmaps, internships.
- academics: subjects, concepts, assignments, study plans, exams for coursework, doubts about a topic.
- mental_health: stress, anxiety, mood, burnout, hopelessness, sleep, loneliness, emotions, well-being, overwhelm.

RISK LEVEL (assess ONLY for immediate safety concerns, independently of tone or negative emotion):
- low: negative emotion, stress, or sadness alone.
- moderate: significant distress, helplessness, or being unable to cope, but NO implicit or explicit self-harm content.
- high: explicit hopelessness, not wanting to continue, or clear self-harm thoughts without a stated plan.
- critical: explicit suicidal ideation, a stated plan, or an intention to harm themselves.

Do not diagnose. Do not judge. Respond ONLY with JSON:
{"intent": "<general|career|academics|mental_health>", "riskLevel": "<low|moderate|high|critical>", "reason": "<one short sentence on the risk>"}`

  const data = await groqChat({
    system,
    user: `Student message: ${text}`,
    json: true,
    temperature: 0,
    maxTokens: 250,
    model: modelConfig.groqFastModel,
    signal,
  })
  return {
    intent: INTENTS.includes(data?.intent) ? data.intent : 'general',
    riskLevel: RISK_LEVELS.includes(data?.riskLevel) ? data.riskLevel : 'low',
    reason: typeof data?.reason === 'string' ? data.reason.slice(0, 200) : '',
  }
}

function safetyResponse(riskLevel) {
  const base =
    "I'm really glad you reached out and told me how you're feeling. What you're going through matters, and you don't have to carry it alone. I'm not a therapist and I can't give medical advice, but I can be honest with you: these feelings deserve real support from a trusted person and from a professional.\n\n"

  if (riskLevel === 'critical') {
    return `${base}Right now, because there is an immediate risk to your safety, please don't wait. If you are in immediate danger or have a plan to harm yourself, call your local emergency number now or go to the nearest emergency room. Keep a trusted person close by and let them know how you're doing.\n\nThis moment does not define you, and you are not a burden. I can stay here with you and help you list crisis lines or support numbers for your region if that helps. Do you want me to do that?`
  }

  return `${base}Please reach out today to someone you trust, and consider connecting with your campus counselor or a crisis line — they are trained for exactly this and will listen without judgment. You deserve a safe space to unpack this. Would you like me to share crisis or counseling contact resources?`
}

/**
 * Spoken-length safety replies. Same safety content as safetyResponse() —
 * acknowledgement, immediate action, don't stay alone, offer of help — but
 * short enough to say out loud without losing any of it.
 */
function safetyResponseVoice(riskLevel) {
  if (riskLevel === 'critical') {
    return "I'm really glad you told me. Please call your local emergency number right now, or go to the nearest emergency room, and stay with someone you trust until you feel safer. I'm staying right here with you."
  }
  return "I'm really glad you reached out. Please talk to someone you trust today, and consider your campus counselor or a crisis line, they're trained for exactly this. Would you like me to find those numbers for you?"
}

function cleanPara(value) {
  return String(value)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-•*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeReplyText(raw) {
  return String(raw)
    .split(/\n{2,}/)
    .map(cleanPara)
    .filter(Boolean)
    .join('\n\n')
}

async function generateReply(context, { onDelta, signal } = {}) {
  const {
    intent, text, history, sentiment, emotion, riskLevel, riskReason,
    category, evidence, evidenceUsed, correction, userContext, userDataQ, voice,
  } = context

  const system = `You are "VibeCheck", a warm, encouraging student support assistant at a college. Your job: be genuinely helpful across academics, career, and well-being, and to be responsible with mental-health topics.

DETECTED CONTEXT:
- Intent: ${intent}
- Risk level (independent assessment): ${riskLevel}${riskReason ? ` — ${riskReason}` : ''}
${sentiment != null ? `- Mental-health sentiment for this message (0 = emotionally drained, 1 = flourishing): ${sentiment}${emotion ? ` (emotion: ${emotion})` : ''}` : ''}
${category ? `- Mental-health support area: ${category}` : ''}
${correction ? `- NOTE: a previous reply failed this check: ${correction}. Fix that issue now.` : ''}

${userContext ? `USER CONTEXT (real, current data from this student's account — answer their personal questions directly and accurately from this only, never invent numbers. If something is missing from it, say it is not recorded yet. Do not repeat raw numbers unless asked.):\n${userContext.summary}${userDataQ ? `\nThis student JUST ASKED about their own account data shown above. Answer their question using ONLY this context — quote the real figures (courses, IA1/IA2, average, attendance %), recent mood check-ins, clubs, community activity, and risk when relevant. If a field they asked about is absent, say it is not recorded yet. Do NOT drift into the previous conversation topic or unrelated examples.` : ''}\n` : ''}

${voice ? `
VOICE MODE — this reply is SPOKEN ALOUD, not read on screen. These rules override the paragraph and length rules above:
- One to three short sentences. Hard limit: roughly 35 words total. Two sentences is usually right.
- Write for the ear. NO markdown, NO lists, NO headings, NO bullet or numbered lists, NO URLs, NO emoji, NO parentheses, NO asterisks, NO em dashes.
- Only the words you would actually say. No stage directions, no labels, no "Answer:", no formatting.
- Contractions are preferred: "you're", "I'll", "that's". Spoken, not written.
- Lead immediately with the answer or the emotional response. Never open with "Great question!" or a preamble.
- Give ONE most important point. If more detail would help, offer it in a short closing line: "Want the quick version or the full walkthrough?"
- End with a brief question only when it genuinely moves the conversation forward.
- For academics: name the concept in one plain sentence and ask what clicked. Save the full walkthrough for when they ask.
- For career: give one concrete next step, then ask which direction they want.
- For mental health: one warm validating sentence and one small, doable suggestion. Grounded in EVIDENCE when present.
` : ''}

STAGE-SPECIFIC BEHAVIOUR:
1. general — reply warmly and naturally. Short, conversational, no retrieval.
2. academics — act as an adaptive tutor. Identify the learning need (explain / solve / step-by-step / example / prerequisites / practice / study plan). Give a plain definition, an intuitive analogy, then a clear walkthrough with a small concrete example; end with one short practice question when appropriate.
3. career — give a structured, personalized path: acknowledge their goal, name relevant skills/topics, then a practical sequence (learn → practice → projects → apply); ask one focusing follow-up question.
4. mental_health (low/moderate risk) — validate their feelings without overreacting, stay calm and non-judgmental, and ground concrete suggestions in the retrieved knowledge below whenever it is available. Always answer the user's actual question — never reply with generic routing or "share more" prompts. Never diagnose, never claim to be a therapist, never invent medical facts, statistics, or sources.

EVIDENCE (only when retrieved — may be empty):
${evidenceUsed && evidence.length ? `Use and paraphrase this retrieved knowledge. Do not invent beyond it.\n${formatEvidence(evidence)}` : 'No retrieved knowledge is available. Give gentle, general, safe guidance only. Where firm facts would normally come from sources (e.g. WHO self-help guidance, NHS Every Mind Matters, NIMH), name them as places to look rather than quoting specific claims.'}

OUTPUT FORMAT:
- Start immediately with your reply text. No preamble, no sign-off about what you are about to do.
- Separate paragraphs with a single blank line.
- Write plain prose only. NO markdown, NO bold, NO headings, NO bullet or numbered lists, NO links, NO JSON, NO code fences.

FORMATTING RULES:
- Each paragraph is 1–3 short, warm, human sentences.
- Paragraph count: general = 0–1 body; academics/career = up to 3 body; mental_health = 2–3 short body grounded in EVIDENCE.
- The first paragraph must directly address the student; never repeat yourself in the last paragraph.

ALWAYS:
- Be concise (match the length the message warrants).
- Address the student's message directly and mirror their key phrases.
- Do not fabricate sources, links, citations, or statistics.
- Do not present sentiment or emotion as a diagnosis.
- For high/critical risk conversations the safety message is handled separately; here just give a brief, caring, steady response.
- Personal/account questions (grades, attendance, mood, clubs, courses, posts, risk) must be answered ONLY from USER CONTEXT when available.`

  const emit = onDelta
    ? (_raw, full) => onDelta(normalizeReplyText(full))
    : undefined

  const raw = await groqChatStream({
    system,
    user: text,
    history,
    temperature: voice ? 0.7 : 0.6,
    maxTokens: 900,
    onDelta: emit,
    signal,
  })
  return normalizeReplyText(raw)
}

async function verifyMentalHealthReply({ reply, text }) {
  const system = `You are a safety reviewer for a student support assistant. Judge the assistant's reply to a student's mental-health message.

Check that, taken together, ALL of these hold:
1. Supportive, calm, non-judgmental, and not alarmist.
2. Does NOT claim to be a therapist or give a medical diagnosis.
3. Does NOT present the student's emotion as a diagnosis.
4. Does NOT fabricate sources, links, statistics, or medical facts.
5. Directly addresses what the student actually said (relevant).

Respond ONLY with JSON: {"ok": true|false, "issue": "<short description if not ok, else empty string>"}`

  const data = await groqChat({
    system,
    user: `Student message:\n${text}\n\nAssistant reply:\n${reply}`,
    json: true,
    temperature: 0,
  })
  return { ok: data?.ok !== false, issue: typeof data?.issue === 'string' ? data.issue : '' }
}

function fallbackReply(text) {
  const lower = text.toLowerCase()
  if (CRITICAL_PATTERNS.some((p) => lower.includes(p))) {
    return "I'm really glad you told me. You deserve support right now — if you're in immediate danger, reach your local emergency services now, and please keep someone you trust close. I'm here with you and can help you find a crisis line if you want."
  }
  if (/(stress|anxious|anxiety|sad|hopeless|overwhelm|alone|burnout|tired|cant sleep|can't sleep|afraid|worried)/.test(lower)) {
    return "I'm here with you. What you're feeling is worth talking through — be gentle with yourself, take a small step like a short break or a slow breath, and reach out to someone you trust or your campus counselor when you can."
  }
  if (/(exam|test|stud|assignment|subject|theorem|solve|learn)/.test(lower)) {
    return 'Let me walk you through it step by step. What topic or concept is giving you trouble? Share a bit more detail and we will break it down together.'
  }
  if (/(placement|job|career|resume|skills|internship)/.test(lower)) {
    return 'Let me build you a practical roadmap. Which role or industry are you aiming for? Then we can list the skills, practice, and projects to get there.'
  }
  return 'Got it — share a little more and I will route it properly (academics, career, or well-being) and give you a proper answer.'
}

function looksLikeUserDataQuestion(text) {
  const t = text.toLowerCase()
  const topic = /(grade|grading|marks|attendance|attended|percentage|mood|check-?in|club|post|posts?|course|enrolled|enrolment|enrollment|risk|ia1|ia2|sentiment|classes|submission|score)/.test(t)
  const asks = /(what|how|which|where|show|tell|list|do i|did i|am i|have i|is my|my)/.test(t)
  return topic && asks
}

/* ─────────────────────── main pipeline ─────────────────────── */

async function runPipeline(text, history = [], userContext = null, { onDelta, onMeta, onRevision, signal, analysis, voice } = {}) {
  const hardRisk = hardRiskCheck(text)

  let intent = 'general'
  let riskLevel = hardRisk || 'low'
  let riskReason = hardRisk ? 'explicit safety language detected in the message' : ''

  const settled = analysis
    ? await analysis
    : await analyzeMessage(text).then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false }),
      )

  if (settled.ok) {
    intent = settled.value.intent
    if (!hardRisk) {
      riskLevel = settled.value.riskLevel
      riskReason = settled.value.reason
    }
  }
  /* analysis unavailable — keep hardRisk or low */

  const userDataQ = userContext ? looksLikeUserDataQuestion(text) : null

  // Intent and risk are settled here — tell the client before the slower
  // emotion/retrieval work so the chips render while enrichment is in flight.
  onMeta?.({ intent, riskLevel })

  let sentiment = null
  let emotion = null
  let category = null
  let evidence = []
  let evidenceUsed = false

  // Enrichment is only consumed by the generated reply — the canned safety
  // response ignores it, so skip the work entirely on the crisis path.
  if (intent === 'mental_health' && riskLevel !== 'high' && riskLevel !== 'critical') {
    category = detectSupportCategory(text)
    const [emotionResult, retrievalResult] = await Promise.allSettled([
      hfEmotionAnalysis(text),
      resolveEvidence({ intent, message: text, category }),
    ])

    if (emotionResult.status === 'fulfilled') {
      sentiment = emotionResult.value.sentiment
      emotion = emotionResult.value.emotion
    }
    if (retrievalResult.status === 'fulfilled') {
      evidence = retrievalResult.value.results
      evidenceUsed = retrievalResult.value.used
    }
  }

  let reply
  let verified = true
  let verifiedIssue = ''

  if (riskLevel === 'high' || riskLevel === 'critical') {
    reply = voice ? safetyResponseVoice(riskLevel) : safetyResponse(riskLevel)
    onDelta?.(reply)
  } else if (!hasGroq()) {
    reply = fallbackReply(text)
    onDelta?.(reply)
  } else {
    const baseContext = {
      intent, text, history, sentiment, emotion, riskLevel, riskReason,
      category, evidence, evidenceUsed, userContext, userDataQ, voice,
    }
    const fallback = fallbackReply(text)

    try {
      const streamed = await generateReply(baseContext, { onDelta, signal })
      reply = streamed || fallback

      if (intent === 'mental_health') {
        const maxAttempts = 2
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (signal?.aborted) break

          let check
          try {
            check = await verifyMentalHealthReply({ reply, text })
          } catch {
            break
          }
          if (check.ok) break

          verified = false
          verifiedIssue = check.issue || ''
          if (attempt === maxAttempts - 1) break

          try {
            const revised = await generateReply(
              { ...baseContext, correction: check.issue },
              { onDelta, signal },
            )
            if (!revised) break
            reply = revised
            onRevision?.(revised)
          } catch {
            break
          }
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err
      try {
        reply = (await generateReply(baseContext, { signal })) || fallback
      } catch {
        reply = fallback
      }
    }
  }

  return {
    intent,
    riskLevel,
    riskReason,
    sentiment,
    emotion,
    category,
    evidence,
    evidenceUsed,
    reply,
    verified,
    verifiedIssue,
  }
}

/* ───────────────────────── HTTP routes ───────────────────────── */

async function handleMessage({ req, text, sessionId, onDelta, onMeta, onRevision, signal, voice }) {
  const userId = userIdOf(req)

  // The analysis call is network-bound and depends on nothing, so start it
  // before the database work instead of waiting behind it.
  const analysis = analyzeMessage(text, { signal }).then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  )

  const session = await ensureSession(req, sessionId)

  const [historyRows, userContext] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    userId ? buildUserContext(userId) : Promise.resolve(null),
  ])

  const history = historyRows.slice(-16).map((m) => ({ role: m.role, content: m.content }))

  const result = await runPipeline(text, history, userContext, { onDelta, onMeta, onRevision, signal, analysis, voice })

  const userMessage = await prisma.chatMessage.create({
    data: {
      userId,
      sessionId: session.id,
      role: 'user',
      content: text,
      intent: result.intent,
      riskLevel: result.riskLevel,
      label: result.emotion,
      score: result.sentiment,
    },
  })

  const assistantMessage = await prisma.chatMessage.create({
    data: {
      userId,
      sessionId: session.id,
      role: 'assistant',
      content: result.reply,
    },
  })

  const sessionData = { sentimentScore: await recomputeSessionSentiment(session.id) }
  if (session.title === 'New chat') sessionData.title = text.slice(0, 48)
  const insightIntent = result.intent === 'general' ? session.intent || null : result.intent
  if (insightIntent) sessionData.intent = insightIntent

  const updated = await prisma.chatSession.update({
    where: { id: session.id },
    data: { ...sessionData, updatedAt: new Date() },
  })

  return {
    reply: result.reply,
    meta: {
      intent: result.intent,
      riskLevel: result.riskLevel,
      sentimentScore: result.sentiment,
      emotion: result.emotion,
      category: result.category,
      evidenceUsed: result.evidenceUsed,
      evidenceCount: result.evidence.length,
      verified: result.verified,
    },
    session: updated,
    messages: { user: userMessage, assistant: assistantMessage },
  }
}

assistantRoutes.get('/tts/status', (req, res) => {
  res.json({ provider: ttsProvider(), model: process.env.ELEVENLABS_VOICE_MODEL || 'eleven_flash_v2_5' })
})

assistantRoutes.post('/tts', requireAuth, async (req, res) => {
  const controller = new AbortController()
  const isDisconnected = abortOnDisconnect(res, controller)

  try {
    if (!ttsProvider()) {
      return res.status(501).json({ error: 'No TTS provider configured.' })
    }
    const { text } = req.body || {}
    const { contentType, body } = await synthesizeSpeech({ text, signal: controller.signal })

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    const reader = body.getReader()
    while (true) {
      if (isDisconnected()) break
      const { done, value } = await reader.read()
      if (done) break
      res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    if (isDisconnected() || isAbortError(err)) {
      if (!res.writableEnded) res.end()
      return
    }
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'Speech synthesis failed' })
    } else if (!res.writableEnded) {
      res.end()
    }
  }
})

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
}

function send(res, event, data) {
  if (res.writableEnded) return
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/**
 * Aborts generation when the client hangs up mid-response.
 *
 * `req`'s 'close' event fires as soon as the request body has been consumed -
 * which is before the handler even runs, since express.json()/multer already
 * read it - so it cannot be used to detect disconnects. `res` closes either
 * when we finish writing or when the socket dies, so gate on writableFinished.
 */
function abortOnDisconnect(res, controller) {
  let disconnected = false
  res.on('close', () => {
    if (res.writableFinished) return
    disconnected = true
    controller.abort()
  })
  return () => disconnected
}

assistantRoutes.post('/chat/stream', async (req, res) => {
  openStream(res)

  const controller = new AbortController()
  const isDisconnected = abortOnDisconnect(res, controller)

  try {
    const { message, sessionId } = req.body || {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      send(res, 'error', { message: 'A message is required.' })
      return res.end()
    }

    const data = await handleMessage({
      req,
      text: message.trim(),
      sessionId,
      signal: controller.signal,
      onDelta: (value) => send(res, 'delta', { text: value }),
      onMeta: (meta) => send(res, 'meta', { meta }),
      onRevision: (value) => send(res, 'revision', { text: value }),
    })

    if (isDisconnected()) return
    send(res, 'done', data)
  } catch (err) {
    if (isDisconnected() || err?.name === 'AbortError') return
    send(res, 'error', { message: err?.message || 'The assistant could not complete this turn.' })
  } finally {
    if (!res.writableEnded) res.end()
  }
})

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

assistantRoutes.post('/voice/stream', voiceUpload.single('audio'), async (req, res) => {
  openStream(res)

  const controller = new AbortController()
  const isDisconnected = abortOnDisconnect(res, controller)

  try {
    if (!req.file) {
      send(res, 'error', { message: 'An audio file is required.' })
      return res.end()
    }

    const { sessionId } = req.body || {}
    const text = await groqTranscribe({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || 'audio/wav',
      filename: req.file.originalname || 'voice.wav',
      signal: controller.signal,
    })
    if (!text) {
      send(res, 'error', { message: 'Could not hear you — please try again.' })
      return res.end()
    }

    send(res, 'transcript', { text })

    const data = await handleMessage({
      req,
      text,
      sessionId,
      voice: true,
      signal: controller.signal,
      onDelta: (value) => send(res, 'delta', { text: value }),
      onMeta: (meta) => send(res, 'meta', { meta }),
      onRevision: (value) => send(res, 'revision', { text: value }),
    })

    if (isDisconnected()) return
    send(res, 'done', data)
  } catch (err) {
    if (isDisconnected() || err?.name === 'AbortError') return
    send(res, 'error', { message: err?.message || 'The assistant could not complete this turn.' })
  } finally {
    if (!res.writableEnded) res.end()
  }
})

const voiceUploadBuffered = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

assistantRoutes.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body || {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A message is required.' })
    }
    const data = await handleMessage({ req, text: message.trim(), sessionId })
    res.status(201).json(data)
  } catch (err) {
    next(err)
  }
})

assistantRoutes.post('/voice', voiceUploadBuffered.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'An audio file is required.' })
    }
    const { sessionId } = req.body || {}

    const text = await groqTranscribe({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || 'audio/wav',
      filename: req.file.originalname || 'voice.wav',
    })
    if (!text) {
      return res.status(400).json({ error: 'Could not hear you — please try again.' })
    }

    const data = await handleMessage({ req, text, sessionId })
    res.status(201).json({ ...data, transcript: text })
  } catch (err) {
    next(err)
  }
})