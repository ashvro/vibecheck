import { Conversation } from '@elevenlabs/client'
import { api, getUser } from './api'

const VOICE_KEY = 'vibecheck:relaxVoice'

export interface InstructorVoice {
  voice_id: string
  name: string
  labels: Record<string, string>
  preview_url: string | null
}

export function getSavedVoiceId(): string | null {
  try {
    return localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}

export function saveVoiceId(id: string) {
  try {
    localStorage.setItem(VOICE_KEY, id)
  } catch {
    /* private mode */
  }
}

export async function fetchInstructorVoices(): Promise<InstructorVoice[]> {
  const res = await api.get<{ voices: InstructorVoice[] }>('/api/relaxation/voices')
  return res?.voices ?? []
}

export type InstructorPhase = 'listening' | 'speaking'
export type InstructorStatus = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected'

export const SESSION_TOKEN_BUDGET = 350

export type Pace = 'slow' | 'medium' | 'fast'

export const TIMING = {
  deadline: { slow: 150, medium: 120, fast: 105 } as Record<Pace, number>,
  rate: { slow: 2.35, medium: 2.7, fast: 3.1 } as Record<Pace, number>,
  reply: { slow: 6, medium: 5, fast: 4 } as Record<Pace, number>,
  silenceTimeout: 6,
  latency: 1.2,
}

const PACE_DEADLINE = TIMING.deadline
const RATE = TIMING.rate
const USER_REPLY = TIMING.reply
const TOOL_LATENCY = TIMING.latency
const TOKEN_RESERVE = 40
// v4 silently dropped <break> tags, so this used to be the only thing that
// made a "slow" session long. Now that the relaxation agent runs on a model
// that honours breaks, the pace lives in the cues themselves; a big trailing
// pause would just leave the goodbye hanging in silence.
const MAX_TRAILING_FILL = 1.5

interface Segment {
  text: string
  pause: (pace: Pace) => number
  priority: 0 | 1 | 2
}

interface Beat {
  kind: 'speak' | 'checkin'
  segments: Segment[]
  essential?: boolean
}

interface Step {
  id: string
  beats: Beat[]
}

const seg = (text: string, pause: (p: Pace) => number, priority: 0 | 1 | 2 = 0): Segment => ({
  text,
  pause,
  priority,
})

const P = (slow: number, medium: number, fast: number) => (pace: Pace) => ({ slow, medium, fast }[pace])
const GAP = P(3, 2, 1.5)
const VIS = P(3, 3, 3)
const CHIN = P(2, 1, 0.5)
const ROLL = P(3, 2, 1)
const SHORT = P(1.5, 1, 0.5)
const NONE = P(0, 0, 0)



const CONTINUE_OR_END = 'Would you like to continue, or end the session?'
const AFTER_SESSION = "Let's finish the session first."
const SAFETY = 'Please stop the exercise and rest. If it continues, please talk to a doctor.'
const GOODBYE_EARLY = 'No problem. Come back whenever you need to relax.'
const PAUSE_LINE = 'Of course, take your time. Tell me when you are ready.'

const STEPS: Step[] = [
  {
    id: 'pace',
    beats: [
      {
        kind: 'checkin',
        essential: true,
        segments: [seg('You must be exhausted or tired. Are you ready to relax your mind? What pace would you like? Slow, medium, or fast?', NONE, 0)],
      },
    ],
  },
  {
    id: 'breathing',
    beats: [
      {
        kind: 'checkin',
        essential: true,
        segments: [
          seg("Alright, let's begin. Close your eyes. Breathe in...", GAP, 0),
          seg('Breathe out...', GAP, 0),
          seg('Breathe in...', GAP, 0),
          seg('Breathe out...', GAP, 0),
          seg('Keep your eyes closed. How do you feel?', NONE, 0),
        ],
      },
    ],
  },
  {
    id: 'visualization',
    beats: [
      {
        kind: 'checkin',
        essential: true,
        segments: [
          seg('I want you to keep your eyes closed until I tell you to open them.', VIS, 0),
          seg('Imagine yourself sitting beside a beautiful calm ocean.', VIS, 0),
          seg('Feel the soft sand beneath you', VIS, 0),
          seg('and listen to the gentle waves.', VIS, 0),
          seg('With every breath,', VIS, 0),
          seg('feel yourself become lighter.', VIS, 0),
          seg('How do you feel now?', NONE, 0),
        ],
      },
    ],
  },
  {
    id: 'headpalms',
    beats: [
      {
        kind: 'speak',
        essential: true,
        segments: [
          seg('Rub your palms together until warm.', SHORT, 0),
          seg('Place them gently over your eyes.', SHORT, 0),
          seg('Slowly open your eyes.', NONE, 0),
        ],
      },
    ],
  },
  {
    id: 'closing',
    beats: [
      {
        kind: 'speak',
        essential: true,
        segments: [seg("Alright, that's it for the session. Come back anytime.", NONE, 0)],
      },
    ],
  },
]

const STEP_WINDOWS: Record<Pace, Record<string, number>> = {
  slow: { breathing: 36, visualization: 122, headpalms: 138, closing: 150 },
  medium: { breathing: 28, visualization: 63, headpalms: 108, closing: 120 },
  fast: { breathing: 24, visualization: 57, headpalms: 94, closing: 105 },
}

function paceOf(text?: string): Pace | null {
  const t = (text || '').toLowerCase()
  if (/\b(slow|relaxed|relax|long|deep|gentle)\b/.test(t)) return 'slow'
  if (/\b(fast|quick|short|brisk|lively)\b/.test(t)) return 'fast'
  // "okay"/"ok" are acknowledgments, not a pace: treating them as "medium"
  // used to lock the pace from an answer to the greeting.
  if (/\b(medium|normal|steady)\b/.test(t)) return 'medium'
  return null
}

function isStopRequest(text?: string): boolean {
  const t = (text || '').toLowerCase()
  return /\b(stop|end it|finish|quit|done|i'?m done|that'?s enough|stop the session|end the session)\b/.test(t)
}

function isDistress(text?: string): boolean {
  const t = (text || '').toLowerCase()
  return /\b(pain|painful|dizzy|dizziness|vertigo|nausea|nauseous|headache|chest|hurts?|hurting)\b/.test(t)
}

function isPauseRequest(text?: string): boolean {
  const t = (text || '').toLowerCase()
  return /\b(pause|wait|hold on|one moment|give me a moment)\b/.test(t)
}

export interface ScriptRunner {
  hearUser: (text: string) => void
  clientTools: { get_next_line: (parameters: { stage?: string; pace?: string }) => Promise<string> }
  status: () => ScriptStatus
  /** Call once the transport connects: bounds the greeting guard. */
  markConnected: () => void
}

export interface ScriptStatus {
  phase: 'pace' | 'script' | 'done'
  pace: Pace | null
  elapsed: number
  tokens: number
  remainingTokens: number
  remainingSeconds: number
  awaitingReply: boolean
  answered: number
  step: string
}

type RunnerPhase = ScriptStatus['phase']

export function createScriptRunner(now: () => number = () => Date.now()): ScriptRunner {
  let startedAt: number | null = null
  const elapsed = () => (startedAt === null ? 0 : (now() - startedAt) / 1000)

  let phase: RunnerPhase = 'pace'
  let pace: Pace | null = null
  let userPace: Pace | null = null
  let modelPace: Pace | null = null
  let paceReasked = false
  let paceAsked = false
  let tokens = 0
  let answered = 0

  let stepIndex = 0
  let beatIndex = 0

  let awaiting: 'checkin' | 'confirm' | null = null
  let pendingAt: { stepIndex: number; beatIndex: number } | null = null
  let pendingConfirm: string | null = null
  let pendingSafety: string | null = null
  let pendingGoodbye: string | null = null
  let pendingNote: string | null = null
  let pendingPause: boolean = false

  let stopped = false
  let questionAskedAt: number | null = null
  /** True once the user has said anything: the greeting is still unanswered. */
  let heardUser = false
  /** Set when the transport is connected; used to time out the greeting guard. */
  let connectedAt: number | null = null

  const activePace = (): Pace => pace ?? 'medium'
  const deadline = () => PACE_DEADLINE[activePace()]
  const windowEndFor = (stepId: string): number => {
    const w = STEP_WINDOWS[activePace()]?.[stepId]
    return w ? w : deadline()
  }

  const resolvePace = (): Pace => userPace ?? (paceReasked ? 'medium' : modelPace ?? 'medium')

  const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

  const hearUser = (text: string) => {
    const raw = (text || '').trim()
    if (!raw) return
    heardUser = true
    // Our own stall-watchdog nudges arrive back as "user" turns; they are not
    // answers and must never consume a check-in or open a confirm prompt.
    if (/^(okay|ok)[.!]?$|^i'?m still here[.!]?$/i.test(raw)) return
    const lower = raw.toLowerCase()

    if (isDistress(lower)) {
      pendingSafety = SAFETY
      awaiting = null
      return
    }

    if (awaiting === 'confirm') {
      awaiting = null
      if (/\b(end|stop|finish|quit|no|done)\b/.test(lower)) {
        stopped = true
        phase = 'done'
        pendingGoodbye = GOODBYE_EARLY
      } else {
        const heard = paceOf(lower)
        if (heard) {
          userPace = heard
          pace = heard
        }
        pendingPause = false
      }
      return
    }

    // Pace answer (the pace question) or an explicit mid-session pace change.
    const heardPace = paceOf(lower)
    const wantsChange = /\b(make it|change|switch|actually|instead|faster|slower|let'?s (do|try))\b/.test(lower)
    const awaitingPace = awaiting === 'checkin' && STEPS[stepIndex]?.id === 'pace'
    if (heardPace && (wantsChange || awaitingPace || !paceAsked)) {
      userPace = heardPace
      pace = heardPace
      phase = 'script'
      if (startedAt === null) startedAt = now()
      // Move past the pending question: this reply was about pace, not feeling.
      if (awaiting === 'checkin') {
        awaiting = null
        if (pendingAt) {
          stepIndex = pendingAt.stepIndex
          beatIndex = pendingAt.beatIndex + 1
          pendingAt = null
        }
      }
      return
    }

    if (isPauseRequest(lower)) {
      pendingPause = true
      return
    }

    if (awaiting === 'checkin') {
      if (isStopRequest(lower)) {
        awaiting = null
        return
      }
      // A question is not an answer — defer it and keep the session moving.
      if (raw.includes('?')) {
        awaiting = null
        if (pendingAt) {
          stepIndex = pendingAt.stepIndex
          beatIndex = pendingAt.beatIndex + 1
          pendingAt = null
        }
        pendingNote = AFTER_SESSION
        return
      }
      awaiting = null
      answered += 1
      if (pendingAt) {
        stepIndex = pendingAt.stepIndex
        beatIndex = pendingAt.beatIndex + 1
        pendingAt = null
      }
      return
    }

    if (isStopRequest(lower)) {
      return
    }

    if (raw.includes('?')) {
      pendingNote = AFTER_SESSION
      return
    }

    if (words(raw) >= 2 && phase === 'pace' && !userPace) return

    if (words(raw) >= 2) {
    }
  }

  const toolResult = (kind: string, line: string) => JSON.stringify({ kind, line })

  const renderText = (text: string): string => text

  const wordCount = (text: string): number => {
    const spoken = text.replace(/<break[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return spoken ? spoken.split(' ').filter(Boolean).length : 0
  }

  const segmentDuration = (segment: Segment, pace: Pace): number =>
    wordCount(segment.text) / RATE[pace] + segment.pause(pace)

  const renderSegments = (segments: Segment[], extraPause: number, pace: Pace): string =>
    segments
      .map((s, i) => {
        const last = i === segments.length - 1
        const pause = s.pause(pace) + (last ? extraPause : 0)
        const text = renderText(s.text)
        if (pause <= 0) return text
        // Chain break tags; never exceed 3s in a single tag.
        const tags: string[] = []
        let remaining = pause
        while (remaining > 0.05) {
          const chunk = Math.min(3, remaining)
          tags.push(`<break time="${chunk.toFixed(1)}s" />`)
          remaining -= chunk
        }
        return `${text} ${tags.join(' ')}`
      })
      .join(' ')

  const fitSegments = (beat: Beat, windowEnd: number, pace: Pace): Segment[] => {
    const overhead = TOOL_LATENCY + (beat.kind === 'checkin' ? USER_REPLY[pace] : 0)
    let used = elapsed() + overhead
    const keep = new Set<Segment>()
    for (const priority of [0, 1, 2] as const) {
      for (const segment of beat.segments) {
        if (segment.priority !== priority || keep.has(segment)) continue
        const dur = segmentDuration(segment, pace)
        if (priority === 0 || used + dur <= windowEnd) {
          keep.add(segment)
          used += dur
        }
      }
    }
    return beat.segments.filter((s) => keep.has(s))
  }

  const nextBeat = (): { beat: Beat; step: Step; line: string; stepIndex: number; beatIndex: number } | null => {
    const pace = activePace()
    let si = stepIndex
    let bi = beatIndex

    while (si < STEPS.length) {
      const step = STEPS[si]
      // Never serve the pace question twice: once it has been asked (or a pace
      // is already known), move on. This also covers the agent speaking the
      // question from the prompt instead of the tool.
      if (step.id === 'pace' && (userPace || paceAsked)) {
        si += 1
        bi = 0
        continue
      }
      // The session clock starts when the pace is chosen; for the first timed
      // step, fall back to "now" if no pace word was ever heard.
      if (step.id !== 'pace' && startedAt === null) startedAt = now()
      const windowEnd = step.id === 'pace' ? Infinity : Math.min(windowEndFor(step.id), deadline())
      const beat = step.beats[bi]
      if (!beat) {
        si += 1
        bi = 0
        continue
      }

      const segments = fitSegments(beat, windowEnd, pace)
      if (!segments.length) {
        bi += 1
        continue
      }

      const spoken = segments.reduce((n, s) => n + segmentDuration(s, pace), 0)
      const overhead = TOOL_LATENCY + (beat.kind === 'checkin' ? USER_REPLY[pace] : 0)
      const dur = spoken + overhead
      const fill =
        beat.kind === 'speak'
          ? Math.min(MAX_TRAILING_FILL, Math.max(0, windowEnd - elapsed() - dur))
          : 0
      const line = renderSegments(segments, fill, pace)
      const lineTokens = Math.ceil(line.length / 4)
      const core = beat.segments.filter((s) => s.priority <= 1)
      const coreDur = core.reduce((n, s) => n + segmentDuration(s, pace), 0)
      const fits = elapsed() + coreDur + overhead <= deadline()
      const fitsTokens = tokens + lineTokens <= SESSION_TOKEN_BUDGET - TOKEN_RESERVE

      if (beat.essential || (fits && fitsTokens)) {
        return { beat, step, line, stepIndex: si, beatIndex: bi }
      }
      bi += 1
    }
    return null
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  /** Poll until `done()` or the deadline; used to absorb transcript races. */
  const waitUntil = async (ms: number, done: () => boolean) => {
    const until = Date.now() + ms
    while (!done() && Date.now() < until) await sleep(50)
  }

  const clientTools = {
    get_next_line: async (parameters: { stage?: string; pace?: string }) => {
      const requested = parameters?.stage || 'script'

      if (parameters?.pace) {
        const claimed = paceOf(parameters.pace)
        if (claimed) modelPace = claimed
      }

      if (stopped && !pendingGoodbye) return Promise.resolve(toolResult('end', ''))

      // The session opens with the platform's fixed greeting. The model must
      // not fetch a line before the user has replied, otherwise it talks over
      // the greeting (two voices at once). Nothing is owed before then. If the
      // transcript never arrives, give up after the greeting has certainly
      // finished so a missing event can never deadlock the session.
      if (!heardUser) {
        await waitUntil(800, () => heardUser)
        const greetingDone = connectedAt !== null && now() - connectedAt > 6000
        if (!heardUser && !greetingDone) return toolResult('wait', '')
      }

      // Pace stage: ask the pace question again if the answer was unclear.
      if (requested === 'pace' && !paceReasked && !userPace) {
        paceReasked = true
        paceAsked = true
        phase = 'pace'
        return Promise.resolve(toolResult('checkin', 'You must be exhausted or tired. Are you ready to relax your mind? What pace would you like? Slow, medium, or fast?'))
      }

      if (!pace) pace = resolvePace()

      if (pendingSafety) {
        const line = pendingSafety
        pendingSafety = null
        stopped = true
        phase = 'done'
        tokens += Math.ceil(line.length / 4)
        return Promise.resolve(toolResult('speak', line))
      }

      if (pendingGoodbye) {
        const line = pendingGoodbye
        pendingGoodbye = null
        tokens += Math.ceil(line.length / 4)
        return Promise.resolve(toolResult('speak', line))
      }

      if (pendingNote) {
        const line = pendingNote
        pendingNote = null
        tokens += Math.ceil(line.length / 4)
        return Promise.resolve(toolResult('speak', line))
      }

      if (pendingPause) {
        pendingPause = false
        return Promise.resolve(toolResult('speak', PAUSE_LINE))
      }

      // A check-in was served. The agent only speaks again once the user has
      // replied, but the transcript can arrive a moment after the tool call.
      // Give it a brief moment, then move on regardless: a missing transcript
      // must never deadlock the session. Same-turn duplicate calls still wait.
      if (awaiting === 'checkin') {
        const sinceMs = questionAskedAt === null ? Infinity : now() - questionAskedAt
        if (sinceMs < 700) return toolResult('wait', '')
        await waitUntil(700, () => awaiting !== 'checkin')
        if (awaiting === 'checkin') {
          awaiting = null
          answered += 1
          if (pendingAt) {
            stepIndex = pendingAt.stepIndex
            beatIndex = pendingAt.beatIndex + 1
            pendingAt = null
          }
        }
      }

      if (awaiting) return toolResult('wait', '')

      phase = 'script'

      const picked = nextBeat()
      if (!picked) {
        phase = 'done'
        return Promise.resolve(toolResult('end', ''))
      }
      const { beat, line, stepIndex: si, beatIndex: bi } = picked
      tokens += Math.ceil(line.length / 4)

      if (beat.kind === 'checkin') {
        if (STEPS[si]?.id === 'pace') paceAsked = true
        awaiting = 'checkin'
        stepIndex = si
        beatIndex = bi
        pendingAt = { stepIndex: si, beatIndex: bi }
        questionAskedAt = now()
        return Promise.resolve(toolResult('checkin', line))
      }

      beatIndex = bi + 1
      stepIndex = si
      if (beatIndex >= STEPS[si].beats.length) {
        stepIndex += 1
        beatIndex = 0
      }
      return Promise.resolve(toolResult('speak', line))
    },
  }

  const status = (): ScriptStatus => ({
    phase,
    pace,
    elapsed: elapsed(),
    tokens,
    remainingTokens: Math.max(0, SESSION_TOKEN_BUDGET - tokens),
    remainingSeconds: Math.max(0, deadline() - elapsed()),
    awaitingReply: awaiting !== null,
    answered,
    step: STEPS[Math.min(stepIndex, STEPS.length - 1)]?.id ?? 'done',
  })

  return {
    hearUser,
    clientTools,
    status,
    markConnected: () => {
      connectedAt = now()
    },
  }
}

export interface InstructorCallbacks {
  onMessage: (message: string, role: 'agent' | 'user') => void
  onPhase: (phase: InstructorPhase | null) => void
  onStatus: (status: InstructorStatus) => void
  onError: (message: string) => void
  /** Server-side voice activity score (0..1) for the user's microphone. */
  onVad?: (score: number) => void
  clientTools?: { get_next_line: (parameters: { stage?: string; pace?: string }) => Promise<string> }
}

export async function startInstructor(voiceId: string | null, cb: InstructorCallbacks) {
  const session = await api.post<{ agentId: string; token: string; voiceId: string }>(
    '/api/relaxation/session',
    voiceId ? { voiceId } : {},
  )
  const rawName = getUser()?.name
  const name = typeof rawName === 'string' ? rawName : undefined
  const conversation = (await Conversation.startSession({
    conversationToken: session.token,
    connectionType: 'webrtc',
    textOnly: false,
    overrides: { tts: { voiceId: session.voiceId } },
    dynamicVariables: name ? { user_name: name } : undefined,
    clientTools: cb.clientTools,
    // NOTE: the SDK reads callbacks from the top level of the options object
    // (there is no nested `callbacks` key). Nesting them silently disables
    // transcripts, mode/status changes and errors.
    onMessage: (m: any) => cb.onMessage(m.message, m.role === 'user' ? 'user' : 'agent'),
    onModeChange: (p: { mode: any }) => cb.onPhase(p.mode),
    onVadScore: (p: { vadScore: number }) => cb.onVad?.(p.vadScore),
    onStatusChange: (p: { status: any }) => cb.onStatus(p.status),
    onError: (message: any) => cb.onError(String(message)),
  })) as any
  return conversation
}

export function breakTagsForDisplay(text: string): string {
  return text.replace(/\s*<break\s+time="[^"]*"\s*\/>\s*/gi, ' ').trim()
}
