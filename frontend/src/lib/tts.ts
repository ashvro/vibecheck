import { getToken } from './api'

export type TtsProvider = string | null

let providerCache: TtsProvider | undefined
let ttsStatusCache: { provider: TtsProvider; model?: string; defaultVoiceId?: string } | null = null
let voicesCache: Array<{ id: string; name: string; preview_url?: string | null }> | null = null

export async function getTtsStatus(): Promise<{ provider: TtsProvider; model?: string; defaultVoiceId?: string }> {
  if (ttsStatusCache) return ttsStatusCache
  try {
    const res = await fetch('/api/assistant/tts/status')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { provider?: string | null; model?: string; defaultVoiceId?: string }
    ttsStatusCache = { provider: data.provider ?? null, model: data.model, defaultVoiceId: data.defaultVoiceId }
  } catch {
    // Deliberately NOT cached: a page that loads before the backend (or a
    // transient network blip) used to lock in "no provider" for the rest of
    // the session, which silently hid the voice picker even though voices
    // were available. Failures are retried on the next mount instead.
    return { provider: null }
  }
  return ttsStatusCache
}

export async function getTtsProvider(): Promise<TtsProvider> {
  const s = await getTtsStatus()
  providerCache = s.provider
  return providerCache
}

export function resetTtsProviderCache() {
  providerCache = undefined
  ttsStatusCache = null
}

/**
 * Shared AudioContext for neural playback. Creating one is slow (~50-150ms of
 * cold start on some machines) and the first spoken chunk cannot begin until it
 * exists, so we create it once during prewarm and reuse it for every turn.
 */
let sharedCtx: AudioContext | null = null

function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext()
  if (sharedCtx.state === 'suspended') void sharedCtx.resume()
  return sharedCtx
}

/**
 * Resolves the TTS provider and builds the audio context ahead of the first
 * turn, so the reply can start speaking the moment its first words arrive
 * instead of paying the lookup and cold-start cost at that exact moment.
 */
export async function warmTts(): Promise<void> {
  await getTtsProvider().catch(() => undefined)
  if (typeof window === 'undefined') return
  try {
    audioContext()
  } catch {
    /* no audio in this environment */
  }
}

const VOICE_KEY = 'vibecheck:voiceId'

export function getSelectedVoiceId(): string | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(VOICE_KEY)
}

export function setSelectedVoiceId(id: string | null) {
  if (typeof localStorage === 'undefined') return
  if (id) localStorage.setItem(VOICE_KEY, id)
  else localStorage.removeItem(VOICE_KEY)
}

export async function listTtsVoices(): Promise<Array<{ id: string; name: string; preview_url?: string | null }>> {
  // The voice list does not change while the app is open, so it is fetched
  // once — the assistant tab remounts on every tab switch and used to refetch
  // this list each time. Only a non-empty list is cached: an empty response
  // (backend still booting, transient failure) must be retried rather than
  // hiding the voice picker for the rest of the session.
  if (voicesCache) return voicesCache
  try {
    const res = await fetch('/api/assistant/voices')
    if (!res.ok) return []
    const data = await res.json()
    const list = Array.isArray(data.voices) ? data.voices : []
    if (list.length) voicesCache = list
    return list
  } catch {
    return []
  }
}

function browserSupported(): boolean {
  return typeof window !== 'undefined' && typeof speechSynthesis !== 'undefined'
}

let voicesReady: Promise<void> | null = null

function waitForVoices(): Promise<void> {
  voicesReady ??= new Promise((resolve) => {
    if (!browserSupported()) {
      resolve()
      return
    }
    if (speechSynthesis.getVoices().length) {
      resolve()
      return
    }
    const onVoices = () => {
      speechSynthesis.removeEventListener('voiceschanged', onVoices)
      resolve()
    }
    speechSynthesis.addEventListener('voiceschanged', onVoices)
  })
  return voicesReady
}

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (!browserSupported()) return null
  const voices = speechSynthesis.getVoices()
  if (!voices.length) return null
  const preferred = ['Google US English', 'Microsoft Aria', 'Microsoft Zira', 'Samantha', 'Daniel']
  for (const label of preferred) {
    const found = voices.find((v) => v.name.includes(label))
    if (found) return found
  }
  for (const label of ['Samantha', 'Alex', 'Google US English', 'Microsoft Aria', 'Microsoft Zira', 'Daniel']) {
    const found = voices.find((v) => v.name.includes(label))
    if (found) return found
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith('en')) ?? voices[0]
}

/**
 * One chunk of speech that has been prepared for playback. Neural TTS carries
 * a decoded buffer; the browser fallback carries only the text. `token` is the
 * speaker generation at prepare time so a chunk queued before an interruption
 * is dropped instead of played late.
 */
type Prepared = {
  text: string
  buffer: AudioBuffer | null
  token: number
}

interface Speaker {
  /** Starts synthesis now so playback can begin with as little delay as possible. */
  prepare(text: string, signal?: AbortSignal): Promise<Prepared>
  play(prepared: Prepared): Promise<void>
  cancel(): void
  readonly active: boolean
}

/** Smoothed 0..1 loudness of whatever is currently being played. */
function rms(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 1) {
    const v = (data[i] - 128) / 128
    sum += v * v
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 2.2)
}

function browserSpeaker(onLevel?: (level: number) => void): Speaker {
  let speaking = false
  let generation = 0
  let raf = 0
  let pulse = 0

  function stopPulse() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    onLevel?.(0)
  }

  function tick() {
    if (!speaking) {
      stopPulse()
      return
    }
    pulse *= 0.86
    onLevel?.(pulse)
    raf = requestAnimationFrame(tick)
  }

  return {
    get active() {
      return speaking
    },
    async prepare(text) {
      return { text, buffer: null, token: generation }
    },
    async play(prepared) {
      if (prepared.token !== generation || !browserSupported() || !prepared.text.trim()) return
      await waitForVoices()
      if (prepared.token !== generation || !browserSupported()) return
      speaking = true
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(prepared.text)
        utterance.voice = pickEnglishVoice()
        utterance.rate = 1.05
        utterance.pitch = 1
        const finish = () => {
          speaking = false
          stopPulse()
          resolve()
        }
        // speechSynthesis gives no audio access, so approximate loudness with a
        // word-boundary pulse to keep the orb alive while it talks.
        utterance.onboundary = () => {
          pulse = 1
          if (!raf) raf = requestAnimationFrame(tick)
        }
        utterance.onend = finish
        utterance.onerror = finish
        speechSynthesis.speak(utterance)
      })
    },
    cancel() {
      generation += 1
      speaking = false
      stopPulse()
      if (browserSupported()) speechSynthesis.cancel()
    },
  }
}

class NeuralSpeaker implements Speaker {
  private sources = new Map<AudioBufferSourceNode, () => void>()
  private generation = 0
  private speakingCount = 0
  private analyser: AnalyserNode | null = null
  private probeRaf = 0
  private onLevel: ((level: number) => void) | undefined
  /** Per-call voice override, used by the Relaxation tab's own picker. */
  private voiceId: string | null | undefined
  /** After one synthesis failure, stop retrying for this turn: the browser
   *  voice can start immediately instead of paying a failed request per chunk. */
  private failed = false
  private fallback: Speaker | null = null

  constructor(onLevel?: (level: number) => void, voiceId?: string | null) {
    this.onLevel = onLevel
    this.voiceId = voiceId
  }

  private browserFallback(): Speaker {
    this.fallback ??= browserSpeaker(this.onLevel)
    return this.fallback
  }

  get active(): boolean {
    return this.speakingCount > 0
  }

  private context(): AudioContext {
    return audioContext()
  }

  /** Taps the output graph so the orb can react to real playback loudness. */
  private startProbe() {
    if (this.probeRaf) return
    const ctx = this.context()
    this.analyser ??= ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.6
    const data = new Uint8Array(this.analyser.frequencyBinCount)
    const tick = () => {
      this.analyser?.getByteFrequencyData(data)
      this.onLevel?.(rms(data))
      this.probeRaf = requestAnimationFrame(tick)
    }
    this.probeRaf = requestAnimationFrame(tick)
  }

  private stopProbe() {
    if (this.probeRaf) cancelAnimationFrame(this.probeRaf)
    this.probeRaf = 0
    this.analyser?.disconnect()
    this.analyser = null
    this.onLevel?.(0)
  }

  async prepare(text: string, signal?: AbortSignal): Promise<Prepared> {
    const token = this.generation
    if (!text.trim()) return { text, buffer: null, token }
    if (this.failed) return { text, buffer: null, token }
    try {
      const auth = getToken()
      const voiceId = this.voiceId ?? getSelectedVoiceId()
      const body: { text: string; voiceId?: string } = { text }
      if (voiceId) body.voiceId = voiceId
      const res = await fetch('/api/assistant/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok || !res.body) throw new Error(`TTS failed (${res.status})`)
      const bytes = await res.arrayBuffer()
      if (token !== this.generation || !bytes.byteLength) return { text, buffer: null, token }

      const ctx = this.context()
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      if (token !== this.generation) return { text, buffer: null, token }
      return { text, buffer, token }
    } catch (err) {
      // An interrupted prefetch is expected, not a failure worth logging.
      if (token === this.generation && (err as Error)?.name !== 'AbortError' && err instanceof Error) {
        this.failed = true
        console.warn('[tts] neural synthesis failed, using browser voice for this turn', err)
      }
      return { text, buffer: null, token }
    }
  }

  async play(prepared: Prepared): Promise<void> {
    if (prepared.token !== this.generation) return
    if (!prepared.buffer) {
      // Neural synthesis failed for this turn — speak it with the browser voice
      // (with a fresh token so this playback is not dropped as stale). Keep the
      // speaker counted as active so the orb/UI still knows we are talking, and
      // reuse one fallback instance so an interruption can cancel it.
      this.speakingCount += 1
      try {
        await this.browserFallback().play({ text: prepared.text, buffer: null, token: 0 })
      } finally {
        this.speakingCount = Math.max(0, this.speakingCount - 1)
      }
      return
    }

    this.speakingCount += 1
    try {
      const ctx = this.context()
      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource()
        source.buffer = prepared.buffer
        this.startProbe()
        source.connect(this.analyser!)
        this.analyser!.connect(ctx.destination)
        source.onended = () => {
          this.sources.delete(source)
          resolve()
        }
        // Keep the resolver so cancel() can settle an in-flight play instead of
        // leaving this promise dangling forever.
        this.sources.set(source, resolve)
        source.start()
      })
    } finally {
      this.speakingCount = Math.max(0, this.speakingCount - 1)
      if (this.speakingCount === 0) this.stopProbe()
    }
  }

  cancel() {
    this.generation += 1
    this.stopProbe()
    // The browser voice is a separate engine: stop it too when the user
    // interrupts during a fallback chunk. Drop the instance afterwards because
    // cancel() advances its token, and the next fallback chunk reuses token 0.
    this.fallback?.cancel()
    this.fallback = null
    for (const [source, settle] of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* already finished */
      }
      settle()
    }
    this.sources.clear()
    this.speakingCount = 0
    // The shared context is deliberately left open: closing it would force a
    // cold start on the very next turn, which is exactly the delay we are
    // trying to remove (especially when interrupting and following up).
  }
}

const SENTENCE_END = /[.!?…]["')\]]?\s/
const CLAUSE_BREAK = /[,;:—–]/
/** Don't start a clause-level chunk until there is at least this much to say. */
const MIN_CHUNK_CHARS = 24
/** Hard cap before we break at a plain word boundary so speech keeps up. */
const MAX_CHUNK_CHARS = 96

/**
 * Length of the next speakable chunk in `pending`, or 0 if nothing is ready.
 * A finished sentence always wins; otherwise we start talking at the first
 * clause boundary once enough text has arrived, so playback begins while the
 * model is still writing the rest of the sentence. `eagerFirst` lets the very
 * first chunk break at a word boundary instead of waiting for punctuation —
 * the opening words are what the student is waiting to hear.
 */
function nextChunkEnd(pending: string, eagerFirst = false): number {
  for (let i = 0; i < pending.length - 1; i += 1) {
    if (SENTENCE_END.test(pending.slice(i, i + 2))) return i + 2
  }
  if (pending.length < MIN_CHUNK_CHARS) return 0
  if (eagerFirst) {
    const cut = pending.indexOf(' ', MIN_CHUNK_CHARS)
    if (cut > MIN_CHUNK_CHARS) return cut + 1
  }

  for (let i = MIN_CHUNK_CHARS - 1; i < pending.length - 1; i += 1) {
    if (CLAUSE_BREAK.test(pending[i]) && /\s/.test(pending[i + 1])) return i + 1
  }
  if (pending.length >= MAX_CHUNK_CHARS) {
    const cut = pending.lastIndexOf(' ', MAX_CHUNK_CHARS)
    if (cut > MIN_CHUNK_CHARS) return cut
  }
  return 0
}

/**
 * Speaks a reply as it streams in, one short chunk at a time, so the first
 * words are audible while the model is still generating the rest. The next
 * chunk is synthesised while the current one plays, so there is no dead air
 * between sentences. Uses neural TTS when a provider is configured, otherwise
 * the browser voice.
 */
export class SpeechStream {
  private cursor = 0
  private queue: string[] = []
  private draining = false
  private generation = 0
  private speaker: Speaker
  private neural: NeuralSpeaker | null = null
  private ready: Promise<void> | null = null
  private idleWaiters: Array<() => void> = []
  private ahead: Promise<Prepared> | null = null
  private aheadText: string | null = null
  private drainAbort: AbortController | null = null
  private playStarted = false
  private onSpeaking: (() => void) | undefined
  private voiceId: string | null | undefined

  /**
   * @param onLevel Live playback loudness 0..1, for the voice orb.
   * @param onSpeaking Fires once when playback actually begins (the first chunk
   *   can be synthesised ahead of time, so `push` alone is not a reliable cue).
   * @param voiceId Optional per-stream voice override (Relaxation picker).
   */
  constructor(onLevel?: (level: number) => void, onSpeaking?: () => void, voiceId?: string | null) {
    this.onSpeaking = onSpeaking
    this.voiceId = voiceId
    this.speaker = browserSpeaker(onLevel)
    this.ready = this.initSpeaker(onLevel)
  }

  private async initSpeaker(onLevel?: (level: number) => void): Promise<void> {
    const provider = await getTtsProvider()
    if (provider) {
      this.neural = new NeuralSpeaker(onLevel, this.voiceId)
      this.speaker = this.neural
    }
  }

  get usingNeural(): boolean {
    return this.neural !== null
  }

  /** True from the first moment audio plays until the queue drains. */
  get speaking(): boolean {
    return this.playStarted || this.speaker.active
  }

  /** Queues every speakable chunk found in the newly grown text. */
  push(fullText: string): void {
    if (fullText.length <= this.cursor) {
      this.cursor = Math.min(this.cursor, fullText.length)
      return
    }
    const pending = fullText.slice(this.cursor)
    let offset = 0
    for (;;) {
      // Before anything has been spoken, cut the opening words at the first
      // word boundary instead of waiting for a clause or sentence.
      const eagerFirst = this.cursor === 0 && offset === 0 && !this.playStarted && this.queue.length === 0
      const end = nextChunkEnd(pending.slice(offset), eagerFirst)
      if (end <= 0) break
      const chunk = pending.slice(offset, offset + end).trim()
      offset += end
      if (chunk) {
        this.queue.push(chunk)
        void this.drain()
      }
    }
    this.cursor += offset
  }

  /** Speaks anything left unsaid once the stream has finished. */
  flush(fullText: string): void {
    const rest = fullText.slice(this.cursor).trim()
    if (rest) this.queue.push(rest)
    this.cursor = fullText.length
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    const token = this.generation
    const abort = new AbortController()
    this.drainAbort = abort

    try {
      await this.ready
      if (token !== this.generation) return

      while (this.queue.length && token === this.generation) {
        const text = this.queue.shift()!
        // Reuse the chunk that was synthesised during the previous one, if any.
        const prepared =
          this.ahead && this.aheadText === text
            ? await this.ahead
            : await this.speaker.prepare(text, abort.signal)
        this.ahead = null
        this.aheadText = null
        if (token !== this.generation) break

        // Warm up the next chunk while this one plays — this removes the silent
        // gap that made the voice agent feel like it kept pausing mid-reply.
        if (this.queue.length) {
          this.aheadText = this.queue[0]
          this.ahead = this.speaker.prepare(this.aheadText, abort.signal)
        }

        if (!this.playStarted) {
          this.playStarted = true
          this.onSpeaking?.()
        }
        try {
          await this.speaker.play(prepared)
        } catch (err) {
          // Never let one bad chunk wedge the queue (and the turn with it).
          console.warn('[tts] playback failed for a chunk', err)
        }
      }
    } finally {
      // Only reconfigure state if this generation still owns the stream; a
      // cancel() already reset everything and a newer drain is in charge.
      if (token === this.generation) {
        this.draining = false
        if (this.queue.length) void this.drain()
        else this.settle(token)
      }
    }
  }

  private settle(token: number) {
    // A newer generation (cancel + re-push) owns the state now — leave it alone.
    if (token !== this.generation) return
    this.draining = false
    this.playStarted = false
    this.ahead = null
    this.aheadText = null
    this.drainAbort = null
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** Resolves when the queue is empty and nothing is being spoken. */
  onIdle(): Promise<void> {
    if (!this.draining && !this.queue.length) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /** Stops playback, drops queued chunks, and aborts in-flight synthesis. */
  cancel(): void {
    this.generation += 1
    this.queue = []
    this.cursor = 0
    this.draining = false
    this.playStarted = false
    this.ahead = null
    this.aheadText = null
    this.drainAbort?.abort()
    this.drainAbort = null
    this.speaker.cancel()
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}
