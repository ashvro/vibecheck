import { Router } from 'express'
import multer from 'multer'
import { prisma } from '../prisma.js'
import {
  groqChat,
  groqChatStream,
  groqTranscribe,
  hasGroq,
  modelConfig,
} from '../utils/llm.js'
import { ttsProvider, synthesizeSpeech, listVoices, isAbortError } from '../utils/tts.js'
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
- mental_health: genuine emotional distress, mood concerns, or crisis/self-harm indicators. Acknowledge stress alongside academics, but classify as academics if the primary ask is about the subject/assignment (e.g. "I'm stressed about exams, how do I study?" is primarily academics; "I'm overwhelmed and don't see the point anymore" is mental_health). Also includes self-harm, burnout that blocks functioning, loneliness, etc.
- academics: subject concepts, assignments, homework, study plans, exam prep, or problem-solving where they want material explained/solved, even if they mention stress about it. Example: "I'm so stressed about my exam I can't sleep — how do I revise?" is academics (primary ask is revision strategy). "explain photosynthesis" is academics.
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
    reasoningEffort: 'low',
    maxTokens: 400,
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
    "I'm really glad you told me — that took courage, and I want you to know I'm taking this seriously. You are not a burden, and what you're feeling right now is pain talking, not the truth about your life. These feelings are temporary, even when they don't feel temporary.\n\n"

  if (riskLevel === 'critical') {
    return `${base}Right now, please take one step with me: reach out to someone who can be physically with you tonight — a friend, a roommate, a sibling, anyone. You don't have to explain everything; just say you need company. And please call a crisis line — in India, Tele-MANAS is free on 14416 and iCall on 9152987821, both 24/7 with people trained for exactly this moment. If you feel you're in immediate danger, call 112 or go to the nearest hospital.\n\nI'm not going anywhere — you can keep talking to me right here. You matter, far more than this moment is telling you, and you've survived every hard day so far. Let's take it one small hour at a time. What's one tiny thing I can help you with right now?`
  }

  return `${base}Please reach out today to one person you trust — a friend, a sibling, anyone — and tell them how you're really doing. You don't have to go through this alone, and talking about it is not a weakness. If talking feels hard right now, Tele-MANAS (14416) and iCall (9152987821) are free, confidential, and open 24/7.\n\nAnd I'm right here with you — we can keep talking for as long as you need. You've gotten through heavy days before, and you'll get through this one too. What would help most right now: just venting, or working out one small next step together?`
}

/**
 * Spoken-length safety replies. Same safety content as safetyResponse() —
 * acknowledgement, immediate action, don't stay alone, offer of help — but
 * short enough to say out loud without losing any of it.
 */
function safetyResponseVoice(riskLevel) {
  if (riskLevel === 'critical') {
    return "I'm really glad you told me — that took courage. Please call 14416 right now, that's Tele-MANAS, free and open all night, or 112 if you're in danger, and stay with someone you trust tonight. You matter, and this feeling will pass. I'm staying right here with you."
  }
  return "I hear you, and I'm glad you reached out. Please tell one person today how you're really doing — a friend, anyone — and if talking feels hard, call 14416, that's Tele-MANAS, free and 24/7. You've made it through heavy days before, and you'll get through this one. I'm right here with you for as long as you need."
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
    intent, text, history, riskLevel, riskReason,
    category, evidence, evidenceUsed, correction, userContext, userDataQ, voice,
  } = context

  const system = `You are "VibeCheck", a warm student support assistant built for college students. You sound like a smart, kind upper-year friend — Gen Z, casual, real — never like a corporate chatbot or a textbook. Your job: genuinely help across academics, career, and well-being. Be responsible with mental-health topics. Match what the user asks for first.

PERSONA & TONE:
- Talk like an actual person, not a brand. Contractions, short sentences, everyday words: "you're", "let's", "that's", "yeah".
- Match the student's energy and mirror their words. If they're hyped, ride with it; if they're low, slow down and be gentle.
- Light, natural student slang is welcome when it genuinely fits ("that's rough", "no stress", "let's break it down", "you've got this"). Use at most one touch per reply, never stack it, never mock, never try too hard — forced slang reads as cringe and breaks trust.
- Sound like a peer who has been through it, not an authority. No lecturing, no "As an AI", no "Certainly!", no corporate filler.
- Be specific and real. Vague hype ("just stay positive!") is worse than saying less.
- mental_health: warmth first, always. Casual is NOT dismissive — never make light of self-harm, crisis, or serious distress, and drop the slang entirely when someone is struggling. Motivate them without being preachy — remind them, gently, that they have gotten through hard days before and that this feeling is a moment, not the rest of their life. Validate first, then suggest, then encourage. If they reject the first suggestion, don't repeat it — go deeper: ask what specifically feels impossible, or offer a smaller, lower-effort step (one glass of water, five minutes outside, one message to one person). Never end a mental-health reply with just a resource list; always leave them with one small, doable thing and a reason they can do it.
- academics: explain like a smart friend in the same class. Plain words, a real-world analogy, then one clear step at a time.
- general/career: chat naturally and leave them with one concrete, useful thing.

DETECTED CONTEXT:
- Intent: ${intent}
- Risk level (independent assessment): ${riskLevel}${riskReason ? ` — ${riskReason}` : ''}
${category ? `- Mental-health support area: ${category}` : ''}
${correction ? `- NOTE: a previous reply failed this check: ${correction}. Fix that issue now.` : ''}

${userContext ? `USER CONTEXT (real, current data from this student's account — answer their personal questions directly and accurately from this only, never invent numbers. If something is missing from it, say it is not recorded yet. Do not repeat raw numbers unless asked.):\n${userContext.summary}${userDataQ ? `\nThis student JUST ASKED about their own account data shown above. Answer their question using ONLY this context — quote the real figures (courses, IA1/IA2, average, attendance %), recent mood check-ins, clubs, community activity, and risk when relevant. If a field they asked about is absent, say it is not recorded yet. Do NOT drift into the previous conversation topic or unrelated examples.` : ''}\n` : ''}

${voice ? `
VOICE MODE — this reply is SPOKEN ALOUD, not read on screen. These rules override the paragraph and length rules above:
- You MUST reply ONLY in English. Do not use Hindi, Urdu, Hinglish, transliterated Hindi, or any other language. Never mix languages.
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
- For mental health: one warm validating sentence. If loneliness/social isolation is the issue, prioritize concrete, low-pressure connection ideas (shared activity, classmate, club, recurring group) over generic self-soothing. Otherwise give one small, doable suggestion. Grounded in EVIDENCE when present.
` : ''}

STAGE-SPECIFIC BEHAVIOUR:
1. general — reply warmly and naturally. Short, conversational, no retrieval.
2. academics — act as an adaptive tutor. Identify the learning need (explain / solve / step-by-step / example / prerequisites / practice / study plan). Give a plain definition, an intuitive analogy, then a clear walkthrough with a small concrete example, and answer the actual question. A short practice question at the end is welcome but optional.
3. career — give a structured, personalized path: acknowledge their goal, name relevant skills/topics, then a practical sequence (learn → practice → projects → apply). Always include the next concrete step; a focusing follow-up question is optional.
4. mental_health (any risk level, including high) — validate their feelings without overreacting, stay calm and non-judgmental, and ground concrete suggestions in the retrieved knowledge below whenever it is available. For high risk: motivate them — acknowledge how heavy it is, remind them they have survived hard days before, and leave them with one small doable step and a reason they can do it. Always answer the user's actual question — never reply with generic routing or "share more" prompts. Never diagnose, never claim to be a therapist, never invent medical facts, statistics, or sources.

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
- Do not present the student's emotional state as a diagnosis.
- For critical risk conversations the safety message is handled separately; here just give a brief, caring, steady response. For high risk, this is your chance to be the support they need: acknowledge their pain, motivate them without lecturing, remind them they've survived hard days before, and leave them with one small doable step and a reason they can do it.
- Personal/account questions (grades, attendance, mood, clubs, courses, posts, risk) must be answered ONLY from USER CONTEXT when available.`

  const emit = onDelta
    ? (_raw, full) => onDelta(normalizeReplyText(full))
    : undefined

  const raw = await groqChatStream({
    system,
    user: text,
    history,
    temperature: voice ? 0.7 : 0.6,
    maxTokens: voice ? 600 : 900,
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
    maxTokens: 250,
  })
  return { ok: data?.ok !== false, issue: typeof data?.issue === 'string' ? data.issue : '' }
}

function fallbackReply(text) {
  const lower = text.toLowerCase()
  if (CRITICAL_PATTERNS.some((p) => lower.includes(p))) {
    return "I'm really glad you told me — that took courage. You are not a burden. Please call 14416 (Tele-MANAS, free, 24/7) or 112 right now if you're in danger, and stay with someone you trust tonight. I'm right here with you."
  }
  if (/(stress|anxious|anxiety|sad|hopeless|overwhelm|alone|burnout|tired|cant sleep|can't sleep|afraid|worried|give up)/.test(lower)) {
    return "That sounds genuinely heavy, and it makes sense you feel this way. You've gotten through hard days before — this one doesn't get to decide the rest of your story. Start tiny: a glass of water, a few slow breaths, five minutes outside. And please tell one person today how you're really doing — a friend, a sibling, anyone. If talking feels hard, Tele-MANAS (14416) is free and open 24/7. I'm right here with you for as long as you need."
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
  const topic = /(grade|grading|marks|attendance|attended|percentage|mood|check-?in|club|post|posts?|course|enrolled|enrolment|enrollment|risk|ia1|ia2|classes|submission|score)/.test(t)
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
 * Knowledge retrieval for a well-being message. This is the slow,
 * network-bound step and it does NOT depend on the LLM classifier, so when the
 * message already reads as a well-being turn we start it alongside the analysis
 * call rather than waiting for it.
 */
function enrichMentalHealth(text) {
  const category = detectSupportCategory(text)
  return Promise.allSettled([
    resolveEvidence({ intent: 'mental_health', message: text, category }),
  ]).then(([retrievalResult]) => ({ category, retrievalResult }))
}

/** Cheap pre-check so we only speculate enrichment on likely well-being turns. */
const WELLBEING_HINTS = /(stress|anxious|anxiety|panic|sad|depress|hopeless|overwhelm|burn(?:t|ed)? ?out|exhaust|lonely|alone|sleep|insomnia|tired|mood|feel|feeling|emotion|motivat|cry|worried|worry|nervous|afraid|scared|cannot cope|can't cope|cant cope|give up|no reason|hate myself|worthless|failure|self.?harm|suicid|want to die|kill myself)/i

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

  // Well-being retrieval is network-bound and independent of the classifier,
  // so kick it off now on likely well-being messages and overlap it with the
  // analysis call instead of stacking the two latencies. Crisis messages are
  // included too: their reply is canned, but its sources still ground it.
  const speculativeEnrichment = WELLBEING_HINTS.test(text) || hardRisk
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
  // retrieval work so the chips render while enrichment is in flight.
  onMeta?.({ intent, riskLevel })

  let category = null
  let evidence = []
  let evidenceUsed = false

  const safetyPath = riskLevel === 'critical'

  if (intent === 'mental_health' && !safetyPath) {
    category = detectSupportCategory(text)
    const pending = speculativeEnrichment ?? enrichMentalHealth(text)
    // A cold embedding model can block for seconds, and voice turns must feel
    // like a live call. If retrieval doesn't come back in time we reply without
    // it — the prompt already covers the no-evidence case. Text turns can
    // afford to wait and stay fully grounded.
    const enriched = voice
      ? await Promise.race([pending, waitFor(1500)])
      : await pending

    if (enriched !== ENRICHMENT_TIMEOUT && enriched.retrievalResult.status === 'fulfilled') {
      evidence = enriched.retrievalResult.value.results
      evidenceUsed = enriched.retrievalResult.value.used
    }
  } else if (intent === 'academics' || intent === 'career') {
    // Academic and career answers are grounded in the ingested textbooks/guides.
    try {
      const retrieval = await resolveEvidence({ intent, message: text })
      evidence = retrieval.results
      evidenceUsed = retrieval.used
    } catch {
      evidence = []
      evidenceUsed = false
    }
  }

  let reply
  let verified = true
  let verifiedIssue = ''

  if (riskLevel === 'critical') {
    reply = voice ? safetyResponseVoice(riskLevel) : safetyResponse(riskLevel)
    onDelta?.(reply)
  } else if (!hasGroq()) {
    reply = fallbackReply(text)
    onDelta?.(reply)
  } else {
    const baseContext = {
      intent, text, history, riskLevel, riskReason,
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

  return {
    intent,
    riskLevel,
    riskReason,
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

  const sessionData = {}
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
  res.json({
    provider: ttsProvider(),
    model: process.env.ELEVENLABS_VOICE_MODEL || 'eleven_flash_v2_5',
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
  })
})

assistantRoutes.get('/voices', async (req, res, next) => {
  try {
    const voices = await listVoices()
    res.json({ voices })
  } catch (err) {
    next(err)
  }
})

assistantRoutes.post('/tts', requireAuth, async (req, res) => {
  const controller = new AbortController()
  const isDisconnected = abortOnDisconnect(res, controller)

  try {
    if (!ttsProvider()) {
      return res.status(501).json({ error: 'No TTS provider configured.' })
    }
    const { text, voiceId } = req.body || {}
    const { contentType, body } = await synthesizeSpeech({ text, voiceId, signal: controller.signal })

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