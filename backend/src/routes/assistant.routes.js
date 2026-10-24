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

/**
 * Signals that an academics question wants code. Deliberately conservative and
 * keyword-based — it only decides whether to ask the tutor for a runnable
 * example in a fenced block, so a false negative simply gives a prose answer
 * (still fine) while a false positive adds a helpful snippet.
 */
const CODING_PATTERNS = new RegExp(
  [
    '\\bcode\\b', '\\bcoding\\b', '\\bprogram\\b', '\\bprogramming\\b',
    '\\bpython\\b', '\\bjava\\b', '\\bjavascript\\b', '\\btypescript\\b', '\\bc\\+\\+\\b',
    '\\bsql\\b', '\\bquery\\b', '\\bqueries\\b', '\\bmysql\\b', '\\bpostgres\\b',
    '\\bdsa\\b', '\\balgorithm\\b', '\\balgorithms\\b', '\\bdata structure\\b',
    '\\blinked list\\b', '\\bbinary tree\\b', '\\bbinary search\\b', '\\bsorting\\b',
    '\\brecursion\\b', '\\brecursive\\b', '\\bstack\\b', '\\bqueue\\b', '\\bhashmap\\b',
    '\\bhash map\\b', '\\bheap\\b', '\\bgraph\\b', '\\bdynamic programming\\b',
    '\\btime complexity\\b', '\\bbig o\\b', '\\bfunction\\b', '\\bimplement\\b',
    '\\bleetcode\\b', '\\bwrite a program\\b', '\\bsyntax\\b', '\\bcompile\\b',
    '\\bdebug\\b', '\\bloop\\b', '\\barray\\b', '\\bstring reversal\\b',
  ].join('|'),
  'i',
)

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

async function generateSessionSummary(messages, userId) {
  try {
    if (!messages || messages.length === 0) return null
    // Get all messages in the conversation for better context
    const allMsgs = messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 200)}`)
      .join('\n')
    
    if (!hasGroq()) {
      // Fallback to first user message
      const firstUser = messages.find((m) => m.role === 'user')
      return firstUser ? firstUser.content.slice(0, 50).replace(/\n/g, ' ') + '...' : null
    }
    
    const system = `You are a conversation summarizer. Create a very short, concise title/summary (max 40 characters) for this chat conversation. 
    Focus on the main topic. Be specific but brief. Examples: "Binary Search Explained", "Exam Stress Help", "Python Loops". 
    Return ONLY the summary text, no quotes, no extra words.`
    
    const data = await groqChat({
      system,
      user: `Summarize this conversation:\n${allMsgs.slice(0, 800)}`,
      temperature: 0.3,
      maxTokens: 30,
      reasoningEffort: 'low',
      model: modelConfig.groqFastModel,
    })
    
    if (data && typeof data === 'string') {
      const summary = data.trim().replace(/^["']|["']$/g, '').replace(/\n/g, ' ').slice(0, 60)
      return summary || null
    }
    return null
  } catch {
    return null
  }
}

assistantRoutes.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where: { userId: userIdOf(req) },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'asc' }, select: { content: true, role: true } },
      },
    })
    const result = []
    // Only a chat that has no title yet needs the model. The generated title
    // is persisted on the session, so re-summarising every conversation on
    // every list request used to fire one LLM call per chat and left the
    // endpoint taking ~30s. Un-titled chats are still summarised — in
    // parallel, so several of them do not stack up.
    const pending = sessions.filter((s) => (!s.title || s.title === 'New chat') && s.messages.length > 0)
    const summaries = new Map()
    await Promise.all(
      pending.map(async (s) => {
        const summary = await generateSessionSummary(s.messages, s.userId)
        summaries.set(s.id, summary)
      }),
    )
    for (const s of sessions) {
      let title = s.title
      if ((!title || title === 'New chat') && s.messages.length > 0) {
        const summary = summaries.get(s.id)
        if (summary) {
          title = summary
          // Update the session title in background
          prisma.chatSession.update({ where: { id: s.id }, data: { title } }).catch(() => {})
        } else if (!title || title === 'New chat') {
          const firstUserMsg = s.messages.find((m) => m.role === 'user')
          const firstMsg = firstUserMsg?.content || s.messages[0]?.content || null
          if (firstMsg) {
            title = firstMsg.replace(/\n/g, ' ').slice(0, 50) + (firstMsg.length > 50 ? '...' : '')
          }
        }
      }
      const firstUserMsg = s.messages.find((m) => m.role === 'user')
      const firstMsg = firstUserMsg?.content || s.messages[0]?.content || null
      result.push({
        id: s.id,
        title: title || 'New chat',
        intent: s.intent,
        updatedAt: s.updatedAt,
        messageCount: s._count.messages,
        preview: firstMsg,
      })
    }
    res.json(result)
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
- general: greetings, small talk, jokes, or open questions about the assistant; anything that is not the above. When greeting, respond warmly and end with: "Anything you'd like to talk about — how you're feeling or your emotions, studying, or just a normal conversation?"

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

/**
 * Flattens one prose paragraph: strips bold, headings and list markers and
 * collapses whitespace, so a streamed reply reads as clean sentences.
 */
function cleanPara(value) {
  return String(value)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-•*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when a line is a markdown list item ("- foo", "• foo", "1. foo").
 * The marker itself is dropped; the frontend re-adds a bullet so the item
 * renders as a real list row instead of a wall of sentences.
 */
function isListItem(line) {
  return /^\s*(?:[-•*]|\d+[.)])\s+\S/.test(line)
}

/** Flattens a single list item, keeping its text but not its marker. */
function cleanItem(value) {
  return String(value)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalizes one prose block, preserving list structure.
 *
 * List items are emitted one per line (marker removed) so the frontend can
 * render them as bullets; ordinary paragraphs are flattened as before. Either
 * way the result is a single string the renderer can split on newlines.
 */
function normalizeProse(block) {
  const lines = String(block).split('\n')
  const out = []
  let paragraph = []

  const flush = () => {
    const joined = cleanPara(paragraph.join(' '))
    if (joined) out.push(joined)
    paragraph = []
  }

  for (const line of lines) {
    if (isListItem(line)) {
      flush()
      const item = cleanItem(line)
      if (item) out.push(`- ${item}`)
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    paragraph.push(line)
  }
  flush()

  return out.join('\n')
}

/**
 * Normalizes a reply while protecting fenced code blocks.
 *
 * Prose still gets flattened (bold/headings stripped) and list items keep their
 * structure so a tutor's pointwise answer renders as bullets. Anything inside
 * ``` fences is passed through untouched — the fence markers and every leading
 * space have to survive so the frontend can render a boxed code block with
 * correct indentation.
 */
function normalizeReplyText(raw) {
  const value = String(raw)
  const parts = value.split(/```/)
  const out = []

  for (let i = 0; i < parts.length; i += 1) {
    // Odd indices are the content between a pair of ``` fences.
    if (i % 2 === 1) {
      const segment = parts[i]
      // Keep the language alias that follows the opening fence ("python\n...")
      // on the fence line so the frontend can label the block, then trim only
      // the padding around the code itself.
      const nl = segment.indexOf('\n')
      const lang = (nl === -1 ? segment : segment.slice(0, nl)).trim()
      const body = (nl === -1 ? '' : segment.slice(nl + 1)).replace(/\s+$/, '')
      if (!body.trim()) continue
      out.push(lang ? `\`\`\`${lang}\n${body}\n\`\`\`` : `\`\`\`\n${body}\n\`\`\``)
      continue
    }
    // Blank-line-separated blocks become paragraphs; within a block, list
    // items stay on their own lines.
    const prose = parts[i]
      .split(/\n{2,}/)
      .map(normalizeProse)
      .filter(Boolean)
      .join('\n\n')
    if (prose) out.push(prose)
  }

  return out.join('\n\n')
}

async function generateReply(context, { onDelta, signal } = {}) {
  const {
    intent, text, history, riskLevel, riskReason,
    category, evidence, evidenceUsed, correction, userContext, userDataQ, voice,
  } = context

  // Detects code/CS questions so the tutor answers them with a runnable example
  // and a fenced code block instead of prose alone.
  const isCoding = CODING_PATTERNS.test(text || '')

  // Token budget. Token use is the constraint here, so each path gets only what
  // it needs: a brief spoken reply is cheap, a detailed tutor answer needs room,
  // and everything else stays tight.
  const maxTokens = voice ? 260 : intent === 'academics' ? 1100 : intent === 'mental_health' ? 700 : 700

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
- MAXIMUM 100 words — aim for roughly 60 to 90. This is a hard ceiling: voice costs real money per token, so say the main points and stop. Never a monologue, never a list of everything.
- Cover only the ONE or TWO most important points. Pick what actually answers the question and leave the rest out on purpose.
- If the topic has one, land the main point with a quick, concrete example in a single spoken sentence ("for example, ...").
- End with a short follow-up question that offers more, e.g. "Want me to go deeper on that?" or "Should I break down the next part?"
- Keep the same warm, casual, peer-to-peer tone as above — but drop slang entirely if the topic is mental health or distress.
- Write for the ear. NO markdown, NO lists, NO headings, NO bullet or numbered lists, NO URLs, NO emoji, NO parentheses, NO asterisks, NO em dashes.
- NEVER read out code. If the question is about code, describe the idea out loud in plain English and offer to show the full code in chat.
- Only the words you would actually say. No stage directions, no labels, no "Answer:", no formatting.
- Contractions are preferred: "you're", "I'll", "that's". Spoken, not written.
- Lead immediately with the answer or the emotional response. Never open with "Great question!" or a preamble.
- For academics: give the core idea in a sentence or two, one quick example, then the follow-up question.
- For career: give one concrete next step, then the follow-up question.
- For mental health: one warm validating sentence. If loneliness/social isolation is the issue, prioritize concrete, low-pressure connection ideas (shared activity, classmate, club, recurring group) over generic self-soothing. Otherwise give one small, doable suggestion. Grounded in EVIDENCE when present. For mental health the follow-up question must be gentle and supportive, never pushy.
` : ''}

STAGE-SPECIFIC BEHAVIOUR:
1. general — reply warmly and naturally. Short, conversational, no retrieval.
2. academics — act as an adaptive tutor giving a genuinely detailed, well-structured explanation. Identify the learning need (explain / solve / step-by-step / example / prerequisites / practice / study plan). Open with a short 3–5 line introduction to the topic that orients the student, then explain the mechanism or reasoning step by step, then give a concrete worked example, and finish with a short practice question or a pointer on what to do next. Answer the actual question that was asked.
3. career — give a structured, personalized path: acknowledge their goal, name relevant skills/topics, then a practical sequence (learn → practice → projects → apply). Always include the next concrete step; a focusing follow-up question is optional.
4. mental_health (any risk level, including high) — respond as a professional, empathetic therapist: validate their feelings without overreacting, stay calm and non-judgmental, and ground concrete suggestions in the retrieved knowledge below whenever it is available. Offer thoughtful, high-quality therapeutic guidance. Use active listening, empathy, and evidence-based techniques. Vary each reply; do not reuse the same grounding techniques or phrasing across responses. Never repeat the same grounding exercise (e.g., 4-2-6 breathing with 3-2-1 senses) in consecutive answers; choose a different technique each time. If the message involves exam or study stress, end by asking whether they would like help with exam preparation. For high risk: motivate them — acknowledge how heavy it is, remind them they have survived hard days before, and leave them with one small doable step and a reason they can do it. Always answer the user's actual question — never reply with generic routing or "share more" prompts. Never diagnose, never claim to be a therapist, never invent medical facts, statistics, or sources.

${!voice && intent === 'mental_health' ? `COUNSELOR DEPTH (chat only):
- Keep responses warm, empathetic and human. Talk like a kind, grounded peer who actually listens.
- Follow this structure when helpful:
  1. VALIDATE — Start by acknowledging how they're feeling. Make it clear their feelings are real and valid.
  2. UNDERSTAND — Reflect back what they're going through in your own words to show you understand.
  3. PRACTICAL STEPS — Give 2-3 gentle, actionable suggestions as a pointwise list (use "- " bullets). Each suggestion should be small and doable. Tailor to their situation.
  4. ENCOURAGE — End with one warm, hopeful sentence reminding them they've gotten through hard days before, or that this moment won't last forever.
- Drop all slang when someone is in distress. Stay calm and steady, never dismissive or overly cheerful.
- If loneliness/social isolation is mentioned, prioritize concrete low-pressure connection ideas over generic self-soothing.
- For high risk: be extra gentle, validate how heavy it is, and give just ONE small doable step with a reason they can do it. Do NOT push multiple suggestions.
- Never diagnose, never claim to be a therapist, never invent medical facts or statistics.
- NEVER give a list of hotlines as your only response. Focus on helping them right now.
- Keep it concise but thorough — aim for 150-250 words.
` : ''}${!voice && intent === 'academics' ? `ACADEMICS DEPTH (chat only):
- Write a detailed, ChatGPT-quality answer of roughly 400 to 500 words. This overrides the short paragraph rules above for this reply.
- Follow this exact structure, in this order:
  1. DEFINITION — open with a short 3–5 line introduction that defines the topic in plain words and says why it matters. Write this as normal prose (no bullets).
  2. KEY POINTS — then break the explanation into a pointwise list. Start each point on its own line with "- " (a hyphen and a space). Use 4 to 7 points, each one a single clear sentence (or two at most) covering one idea: how it works, the important properties, rules, or steps. This list is what makes the answer skimmable.
  3. EXAMPLE — then a short paragraph with one concrete worked example that walks through a real case from the key points above.
  4. CODE — only when code applies (see below), give the fenced code block after the example.
  5. CLOSE — finish with one short line: a practice question or the next thing to study.
- Be specific and technical, but explain in plain, friendly language. Use the terminology of the subject.
- NEVER pad with filler to reach the length. Every line must teach something. If the honest answer is shorter, prefer being correct and useful over hitting a word count.
- The ONLY markdown allowed is the "- " list markers in KEY POINTS and the code fences. No bold, no headings, no numbered lists, no tables, no links.
${isCoding ? `- This question is about CODE. You MUST include a working example in a fenced code block.
- Pick the language the question implies (Python for DSA/algorithms unless another is named, SQL for queries, the relevant language otherwise).
- Keep the code to roughly 70–100 lines: complete enough to run and to show the full idea, with short comments on the non-obvious lines. No placeholder "..." bodies.
- Output the code inside triple backticks with the language name on the opening fence, e.g. \`\`\`python. The code block is the ONLY exception to the plain-prose rule below.
- Follow the code with one or two sentences on how it works and its time/space complexity where relevant.` : `- If the topic genuinely benefits from showing code, follow the same fenced-code rules: triple backticks with the language name, roughly 70–100 lines, complete and runnable. Otherwise skip the code step and let the example paragraph carry it.`}
` : ''}

EVIDENCE (only when retrieved — may be empty):
${evidenceUsed && evidence.length
  ? intent === 'academics'
    ? `This is material from the student's own course textbook. Ground your explanation in it: use its terminology and cover the specific points it lists — if it enumerates advantages, features, or steps, include those points rather than substituting generic knowledge. Explain in your own friendly words; do not paste it verbatim as a wall of text.\n${formatEvidence(evidence, voice ? 2 : 4, voice ? 500 : 900)}`
    : `Use and paraphrase this retrieved knowledge. Do not invent beyond it.\n${formatEvidence(evidence, voice ? 2 : 4, voice ? 500 : 900)}`
  : intent === 'mental_health'
    ? 'No retrieved knowledge is available. Give gentle, general, safe guidance only. Where firm facts would normally come from sources (e.g. WHO self-help guidance, NHS Every Mind Matters, NIMH), name them as places to look rather than quoting specific claims.'
    : 'No reference material was retrieved. Answer from your own solid subject knowledge — be concrete and specific, with real examples, and never hedge just because no document was found.'}

OUTPUT FORMAT:
- Start immediately with your reply text. No preamble, no sign-off about what you are about to do.
- Separate paragraphs with a single blank line.
- Write plain prose only. NO markdown, NO bold, NO headings, NO numbered lists, NO links, NO JSON.
- Two exceptions, and only these: a fenced code block (triple backticks with the language name on the opening fence, e.g. \`\`\`python), and the "- " list markers used for the KEY POINTS list in a detailed tutor (academics) answer. Never use fences for anything except code.

FORMATTING RULES:
- Each paragraph is 1–3 short, warm, human sentences.
- Paragraph count: general = 0–1 body; academics/career = up to 3 body; mental_health = 2–3 short body grounded in EVIDENCE.
- Always use the conversation history to stay on topic; do not jump to unrelated answers.
- When ACADEMICS DEPTH applies (detailed tutor answer), this paragraph cap is lifted — write the full structured answer described there (definition, then a "- " key-points list, then an example, then optional code, then a closing line).
- When COUNSELOR DEPTH applies (mental_health chat), keep to that structure: validate, understand, practical steps (2–3 bullets), encourage. You may still use "- " bullets for the practical steps.
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
    maxTokens,
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
const WELLBEING_HINTS = /(stress|anxious|anxiety|panic|sad|depress|hopeless|overwhelm|burn(?:t|ed)? ?out|exhaust|lonely|alone|sleep|insomnia|tired|mood|feel|feeling|emotion|motivat|cry|worried|worry|nervous|afraid|scared|happy|excited|joy|glad|content|cannot cope|can't cope|cant cope|give up|no reason|hate myself|worthless|failure|self.?harm|suicid|want to die|kill myself)/i

/**
 * Instant intent signals for voice turns.
 *
 * The LLM classifier costs 0.6–0.9s, which is most of the budget between the
 * student finishing a sentence and hearing the first word back. Voice replies
 * are short and style-only, so a keyword pre-check is good enough to choose
 * the prompt; text chat still uses the full classifier. Explicit safety
 * language is still caught deterministically by hardRiskCheck().
 */
const ACADEMIC_HINTS = /\b(explain|explanation|define|definition|meaning of|difference between|concept|theory|homework|assignment|exam|test|quiz|study|studying|revise|revision|subject|topic|chapter|theorem|formula|equation|solve|calculate|derivative|integral|photosynthesis|mitosis|algorithm|algorithms|data structure|binary search|linked list|programming|code|coding|python|java|javascript|typescript|sql|database|network|operating system|compiler|math|maths|mathematics|physics|chemistry|biology|history|economics|geography|literature|grammar|essay|diagram|syllabus|semester|numerical|proof|practical|viva|mcq|question paper|previous year|lab|experiment|notes)\b/i

const CAREER_HINTS = /\b(placement|placements|internship|intern|job|jobs|resume|cv|interview|interviews|career|salary|hiring|hire|recruiter|recruitment|apply|application|company|linkedin|portfolio|aptitude|offer letter)\b/i

/** Distress strong enough to hold even when the message names a subject. */
const DISTRESS_HINTS = /\b(suicid\w*|self[-\s]?harm\w*|kill myself|want to die|end my life|hopeless|worthless|no reason to (?:live|go on)|can'?t go on|cannot go on|can'?t cope|cannot cope|panic attack|depress\w*|anxiety attack|burn(?:t|ed)?[-\s]?out|breakdown|hate myself|don'?t see the point|no point (?:in|to) (?:anything|life)|better off dead|want to disappear)\b/i

function fastAnalysis(text) {
  const hardRisk = hardRiskCheck(text)
  // Critical language always goes down the safety path, even if the student
  // framed it around an exam or a job.
  if (hardRisk === 'critical') {
    return {
      intent: 'mental_health',
      riskLevel: 'critical',
      reason: 'explicit safety language detected in the message',
    }
  }

  const distress = DISTRESS_HINTS.test(text)
  let intent = 'general'
  if (distress) intent = 'mental_health'
  else if (WELLBEING_HINTS.test(text)) intent = 'mental_health'
  else if (ACADEMIC_HINTS.test(text)) intent = 'academics'
  else if (CAREER_HINTS.test(text)) intent = 'career'
  // A "high" phrase such as "give up" on an otherwise academic question still
  // keeps the safety flag, but should not turn a maths question into a
  // counselling reply.
  else if (hardRisk) intent = 'mental_health'

  return {
    intent,
    riskLevel: hardRisk || (distress ? 'moderate' : 'low'),
    reason: hardRisk
      ? 'safety language detected in the message'
      : distress
        ? 'distress language detected'
        : '',
  }
}

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
    if (!hardRisk && WELLBEING_HINTS.test(text)) {
      intent = 'mental_health'
    }
    if (!hardRisk) {
      riskLevel = settled.value.riskLevel
      riskReason = settled.value.reason
    }
  } else if (WELLBEING_HINTS.test(text)) {
    intent = 'mental_health'
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
      ? await Promise.race([pending, waitFor(600)])
      : await pending

    if (enriched !== ENRICHMENT_TIMEOUT && enriched.retrievalResult.status === 'fulfilled') {
      evidence = enriched.retrievalResult.value.results
      evidenceUsed = enriched.retrievalResult.value.used
    }
  } else if (intent === 'academics' || intent === 'career') {
    // Academic and career answers are grounded in the ingested textbooks/guides.
    // Same live-call budget as well-being: a cold index or a slow embedding
    // request must not hold the first spoken word hostage.
    try {
      const pending = resolveEvidence({ intent, message: text }).catch(() => null)
      const retrieval = voice ? await Promise.race([pending, waitFor(600)]) : await pending
      if (retrieval && retrieval !== ENRICHMENT_TIMEOUT) {
        evidence = retrieval.results
        evidenceUsed = retrieval.used
      }
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
      console.warn('[assistant] generation failed, retrying once:', err?.message?.slice(0, 220))
      try {
        const retried = (await generateReply(baseContext, { signal })) || fallback
        reply = retried
        // Replace whatever partial text already reached the client so the whole
        // reply (not a truncated prefix) is what they end up with.
        if (streamedAnything) onRevision?.(retried)
        else onDelta?.(retried)
      } catch (retryErr) {
        console.warn('[assistant] generation retry failed, using fallback:', retryErr?.message?.slice(0, 220))
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
  // before the database work instead of waiting behind it. Voice turns use the
  // instant keyword classifier instead: an extra LLM round-trip before the
  // reply is a large slice of the "why is it still thinking?" delay, and voice
  // answers are short enough that prompt selection does not need a model call.
  const analysis = voice
    ? Promise.resolve({ ok: true, value: fastAnalysis(text) })
    : analyzeMessage(text, { signal }).then(
        (value) => ({ ok: true, value }),
        () => ({ ok: false }),
      )

  const session = await ensureSession(req, sessionId)

  const [historyRows, userContext] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { sessionId: session.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      // Fetch a few more rows than we send so trimming by size still has the
      // newest turns available. Voice needs far less context than chat: its
      // replies are short, so a long tail of history costs tokens without
      // improving the answer.
      take: voice ? 8 : 14,
    }),
    userId ? buildUserContext(userId) : Promise.resolve(null),
  ])

  // `historyRows` comes back newest-first (orderBy desc). Keep the newest turns
  // and flip to chronological order before sending: passing it reversed left the
  // session's first question immediately before the current one, so the model
  // treated the previous question as part of the new message and answered both
  // (seen in academics, general, and mental-health chats alike).
  //
  // Long past replies are truncated (an earlier 500-word tutor answer is mostly
  // stale context) and the total character budget is capped, which is the single
  // biggest lever on prompt tokens.
  const HISTORY_TURNS = voice ? 4 : 10
  const HISTORY_CHARS = voice ? 900 : 4000
  const trimmed = []
  let usedChars = 0
  for (const m of historyRows) {
    if (trimmed.length >= HISTORY_TURNS) break
    let content = m.content
    const perMessage = voice ? 220 : 700
    if (content.length > perMessage) content = `${content.slice(0, perMessage)}…`
    if (usedChars + content.length > HISTORY_CHARS) break
    usedChars += content.length
    trimmed.push({ role: m.role, content })
  }
  const history = trimmed.reverse()

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
  // Generate summary after getting messages
  const insightIntent = result.intent === 'general' ? session.intent || null : result.intent
  if (insightIntent) sessionData.intent = insightIntent

  const updated = await prisma.chatSession.update({
    where: { id: session.id },
    data: { ...sessionData, updatedAt: new Date() },
  })

  // Update title with summary if it's the first exchange or if needed
  if (session.title === 'New chat') {
    const allMsgs = await prisma.chatSession.findUnique({
      where: { id: session.id },
      include: { messages: { orderBy: { createdAt: 'asc' }, select: { content: true, role: true } } },
    })
    const msgs = allMsgs?.messages ?? []
    const summary = await generateSessionSummary(msgs)
    if (summary) {
      const updatedWithTitle = await prisma.chatSession.update({ where: { id: session.id }, data: { title: summary } })
      // reflect updated title in response
      updated.title = updatedWithTitle.title
    }
  }

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