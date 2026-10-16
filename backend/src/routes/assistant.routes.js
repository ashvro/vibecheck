import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../prisma.js'
import {
  groqChat,
  groqChatStream,
  groqTranscribe,
  analyzeEmotion,
  hasGroq,
  modelConfig,
} from '../utils/llm.js'
import { ttsProvider, synthesizeSpeech, isAbortError } from '../utils/tts.js'
import { analyzeSentiment } from '../utils/sentiment.js'
import { requireAuth } from '../middleware/auth.js'
import {
  resolveEvidence,
  detectSupportCategory,
  detectSubject,
  formatEvidence,
  knowledgeStatus,
  SUFFICIENCY_THRESHOLD,
} from '../rag.js'
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
  // Well-being is measured only from the turns the pipeline actually scored.
  // Scoring is already scoped to mental-health and crisis turns at write time
  // (see runPipeline), so "has a score" is exactly "is a well-being signal" —
  // a session drifts across topics and the academic/general turns carry no
  // score and drop out here.
  //
  // The value is a plain mean so it matches the running average shown beside
  // each reply in the assistant (and the % in the analytics well-being card).
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, role: 'user', score: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { score: true },
  })
  if (!rows.length) return null

  const sum = rows.reduce((total, row) => total + row.score, 0)
  return Math.round((sum / rows.length) * 100) / 100
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
  const system = `You are the analysis stage of a student support assistant. Read the student's latest message and return its intent and safety risk in one pass.

INTENT (exactly one). Pick the single best fit. If more than one seems to apply, choose the one that lets the assistant help the student most — anything emotional or about how they FEEL is mental_health even when it mentions exams, grades, or a job.
- mental_health: any emotion, feeling, stress, anxiety, mood, burnout, sleep, tiredness, loneliness, overwhelm, self-worth, motivation, or how they are doing. Also any hint of self-harm or not wanting to be here. Example: "I'm so stressed about my exam I can't sleep" is mental_health, NOT academics.
- academics: a subject, concept, assignment, homework, study plan, or exam question where they want the material itself explained, solved, or understood, with NO emotional content. Example: "explain photosynthesis" or "how do I solve this integral".
- career: placements, internships, jobs, resumes, interviews, skills, or career direction.
- general: greetings, small talk, jokes, or open questions about the assistant; anything that is not the above.

RISK LEVEL (assess immediate safety only, independently of tone or negative emotion):
- low: negative emotion, stress, or sadness alone.
- moderate: significant distress, helplessness, or being unable to cope, but NO self-harm content.
- high: explicit hopelessness, not wanting to continue, or clear self-harm thoughts without a stated plan.
- critical: explicit suicidal ideation, a stated plan, or an intention to harm themselves.

Never diagnose. Never judge. When a message is short or ambiguous, choose the most likely intent rather than falling back to general — the assistant must be able to answer immediately.
Respond ONLY with JSON:
{"intent": "<general|career|academics|mental_health>", "riskLevel": "<low|moderate|high|critical>", "reason": "<one short sentence on the risk>"}`

  const data = await groqChat({
    system,
    user: `Student message: ${text}`,
    json: true,
    temperature: 0,
    // Reasoning tokens count against max_tokens on gpt-oss, so at the default
    // medium effort a tight 250-token budget could be consumed entirely by
    // thinking — leaving an empty or truncated JSON body, which silently
    // degrades every message to the `general` intent. Think lightly, budget
    // generously, and classify reliably.
    reasoningEffort: 'low',
    maxTokens: 700,
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

  const system = `You are "VibeCheck", a warm student support assistant built for college students. You sound like a smart, kind upper-year friend — Gen Z, casual, real — never like a corporate chatbot or a textbook. Your job: genuinely help across academics, career, and well-being, and be responsible with mental-health topics.

PERSONA & TONE:
- Talk like an actual person, not a brand. Contractions, short sentences, everyday words: "you're", "let's", "that's", "yeah".
- Match the student's energy and mirror their words. If they're hyped, ride with it; if they're low, slow down and be gentle.
- Light, natural student slang is welcome when it genuinely fits ("that's rough", "no stress", "let's break it down", "you've got this"). Use at most one touch per reply, never stack it, never mock, never try too hard — forced slang reads as cringe and breaks trust.
- Sound like a peer who has been through it, not an authority. No lecturing, no "As an AI", no "Certainly!", no corporate filler.
- Be specific and real. Vague hype ("just stay positive!") is worse than saying less.
- mental_health: warmth first, always. Casual is NOT dismissive — never make light of self-harm, crisis, or serious distress, and drop the slang entirely when someone is struggling.
- academics: explain like a smart friend in the same class. Plain words, a real-world analogy, then one clear step at a time.
- general/career: chat naturally and leave them with one concrete, useful thing.

DETECTED CONTEXT:
- Intent: ${intent}
- Risk level (independent assessment): ${riskLevel}${riskReason ? ` — ${riskReason}` : ''}
${sentiment != null ? `- Mental-health sentiment for this message (0 = emotionally drained, 1 = flourishing): ${sentiment}${emotion ? ` (emotion: ${emotion})` : ''}` : ''}
${category ? `- Mental-health support area: ${category}` : ''}
${correction ? `- NOTE: a previous reply failed this check: ${correction}. Fix that issue now.` : ''}

${userContext ? `USER CONTEXT (real, current data from this student's account — answer their personal questions directly and accurately from this only, never invent numbers. If something is missing from it, say it is not recorded yet. Do not repeat raw numbers unless asked.):\n${userContext.summary}${userDataQ ? `\nThis student JUST ASKED about their own account data shown above. Answer their question using ONLY this context — quote the real figures (courses, IA1/IA2, average, attendance %), recent mood check-ins, clubs, community activity, and risk when relevant. If a field they asked about is absent, say it is not recorded yet. Do NOT drift into the previous conversation topic or unrelated examples.` : ''}\n` : ''}

${voice ? `
VOICE MODE — this reply is SPOKEN ALOUD, not read on screen. These rules override the paragraph and length rules above:
- Two to four short sentences. Aim for roughly 40 to 60 words. Enough to actually help, never a monologue.
- Keep the same warm, casual, peer-to-peer tone as above — but drop slang entirely if the topic is mental health or distress.
- Write for the ear. NO markdown, NO lists, NO headings, NO bullet or numbered lists, NO URLs, NO emoji, NO parentheses, NO asterisks, NO em dashes.
- Only the words you would actually say. No stage directions, no labels, no "Answer:", no formatting.
- Contractions are preferred: "you're", "I'll", "that's". Spoken, not written.
- Lead immediately with the answer or the emotional response. Never open with "Great question!" or a preamble.
- Give ONE most important point. If more detail would help, offer it in a short closing line: "Want the quick version or the full walkthrough?"
- Only end with a question if you genuinely could not answer without more detail — otherwise finish on your answer, not on a question.
- For academics: name the concept in one plain sentence, then add a short question only if it genuinely helps them go further.
- For career: give one concrete next step; only ask a direction question if it helps, never instead of a next step.
- For mental health: one warm validating sentence and one small, doable suggestion. Grounded in EVIDENCE when present.
` : ''}

STAGE-SPECIFIC BEHAVIOUR:
1. general — reply warmly and naturally. Short, conversational, no retrieval.
2. academics — act as an adaptive tutor. Identify the learning need (explain / solve / step-by-step / example / prerequisites / practice / study plan). Give a plain definition, an intuitive analogy, then a clear walkthrough with a small concrete example, and answer the actual question. A short practice question at the end is welcome but optional.
3. career — give a structured, personalized path: acknowledge their goal, name relevant skills/topics, then a practical sequence (learn → practice → projects → apply). Always include the next concrete step; a focusing follow-up question is optional.
4. mental_health (low/moderate risk) — validate their feelings without overreacting, stay calm and non-judgmental, and ground concrete suggestions in the retrieved knowledge below whenever it is available. Always answer the user's actual question — never reply with generic routing or "share more" prompts. Never diagnose, never claim to be a therapist, never invent medical facts, statistics, or sources.

EVIDENCE (only when retrieved — may be empty):
${evidenceUsed && evidence.length
  ? intent === 'academics'
    ? `This is material from the student's own course textbook. Ground your explanation in it: use its terminology and cover the specific points it lists — if it enumerates advantages, features, or steps, include those points rather than substituting generic knowledge. Explain in your own friendly words; do not paste it verbatim as a wall of text.\n${formatEvidence(evidence)}`
    : `Use and paraphrase this retrieved knowledge. Do not invent beyond it.\n${formatEvidence(evidence)}`
  : intent === 'mental_health'
    ? 'No retrieved knowledge is available. Give gentle, general, safe guidance only. Where firm facts would normally come from sources (e.g. WHO self-help guidance, NHS Every Mind Matters, NIMH), name them as places to look rather than quoting specific claims.'
    : 'No reference material was retrieved. Answer from your own solid subject knowledge — be concrete and specific, with real examples, and never hedge just because no document was found.'}

OUTPUT FORMAT:
- Start immediately with your reply text. No preamble, no sign-off about what you are about to do.
- Separate paragraphs with a single blank line.
- Write plain prose only. NO markdown, NO bold, NO headings, NO bullet or numbered lists, NO links, NO JSON, NO code fences.

FORMATTING RULES:
- Each paragraph is 1–3 short, warm, human sentences.
- Paragraph count: general = 0–1 body; academics/career = up to 3 body; mental_health = 2–3 short body grounded in EVIDENCE.
- The first paragraph must directly address the student; never repeat yourself in the last paragraph.

ALWAYS:
- ANSWER IMMEDIATELY. Give a real, useful answer in this reply, every time. Never reply with only a request to "share more", "tell me more", or a promise to help later — that is a failure.
- If the message is short or ambiguous, answer the most likely meaning right away; you may add ONE brief clarifying question at the end if it genuinely helps, but never instead of an answer.
- Prefer answering over clarifying. Only ask a question when you truly cannot answer without one missing detail.
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
    maxTokens: voice ? 900 : 1500,
    // Reasoning runs before any visible text is streamed, so it directly delays
    // the first spoken word. Voice turns think lightly and speak sooner.
    reasoningEffort: voice ? 'low' : undefined,
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

A warm, casual, peer-like tone is allowed and is NOT a failure. Only flag tone that is dismissive, joking about distress, alarmist, or cold.

Respond ONLY with JSON: {"ok": true|false, "issue": "<short description if not ok, else empty string>"}`

  const data = await groqChat({
    system,
    user: `Student message:\n${text}\n\nAssistant reply:\n${reply}`,
    json: true,
    temperature: 0,
    reasoningEffort: 'low',
  })
  return { ok: data?.ok !== false, issue: typeof data?.issue === 'string' ? data.issue : '' }
}

function fallbackReply(text) {
  const lower = text.toLowerCase()
  if (CRITICAL_PATTERNS.some((p) => lower.includes(p))) {
    return "I'm really glad you told me. You deserve support right now — if you're in immediate danger, reach your local emergency services now, and please keep someone you trust close. I'm here with you and can help you find a crisis line if you want."
  }
  if (/(stress|anxious|anxiety|sad|hopeless|overwhelm|alone|burnout|tired|cant sleep|can't sleep|afraid|worried)/.test(lower)) {
    return "That sounds genuinely heavy, and it makes sense you feel this way. One thing that helps in the moment: pick the smallest next step — a glass of water, a few slow breaths, or a short walk — and then let one person you trust know how you're doing. You don't have to sort it all out at once, and reaching out to your campus counselor is a solid move when you're ready."
  }
  if (/(exam|test|stud|assignment|subject|theorem|solve|learn|explain|concept|homework|revis)/.test(lower)) {
    return "Here's the fastest way through it: start from the core idea, break it into one small piece at a time, and check yourself with a quick example as you go. Tell me the exact topic or question and I'll walk you through it step by step."
  }
  if (/(placement|job|career|resume|skills|internship|interview)/.test(lower)) {
    return "A practical path: pick one target role, list the few skills it really needs, then build one small project or practice task that proves each skill. Add it to your resume and apply while you keep improving. Tell me the role you're aiming for and I'll tailor the steps."
  }
  return "Happy to help with whatever's on your mind — academics, career, or how you're feeling. Give me the specifics of what you're working through and I'll take it from there."
}

function looksLikeUserDataQuestion(text) {
  const t = text.toLowerCase()
  const topic = /(grade|grading|marks|attendance|attended|percentage|mood|check-?in|club|post|posts?|course|enrolled|enrolment|enrollment|risk|ia1|ia2|sentiment|classes|submission|score)/.test(t)
  const asks = /(what|how|which|where|show|tell|list|do i|did i|am i|have i|is my|my)/.test(t)
  return topic && asks
}

/**
 * Compact, displayable citation list for a reply: one entry per source document
 * (so a student sees "from dbms.pdf", not a dozen chunk ids). Persisted on the
 * assistant message and surfaced in `meta.sources` so the grounding is visible
 * and verifiable long after the answer was generated.
 *
 * Two guards keep the citation honest:
 *  - If the question names a subject (a "3NF" question -> dbms), only that
 *    textbook is cited. A stray OS/CNS chunk can out-score the right book on
 *    raw similarity, and citing it would imply it backed the answer.
 *  - Otherwise, only sources within 10% of the best hit are cited, so weak
 *    keyword matches don't earn a citation.
 */
function evidenceSources(evidence, subject = null) {
  if (!Array.isArray(evidence) || !evidence.length) return []

  const top = evidence.reduce((max, e) => Math.max(max, e.score ?? 0), 0)
  const floor = Math.max(SUFFICIENCY_THRESHOLD, top * 0.9)
  const subjectPool = subject ? evidence.filter((e) => e.category === subject) : []
  const pool = subjectPool.length
    ? subjectPool
    : evidence.filter((e) => (e.score ?? 0) >= floor)
  const chosen = pool.length ? pool : evidence

  const seen = new Set()
  const sources = []
  for (const item of chosen) {
    if (!item?.source || seen.has(item.source)) continue
    seen.add(item.source)
    sources.push({
      title: item.title ?? null,
      label: String(item.source).split('/').pop(),
      source: item.source,
      category: item.category ?? null,
    })
    if (sources.length >= 3) break
  }
  return sources
}

/**
 * Emotion + knowledge retrieval for a well-being message. These are the slow,
 * network-bound steps and they do NOT depend on the LLM classifier, so when the
 * message already reads as emotional we start them alongside the analysis call
 * rather than waiting for it.
 */
function enrichMentalHealth(text) {
  const category = detectSupportCategory(text)
  return Promise.allSettled([
    analyzeEmotion(text),
    resolveEvidence({ intent: 'mental_health', message: text, category }),
  ]).then(([emotionResult, retrievalResult]) => ({ category, emotionResult, retrievalResult }))
}

/** Cheap pre-check so we only speculate enrichment on likely well-being turns. */
const EMOTION_HINTS = /(stress|anxious|anxiety|panic|sad|depress|hopeless|overwhelm|burn(?:t|ed)? ?out|exhaust|lonely|alone|sleep|insomnia|tired|mood|feel|feeling|emotion|motivat|cry|worried|worry|nervous|afraid|scared|cannot cope|can't cope|cant cope|give up|no reason|hate myself|worthless|failure|self.?harm|suicid|want to die|kill myself)/i

const ENRICHMENT_TIMEOUT = Symbol('enrichment-timed-out')

function waitFor(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(ENRICHMENT_TIMEOUT), ms)
    // Fire-and-forget: if enrichment wins we simply never read this value.
    if (typeof timer.unref === 'function') timer.unref()
  })
}

/* ─────────────────────── main pipeline ─────────────────────── */

async function runPipeline(text, history = [], userContext = null, { onDelta, onMeta, onRevision, signal, analysis, voice } = {}) {
  const hardRisk = hardRiskCheck(text)

  // Well-being enrichment is network-bound and independent of the classifier,
  // so kick it off now on likely emotional messages and overlap it with the
  // analysis call instead of stacking the two latencies. Crisis messages are
  // included too: their reply is canned, but their score still feeds the risk
  // model.
  const speculativeEnrichment = EMOTION_HINTS.test(text) || hardRisk
    ? enrichMentalHealth(text)
    : null

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
  let sentimentSource = null
  let sentimentConfidence = null
  let sentimentDetail = null
  let category = null
  let evidence = []
  let evidenceUsed = false

  const safetyPath = riskLevel === 'high' || riskLevel === 'critical'

  const takeEmotion = (enriched) => {
    if (enriched !== ENRICHMENT_TIMEOUT && enriched.emotionResult?.status === 'fulfilled') {
      const value = enriched.emotionResult.value
      sentiment = value.sentiment
      emotion = value.emotion
      sentimentSource = value.detail?.version ?? 'goemotions-nrcvad-v1'
      sentimentConfidence = value.confidence ?? null
      sentimentDetail = value.detail ?? null
      return
    }
    // The hosted emotion model is unavailable (no key, cold start, rate limit)
    // — fall back to the local lexicon so a well-being turn still carries a
    // score. A null here would be imputed as the training mean by the risk
    // model, i.e. a distressed student scored as average.
    const local = analyzeSentiment(text)
    sentiment = Math.round(((local.score + 1) / 2) * 100) / 100
    emotion = local.label.toLowerCase()
    sentimentSource = local.source
    sentimentConfidence = local.confidence
    sentimentDetail = local.detail
  }

  // Deferred score: the reply must not wait for emotion analysis, but the
  // score must still exist. Previously a null sentiment made the predictor
  // impute the training mean — i.e. score the most distressed students as
  // average, the exact inverse of the intended signal.
  let pendingScore = null

  if (intent === 'mental_health' && !safetyPath) {
    category = detectSupportCategory(text)
    const pending = speculativeEnrichment ?? enrichMentalHealth(text)
    // A cold embedding or emotion model can block for seconds, and voice turns
    // must feel like a live call. If enrichment doesn't come back in time we
    // reply without it — the prompt already covers the no-evidence case. Text
    // turns can afford to wait and stay fully grounded.
    const enriched = voice
      ? await Promise.race([pending, waitFor(1500)])
      : await pending

    takeEmotion(enriched)
    if (enriched !== ENRICHMENT_TIMEOUT && enriched.retrievalResult.status === 'fulfilled') {
      evidence = enriched.retrievalResult.value.results
      evidenceUsed = enriched.retrievalResult.value.used
    }
  } else if (intent === 'academics' || intent === 'career') {
    // Academic and career answers are grounded in the ingested textbooks/guides.
    // No emotion scoring here — these turns carry no well-being signal, and the
    // session average is intentionally scoped to mental-health turns.
    try {
      const retrieval = await resolveEvidence({ intent, message: text })
      evidence = retrieval.results
      evidenceUsed = retrieval.used
    } catch {
      evidence = []
      evidenceUsed = false
    }
  } else if (safetyPath) {
    // Crisis and high-risk turns are well-being signal whatever intent the
    // classifier picked — a null here is imputed as the training mean by the
    // risk model, scoring the most distressed students as average. The reply is
    // canned, so the score runs alongside it and is collected before returning.
    //
    // Anything else that is not mental_health is deliberately left unscored:
    // the session average and the analytics well-being % cover mental-health
    // conversations, not academic or general chit-chat.
    pendingScore = (speculativeEnrichment ?? enrichMentalHealth(text)).then(takeEmotion)
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
    // Track whether the client has already seen partial text, so a retry can be
    // delivered as a full replacement (revision) instead of a slice that would
    // garble what is already on screen or being spoken.
    let streamedAnything = false
    const trackedDelta = onDelta
      ? (value) => {
          streamedAnything = true
          onDelta(value)
        }
      : undefined

    try {
      const streamed = await generateReply(baseContext, { onDelta: trackedDelta, signal })
      reply = streamed || fallback
      // The model can finish with no usable content (an empty stream, or a
      // reasoning-only response). In that case nothing was streamed, so push
      // the fallback to the client instead of leaving the turn silent.
      if (!streamed) trackedDelta?.(fallback)

      // Voice turns skip the post-hoc reviewer: the reply is already being
      // spoken, and a revision would cut it off and restart mid-sentence. The
      // in-prompt safety rules still apply.
      if (intent === 'mental_health' && !voice) {
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
        const retried = (await generateReply(baseContext, { signal })) || fallback
        reply = retried
        // Replace whatever partial text already reached the client so the whole
        // reply (not a truncated prefix) is what they end up with.
        if (streamedAnything) onRevision?.(retried)
        else onDelta?.(retried)
      } catch {
        reply = fallback
        if (!streamedAnything) onDelta?.(fallback)
      }
    }
  }

  // The deferred score has overlapped the whole reply generation, so this
  // rarely waits; the cap keeps persistence from stalling on a cold model.
  if (pendingScore) {
    await Promise.race([pendingScore, waitFor(2000)])
  }

  return {
    intent,
    riskLevel,
    riskReason,
    sentiment,
    emotion,
    sentimentSource,
    sentimentConfidence,
    sentimentDetail,
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

  // `historyRows` comes back newest-first (orderBy desc). Keep the newest 16 and
  // flip to chronological order before sending: passing it reversed left the
  // session's first question immediately before the current one, so the model
  // treated the previous question as part of the new message and answered both
  // (seen in academics, general, and mental-health chats alike).
  const history = historyRows
    .slice(0, 16)
    .reverse()
    .map((m) => ({ role: m.role, content: m.content }))

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
      // The evidence behind the score: which scorer produced it, how certain it
      // was, and the emotion distribution / matched terms it came from. Stored
      // so any value shown to a student or judge can be explained after the fact.
      sentimentSource: result.sentimentSource,
      sentimentConfidence: result.sentimentConfidence,
      sentimentDetail: result.sentimentDetail ? JSON.stringify(result.sentimentDetail) : null,
    },
  })

  // Which textbook grounded this reply — persisted so the "from your textbook"
  // line survives a reload, not just the live stream. Academic answers only:
  // well-being and general replies aren't textbook-grounded, so they must not
  // carry a citation. Academic questions are scoped to the subject they name so
  // only that book is cited.
  const sources =
    result.intent === 'academics'
      ? evidenceSources(result.evidence, detectSubject(text))
      : []

  const assistantMessage = await prisma.chatMessage.create({
    data: {
      userId,
      sessionId: session.id,
      role: 'assistant',
      content: result.reply,
      sources: sources.length ? JSON.stringify(sources) : null,
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
      sentimentSource: result.sentimentSource,
      sentimentConfidence: result.sentimentConfidence,
      category: result.category,
      evidenceUsed: result.evidenceUsed,
      evidenceCount: result.evidence.length,
      sources,
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