import { getToken } from './api'

export type TtsProvider = string | null

let providerCache: TtsProvider | undefined

export async function getTtsProvider(): Promise<TtsProvider> {
  if (providerCache !== undefined) return providerCache
  try {
    const res = await fetch('/api/assistant/tts/status')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { provider?: string | null }
    providerCache = data.provider ?? null
  } catch {
    providerCache = null
  }
  return providerCache
}

export function resetTtsProviderCache() {
  providerCache = undefined
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
  private ctx: AudioContext | null = null
  private sources = new Map<AudioBufferSourceNode, () => void>()
  private generation = 0
  private speakingCount = 0
  private analyser: AnalyserNode | null = null
  private probeRaf = 0
  private onLevel: ((level: number) => void) | undefined

  constructor(onLevel?: (level: number) => void) {
    this.onLevel = onLevel
  }

  get active(): boolean {
    return this.speakingCount > 0
  }

  private context(): AudioContext {
    this.ctx ??= new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
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
    try {
      const auth = getToken()
      const res = await fetch('/api/assistant/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify({ text }),
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
        console.warn('[tts] neural synthesis failed, using browser voice', err)
      }
      return { text, buffer: null, token }
    }
  }

  async play(prepared: Prepared): Promise<void> {
    if (prepared.token !== this.generation) return
    if (!prepared.buffer) {
      // Neural synthesis failed for this chunk — speak it with the browser voice
      // (with a fresh token so this playback is not dropped as stale).
      await browserSpeaker(this.onLevel).play({ text: prepared.text, buffer: null, token: 0 })
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
    if (this.ctx?.state !== 'closed') void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}

const SENTENCE_END = /[.!?…]["')\]]?\s/
const CLAUSE_BREAK = /[,;:—–]/
/** Don't start a clause-level chunk until there is at least this much to say. */
const MIN_CHUNK_CHARS = 40
/** Hard cap before we break at a plain word boundary so speech keeps up. */
const MAX_CHUNK_CHARS = 96

/**
 * Length of the next speakable chunk in `pending`, or 0 if nothing is ready.
 * A finished sentence always wins; otherwise we start talking at the first
 * clause boundary once enough text has arrived, so playback begins while the
 * model is still writing the rest of the sentence.
 */
function nextChunkEnd(pending: string): number {
  for (let i = 0; i < pending.length - 1; i += 1) {
    if (SENTENCE_END.test(pending.slice(i, i + 2))) return i + 2
  }
  if (pending.length < MIN_CHUNK_CHARS) return 0

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

  /**
   * @param onLevel Live playback loudness 0..1, for the voice orb.
   * @param onSpeaking Fires once when playback actually begins (the first chunk
   *   can be synthesised ahead of time, so `push` alone is not a reliable cue).
   */
  constructor(onLevel?: (level: number) => void, onSpeaking?: () => void) {
    this.onSpeaking = onSpeaking
    this.speaker = browserSpeaker(onLevel)
    this.ready = this.initSpeaker(onLevel)
  }

  private async initSpeaker(onLevel?: (level: number) => void): Promise<void> {
    const provider = await getTtsProvider()
    if (provider) {
      this.neural = new NeuralSpeaker(onLevel)
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
      const end = nextChunkEnd(pending.slice(offset))
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
