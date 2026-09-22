import { Router } from 'express'
import { prisma } from '../prisma.js'
import { groqChat, hfEmotionAnalysis, hasGroq } from '../utils/llm.js'
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

async function classifyIntent(text, history = []) {
  const system = `You are an intent router for a student support assistant. Classify the student's latest message into EXACTLY ONE intent.

Intents:
- general: casual conversation, greetings, small talk, open-ended questions about the assistant.
- career: placements, jobs, resumes, skills needed for roles, career roadmaps, internships.
- academics: subjects, concepts, assignments, study plans, exams for coursework, doubts about a topic.
- mental_health: stress, anxiety, mood, burnout, hopelessness, sleep, loneliness, emotions, well-being, overwhelm.

Classify the intent FIRST, based on what the message is fundamentally about. Respond ONLY with JSON: {"intent": "<one of general|career|academics|mental_health>"}`

  const data = await groqChat({ system, user: `Student message: ${text}`, json: true, temperature: 0 })
  const intent = data?.intent
  return INTENTS.includes(intent) ? intent : 'general'
}

async function assessRisk(text) {
  const system = `You are a student safety assessor. Assess ONLY this message for immediate safety concerns, independently of tone or negative emotion.

Rules:
- Negative emotion, stress, or sadness alone is "low" risk.
- "moderate": significant distress, helplessness, or being unable to cope, but NO implicit or explicit self-harm content.
- "high": explicit hopelessness, not wanting to continue, or clear self-harm thoughts without a stated plan.
- "critical": explicit suicidal ideation, a stated plan, or an intention/intent to harm themselves.

Do not diagnose. Do not judge. Respond ONLY with JSON: {"riskLevel": "<low|moderate|high|critical>", "reason": "<one short sentence>"}`

  const data = await groqChat({ system, user: `Student message: ${text}`, json: true, temperature: 0 })
  const risk = data?.riskLevel
  return {
    riskLevel: RISK_LEVELS.includes(risk) ? risk : 'low',
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

function cleanPara(value) {
  return String(value)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-•*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStructure(data) {
  if (typeof data === 'string') return [cleanPara(data)].filter(Boolean)
  const opening = cleanPara(data?.opening ?? '')
  const body = Array.isArray(data?.body) ? data.body.map(cleanPara).filter(Boolean) : []
  const closing = cleanPara(data?.closing ?? '')
  return [opening, ...body, closing].filter(Boolean)
}

function toReplyText(data, fallbackText) {
  const paragraphs = normalizeStructure(data)
  return paragraphs.length ? paragraphs.join('\n\n') : fallbackText
}

async function generateReply(context) {
  const {
    intent, text, history, sentiment, emotion, riskLevel, riskReason,
    category, evidence, evidenceUsed, correction, userContext, userDataQ,
  } = context

  const system = `You are "VibeCheck", a warm, encouraging student support assistant at a college. Your job: be genuinely helpful across academics, career, and well-being, and to be responsible with mental-health topics.

DETECTED CONTEXT:
- Intent: ${intent}
- Risk level (independent assessment): ${riskLevel}${riskReason ? ` — ${riskReason}` : ''}
${sentiment != null ? `- Mental-health sentiment for this message (0 = emotionally drained, 1 = flourishing): ${sentiment}${emotion ? ` (emotion: ${emotion})` : ''}` : ''}
${category ? `- Mental-health support area: ${category}` : ''}
${correction ? `- NOTE: a previous reply failed this check: ${correction}. Fix that issue now.` : ''}

${userContext ? `USER CONTEXT (real, current data from this student's account — answer their personal questions directly and accurately from this only, never invent numbers. If something is missing from it, say it is not recorded yet. Do not repeat raw numbers unless asked.):\n${userContext.summary}${userDataQ ? `\nThis student JUST ASKED about their own account data shown above. Answer their question using ONLY this context — quote the real figures (courses, IA1/IA2, average, attendance %), recent mood check-ins, clubs, community activity, and risk when relevant. If a field they asked about is absent, say it is not recorded yet. Do NOT drift into the previous conversation topic or unrelated examples.` : ''}\n` : ''}

STAGE-SPECIFIC BEHAVIOUR:
1. general — reply warmly and naturally. Short, conversational, no retrieval.
2. academics — act as an adaptive tutor. Identify the learning need (explain / solve / step-by-step / example / prerequisites / practice / study plan). Give a plain definition, an intuitive analogy, then a clear walkthrough with a small concrete example; end with one short practice question when appropriate.
3. career — give a structured, personalized path: acknowledge their goal, name relevant skills/topics, then a practical sequence (learn → practice → projects → apply); ask one focusing follow-up question.
4. mental_health (low/moderate risk) — validate their feelings without overreacting, stay calm and non-judgmental, and ground concrete suggestions in the retrieved knowledge below whenever it is available. Always answer the user's actual question — never reply with generic routing or "share more" prompts. Never diagnose, never claim to be a therapist, never invent medical facts, statistics, or sources.

EVIDENCE (only when retrieved — may be empty):
${evidenceUsed && evidence.length ? `Use and paraphrase this retrieved knowledge. Do not invent beyond it.\n${formatEvidence(evidence)}` : 'No retrieved knowledge is available. Give gentle, general, safe guidance only. Where firm facts would normally come from sources (e.g. WHO self-help guidance, NHS Every Mind Matters, NIMH), name them as places to look rather than quoting specific claims.'}

OUTPUT FORMAT — respond with valid JSON only, exactly this shape:
{ "opening": "<1-2 sentence direct reply that addresses them>", "body": ["<one short paragraph>", "<another optional>", "<another optional>"], "closing": "<short supportive wrap-up, optionally one kind follow-up question>" }

FORMATTING RULES:
- Strictly plain paragraphs. NO markdown (#, **, *, bullets, numbered lists, links, em dashes headers).
- Each paragraph is 1–3 short, warm, human sentences.
- Paragraph count: general = 0–1 body; academics/career = up to 3 body; mental_health = 2–3 short body grounded in EVIDENCE.
- closing always wraps up; do not repeat the opening.

ALWAYS:
- Be concise (match the length the message warrants).
- Address the student's message directly and mirror their key phrases.
- Do not fabricate sources, links, citations, or statistics.
- Do not present sentiment or emotion as a diagnosis.
- For high/critical risk conversations the safety message is handled separately; here just give a brief, caring, steady response.
- Personal/account questions (grades, attendance, mood, clubs, courses, posts, risk) must be answered ONLY from USER CONTEXT when available.

Respond with the JSON object only.`

  const data = await groqChat({
    system,
    user: text,
    history,
    json: true,
    temperature: 0.6,
    maxTokens: 900,
  })
  return data
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

async function runPipeline(text, history = [], userContext = null) {
  const hardRisk = hardRiskCheck(text)

  let intent = 'general'
  try {
    intent = await classifyIntent(text, history)
  } catch {
    intent = 'general'
  }

  const userDataQ = userContext ? looksLikeUserDataQuestion(text) : false

  let riskLevel = hardRisk || 'low'
  let riskReason = hardRisk ? 'explicit safety language detected in the message' : ''
  if (!hardRisk) {
    try {
      const assessment = await assessRisk(text)
      riskLevel = assessment.riskLevel
      riskReason = assessment.reason
    } catch {
      /* keep low */
    }
  }

  let sentiment = null
  let emotion = null
  let category = null
  let evidence = []
  let evidenceUsed = false

  if (intent === 'mental_health') {
    category = detectSupportCategory(text)
    try {
      const emotions = await hfEmotionAnalysis(text)
      sentiment = emotions.sentiment
      emotion = emotions.emotion
    } catch {
      /* sentiment unavailable — leave null (never 0) */
    }
    try {
      const retrieval = await resolveEvidence({ intent, message: text, category })
      evidence = retrieval.results
      evidenceUsed = retrieval.used
    } catch {
      evidence = []
    }
  }

  let reply
  let verified = true
  let verifiedIssue = ''

  if (riskLevel === 'high' || riskLevel === 'critical') {
    reply = safetyResponse(riskLevel)
  } else if (!hasGroq()) {
    reply = fallbackReply(text)
  } else {
    const generate = () =>
      generateReply({
        intent, text, history, sentiment, emotion, riskLevel, riskReason,
        category, evidence, evidenceUsed, userContext, userDataQ,
      })

    try {
      reply = toReplyText(await generate(), fallbackReply(text))

      if (intent === 'mental_health') {
        const maxAttempts = 2
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
            reply = toReplyText(
              await generateReply({
                intent, text, history, sentiment, emotion, riskLevel, riskReason,
                category, evidence, evidenceUsed, correction: check.issue, userContext, userDataQ,
              }),
              fallbackReply(text),
            )
          } catch {
            break
          }
        }
      }
    } catch {
      try {
        reply = toReplyText(await generate(), fallbackReply(text))
      } catch {
        reply = fallbackReply(text)
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

assistantRoutes.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body || {}
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'A message is required.' })
    }
    const text = message.trim()
    const userId = userIdOf(req)
    const session = await ensureSession(req, sessionId)

const historyRows = await prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    const history = historyRows.slice(-16).map((m) => ({ role: m.role, content: m.content }))

    const userContext = userId ? await buildUserContext(userId) : null
    const result = await runPipeline(text, history, userContext)

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

    res.status(201).json({
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
    })
  } catch (err) {
    next(err)
  }
})