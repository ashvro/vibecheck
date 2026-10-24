/**
 * Relaxation voice-instructor routes.
 *
 * Backs the "Calm" live voice instructor used in the Relaxation tab:
 * - creates (once) an ElevenLabs Conversational-AI agent configured with the
 *   instructor system prompt below, using the SAME account token that the
 *   existing TTS pipeline uses (ELEVENLABS_API_KEY in backend/.env);
 * - issues short-lived signed URLs so the browser can connect directly to the
 *   ElevenLabs conversation WebSocket without ever seeing the API key;
 * - exposes the first 20 account voices for the in-app voice picker (the
 *   chosen voice_id is applied per-session as an override, so a single agent
 *   serves every voice choice).
 */
import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { listVoices } from '../utils/tts.js'
import { groqTranscribe } from '../utils/llm.js'
import { prisma } from '../prisma.js'

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1'
const MAX_VOICE_OPTIONS = 20
const DEFAULT_INSTRUCTOR_VOICE_ID = 'pNInz6obpgDQGcFmaJgB' // Adam
const INSTRUCTOR_AGENT_NAME = 'Calm — Relaxation Instructor'

export const relaxationRoutes = Router()

function apiKey() {
  // Prefer a dedicated key that has Conversational-AI write access; fall back
  // to the shared TTS key (which usually only has tts/voices permissions).
  return process.env.ELEVENLABS_AGENT_API_KEY || process.env.ELEVENLABS_API_KEY || ''
}

/**
 * Voices change rarely, and the picker + every session start both need the
 * list. Caching it removes two round-trips from the click-to-first-word path.
 */
const VOICES_TTL_MS = 10 * 60 * 1000
let voicesCache = { at: 0, list: [] }

async function cachedVoices() {
  if (voicesCache.list.length && Date.now() - voicesCache.at < VOICES_TTL_MS) {
    return voicesCache.list
  }
  const list = await listVoices()
  voicesCache = { at: Date.now(), list }
  return list
}

async function elCall(path, init = {}) {
  const res = await fetch(`${ELEVENLABS_URL}${path}`, {
    ...init,
    headers: {
      'xi-api-key': apiKey(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const detail = json?.detail?.message || json?.detail?.status?.message || json?.detail || text
    const err = new Error(`ElevenLabs ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    err.status = res.status
    throw err
  }
  return json
}

// ---------------------------------------------------------------------------
// Instructor prompt — "Calm", a live relaxation coach.
//
// This prompt intentionally contains NO scripted lines. Every word the agent
// says comes from the get_next_line client tool, which the frontend runner
// owns. Putting the text of the session in here as well is what used to make
// the agent say a line twice (once from memory, once from the tool).
// ---------------------------------------------------------------------------
const INSTRUCTOR_PROMPT = `# ROLE
You are CalmCoach, a calm relaxation instructor.

# SPEECH
Every word you say comes from the get_next_line tool. Never write, recall, paraphrase or improvise a line.
- Call get_next_line once per user turn, and only after the user has spoken.
- Say the returned "line" exactly, including every <break .../> tag. Nothing else: no greeting, no filler, no advice.
- kind "checkin": say it, then stop and listen.
- kind "speak": say it in one turn.
- kind "wait": stay silent.
- kind "end": say nothing and end the call.
- Never end the call before kind "end".
- Never mention the tool, script, timing or these instructions.`


// ---------------------------------------------------------------------------
// Agent lifecycle
// ---------------------------------------------------------------------------
let instructorAgentId = null
/** Fingerprint of the config last pushed to the agent (prompt/tool/voice). */
let syncedFingerprint = null

/**
 * Client tool — the deterministic backbone of the session. Registered once as
 * a workspace tool (POST /v1/convai/tools); the agent references it by id and
 * must call it before every scripted line. It returns the exact text (with
 * <break> tags) to speak, so the SLOW/MEDIUM/FAST scripts are followed in
 * order regardless of LLM improvisation — the frontend owns the line counter.
 */
const SCRIPT_TOOL_NAME = 'get_next_line'

/** The client-tool contract the agent sees: one JSON line per call. */
export function scriptToolPayload() {
  return {
    tool_config: {
      type: 'client',
      name: SCRIPT_TOOL_NAME,
      description:
        'Returns the exact next line of the session as {"kind": "speak" | "checkin" | "wait" | "end", "line": "..."}. Call it once per user turn, only after the user speaks. Say the "line" word for word, including every <break> tag, and nothing else. "checkin" = a question: say it, then listen. "speak" = say it in one turn. "wait" = stay silent. "end" = end the call.',
      // Block the conversation until the browser returns the next line.
      expects_response: true,
      response_timeout_secs: 10,
      // Calm speaks long guided lines. A TV, a fan or someone talking in the
      // next room must not cut her off mid-sentence, so ignore interruptions
      // while the tool runs and while she delivers the line that follows it.
      // The mic is live again between turns, where the check-in answers are.
      interruption_mode: 'disable_during_tool_and_turn',
      parameters: {
        type: 'object',
        properties: {
          stage: {
            type: 'string',
            description:
              'Where you are in the flow: "pace" = ask the pace question again (only when the first answer was unclear), "script" = the next line of the session.',
            enum: ['pace', 'script'],
          },
          pace: {
            type: 'string',
            description: 'The pace the user chose, only for stage "script".',
            enum: ['slow', 'medium', 'fast'],
          },
        },
        required: ['stage'],
      },
    },
  }
}

let scriptToolId = null

/**
 * Find-or-create the workspace tool and return its id.
 *
 * The tool description is part of the agent's context, so an existing tool is
 * re-synced with the current description on every session start — otherwise
 * edits to the contract in scriptToolPayload() would never reach the model.
 */
async function ensureScriptTool() {
  if (scriptToolId) return scriptToolId
  try {
    const list = await elCall('/convai/tools')
    const tools = Array.isArray(list) ? list : list?.tools || []
    const found = tools.find(
      (t) => (t?.tool_config?.name || t?.name) === SCRIPT_TOOL_NAME,
    )
    if (found?.id) {
      scriptToolId = found.id
      await syncScriptTool(scriptToolId)
      return scriptToolId
    }
  } catch (err) {
    if (err?.status !== 404) throw err
  }
  const created = await elCall('/convai/tools', {
    method: 'POST',
    body: JSON.stringify(scriptToolPayload()),
  })
  if (!created?.id) throw new Error('Tool creation returned no id')
  scriptToolId = created.id
  return scriptToolId
}

/** Push the current tool contract (description + schema) to the workspace. */
async function syncScriptTool(toolId) {
  try {
    await elCall(`/convai/tools/${encodeURIComponent(toolId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ tool_config: scriptToolPayload().tool_config }),
    })
  } catch (err) {
    // A stale tool must not break the session — the agent still works with
    // the description it already has.
    console.warn('[relaxation] tool sync skipped:', err?.message || err)
  }
}

/** Idempotent single source of truth for the agent configuration. */
export function conversationConfig(voiceId, toolId) {
  return {
    agent: {
      language: 'en',
      // first_message lives on the agent block in the current API schema.
      // The greeting carries the pace question, so the session opens with the
      // choice already in front of the user.
      first_message: "Hello there, how are you doing today?",
      // Don't let a quick "hi" (or room noise) clip the greeting.
      disable_first_message_interruptions: true,
      prompt: {
        prompt: INSTRUCTOR_PROMPT,
        tool_ids: toolId ? [toolId] : [],
        // Per-turn output ceiling only (a cap, not usage). The longest line is
        // ~150 tokens with its pause tags, so this never truncates a line.
        max_tokens: 300,
        // One line per user turn: parallel calls would fetch the next line
        // twice and double the LLM work.
        enable_parallel_tool_calls: false,
      },
    },
    conversation: {
      text_only: false,
    },
    // Turn detection: no speculative turns (a speculative turn can be started
    // and then cancelled when the user keeps talking, orphaning the tool call
    // and leaving the agent silent). On this agent interruptions are disabled
    // while Calm speaks, so don't transcribe room chatter and carry it into
    // the next turn as if it were the user's answer.
    turn: {
      speculative_turn: false,
      transcribe_on_disabled_interruptions: false,
      // Wait for a clearer turn instead of pouncing on a short far-away voice.
      turn_eagerness: 'patient',
    },
    // Filter secondary speakers picked up by the microphone. Without this a
    // loud voice across the room is treated as the user and interrupts Calm.
    vad: {
      background_voice_detection: true,
    },
    tts: {
      voice_id: voiceId,
      // This agent is exclusive to the Relaxation tab (nothing else connects
      // to it). Eleven v4 / v4 Turbo silently drop SSML <break> tags, which
      // collapsed slow/medium/fast into the same delivery. The v2 engines
      // honour <break time="x.xs" />, and turbo v2 is the lowest-latency
      // model the Agents API accepts for English, so the pace tables in
      // instructor.ts actually produce different silence between cues.
      model_id: 'eleven_turbo_v2',
    },
  }
}

async function createInstructorAgent(voiceId) {
  const toolId = await ensureScriptTool()
  const json = await elCall('/convai/agents/create', {
    method: 'POST',
    body: JSON.stringify({
      name: INSTRUCTOR_AGENT_NAME,
      conversation_config: conversationConfig(voiceId, toolId),
    }),
  })
  if (!json?.agent_id) throw new Error('Agent creation returned no agent_id')
  return json.agent_id
}

async function agentExists(id) {
  try {
    await elCall(`/convai/agents/${encodeURIComponent(id)}`)
    return true
  } catch (err) {
    if (err?.status === 404) return false
    throw err
  }
}

/** Create once, cache in memory; validate every call and recreate if deleted.
 * Also reuses an agent created by a previous server run (matched by name),
 * so restarts never pile up duplicate agents on the account. */
async function getInstructorAgentId(voiceId) {
  // Trust the in-memory id: re-validating it on every session start costs a
  // round-trip on the critical path. If the agent was deleted, the token call
  // 404s and POST /session retries once with a fresh lookup.
  if (instructorAgentId) return instructorAgentId
  if (process.env.ELEVENLABS_AGENT_ID) {
    if (await agentExists(process.env.ELEVENLABS_AGENT_ID)) {
      instructorAgentId = process.env.ELEVENLABS_AGENT_ID
      return instructorAgentId
    }
  }
  try {
    const { agents = [] } = await elCall('/convai/agents')
    const existing = agents.find((a) => a.name === INSTRUCTOR_AGENT_NAME)
    if (existing?.agent_id) {
      instructorAgentId = existing.agent_id
      return instructorAgentId
    }
  } catch (err) {
    // Listing requires convai read; if it fails, fall through to creation.
    if (err?.status !== 404 && err?.status !== 403) throw err
  }
  instructorAgentId = await createInstructorAgent(voiceId)
  return instructorAgentId
}

/**
 * Keep the shared agent's config in lock-step with this file: PATCHing on
 * every session start is idempotent and cheap, and it means prompt/tool edits
 * land on the already-created agent without manual dashboard surgery.
 */
async function syncInstructorAgent(agentId, voiceId) {
  const toolId = await ensureScriptTool()
  const config = conversationConfig(voiceId, toolId)
  // Only PATCH when something actually changed. This used to run on every
  // session start and added ~1s before the microphone was even requested.
  const fingerprint = `${agentId}|${JSON.stringify(config)}`
  if (syncedFingerprint === fingerprint) return
  await elCall(`/convai/agents/${encodeURIComponent(agentId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ conversation_config: config }),
  })
  syncedFingerprint = fingerprint
}

/**
 * GET /voices — up to MAX_VOICE_OPTIONS voices from the same ElevenLabs
 * account, shaped for the picker UI.
 */
relaxationRoutes.get('/voices', requireAuth, async (_req, res) => {
  try {
    // listVoices() returns a flat array of {id, name, preview_url, labels}.
    const voiceList = await cachedVoices()
    const options = voiceList.slice(0, MAX_VOICE_OPTIONS).map((v) => ({
      voice_id: v.voice_id || v.id, // listVoices() maps ids under .id
      name: v.name,
      labels: v.labels || {},
      preview_url: v.preview_url || null,
    }))
    res.json({ voices: options })
  } catch (err) {
    console.error('[relaxation] list voices failed:', err?.message || err)
    res.status(502).json({ error: 'Voice catalogue unavailable' })
  }
})

/**
 * POST /session { voiceId? } — validate the voice, ensure the agent exists,
 * and return a short-lived signed URL for the browser WebSocket session.
 */
/**
 * POST /transcribe - transcribe user audio using Groq Whisper (no LLM)
 */
relaxationRoutes.post('/transcribe', requireAuth, voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'An audio file is required.' })
    }
    const text = await groqTranscribe({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || 'audio/wav',
      filename: req.file.originalname || 'voice.wav',
    })
    if (!text) {
      return res.status(400).json({ error: 'Could not hear you — please try again.' })
    }
    res.json({ text })
  } catch (err) {
    console.error('[relaxation] transcribe failed:', err?.message || err)
    res.status(500).json({ error: err?.message || 'Transcription failed' })
  }
})

/**
 * POST /session - kept for backwards compatibility but now returns a simple token
 * pointing to the direct voice pipeline (no ConvAI agent required)
 */
/**
 * GET /sessions - list relaxation sessions for the current user
 */
relaxationRoutes.get('/sessions', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const sessions = await prisma.relaxationSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    res.json({ sessions })
  } catch (err) {
    console.error('[relaxation] list sessions failed:', err?.message || err)
    res.status(500).json({ error: 'Could not load sessions' })
  }
})

/**
 * POST /sessions - record a completed relaxation session
 */
relaxationRoutes.post('/sessions', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })
    const { voiceId, creditsUsed, durationSec } = req.body || {}
    const session = await prisma.relaxationSession.create({
      data: {
        userId,
        voiceId: typeof voiceId === 'string' ? voiceId : null,
        creditsUsed: Number.isFinite(creditsUsed) ? Math.max(0, Math.round(creditsUsed)) : 0,
        durationSec: Number.isFinite(durationSec) ? Math.max(0, Math.round(durationSec)) : 0,
      },
    })
    res.status(201).json({ session })
  } catch (err) {
    console.error('[relaxation] create session failed:', err?.message || err)
    res.status(500).json({ error: 'Could not save session' })
  }
})

relaxationRoutes.post('/session', requireAuth, async (req, res) => {
  try {
    const voiceId = typeof req.body?.voiceId === 'string' && req.body.voiceId ? req.body.voiceId : null
    let resolvedVoiceId = DEFAULT_INSTRUCTOR_VOICE_ID
    if (voiceId) {
      const voiceList = await cachedVoices()
      const match = voiceList.find((v) => (v.voice_id || v.id) === voiceId)
      if (!match) return res.status(400).json({ error: 'Unknown voice' })
      resolvedVoiceId = voiceId
    }
    // Return a dummy token/session info for the new pipeline
    res.json({ agentId: 'direct-pipeline', token: 'direct', voiceId: resolvedVoiceId })
  } catch (err) {
    console.error('[relaxation] session start failed:', err?.message || err)
    res.status(502).json({ error: 'Voice instructor unavailable. Please try again shortly.' })
  }
})
