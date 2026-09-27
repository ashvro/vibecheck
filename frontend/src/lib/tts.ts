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

interface Speaker {
  speak(text: string): Promise<void>
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
  let raf = 0
  let pulse = 0
  return {
    get active() {
      return speaking
    },
    async speak(text) {
      if (!browserSupported() || !text.trim()) return
      await waitForVoices()
      if (!browserSupported()) return
      speaking = true
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
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
      speaking = false
      stopPulse()
      if (browserSupported()) speechSynthesis.cancel()
    },
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

  function stopPulse() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    onLevel?.(0)
  }
}

class NeuralSpeaker implements Speaker {
  private ctx: AudioContext | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private generation = 0
  private speakingCount = 0
  private analyser: AnalyserNode | null = null
  private probe = 0
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
  private startProbe(ctx: AudioContext): void {
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.6
    const data = new Uint8Array(this.analyser.frequencyBinCount)
    const tick = () => {
      if (this.generation !== this.probe) return
      this.analyser?.getByteFrequencyData(data)
      this.onLevel?.(rms(data))
      this.probe = requestAnimationFrame(tick)
    }
    this.probe = requestAnimationFrame(tick)
  }

  private stopProbe() {
    if (this.probe) cancelAnimationFrame(this.probe)
    this.probe = 0
    this.analyser?.disconnect()
    this.analyser = null
    this.onLevel?.(0)
  }

  async speak(text: string): Promise<void> {
    if (!text.trim()) return
    const token = this.generation
    this.speakingCount += 1

    try {
      const auth = getToken()
      const res = await fetch('/api/assistant/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        },
        body: JSON.stringify({ text }),
      })
      if (!res.ok || !res.body) throw new Error(`TTS failed (${res.status})`)
      if (token !== this.generation) return

      const bytes = await res.arrayBuffer()
      if (token !== this.generation || !bytes.byteLength) return

      const ctx = this.context()
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      if (token !== this.generation) return

      await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource()
        source.buffer = buffer
        if (!this.analyser) this.startProbe(ctx)
        source.connect(this.analyser!)
        this.analyser!.connect(ctx.destination)
        source.onended = () => {
          this.sources.delete(source)
          resolve()
        }
        this.sources.add(source)
        source.start()
      })
    } catch (err) {
      if (token === this.generation && err instanceof Error) {
        console.warn('[tts] neural playback failed, using browser voice', err)
        await browserSpeaker(this.onLevel).speak(text)
      }
    } finally {
      this.speakingCount = Math.max(0, this.speakingCount - 1)
    }
  }

  cancel() {
    this.generation += 1
    this.stopProbe()
    for (const source of this.sources) {
      try {
        source.onended = null
        source.stop()
      } catch {
        /* already finished */
      }
    }
    this.sources.clear()
    this.speakingCount = 0
    if (this.ctx?.state !== 'closed') void this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }
}

const SENTENCE_END = /[.!?…]["')\]]?\s/

/**
 * Speaks a reply as it streams in, one sentence at a time, so the first
 * sentence is audible while the model is still generating the rest.
 * Uses neural TTS when a provider is configured, otherwise the browser voice.
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

  /** @param onLevel Live playback loudness 0..1, for the voice orb. */
  constructor(onLevel?: (level: number) => void) {
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

  /** True while audio is actively playing (drives the UI speaking indicator). */
  get speaking(): boolean {
    return this.speaker.active
  }

  /** Queues every newly completed sentence found in the grown text. */
  push(fullText: string): void {
    if (fullText.length <= this.cursor) {
      this.cursor = Math.min(this.cursor, fullText.length)
      return
    }
    const pending = fullText.slice(this.cursor)
    let cut = 0
    for (let i = 0; i < pending.length - 1; i += 1) {
      if (SENTENCE_END.test(pending.slice(i, i + 2)) && /\s/.test(pending[i + 1] ?? '')) {
        cut = i + 2
      }
    }
    if (cut === 0) return
    this.cursor += cut
    const chunk = pending.slice(0, cut).trim()
    if (chunk) {
      this.queue.push(chunk)
      void this.drain()
    }
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

    await this.ready
    if (token !== this.generation) {
      this.settle(token)
      return
    }

    while (this.queue.length && token === this.generation) {
      await this.speaker.speak(this.queue.shift()!)
    }

    if (token === this.generation && this.queue.length) {
      void this.drain()
    } else {
      this.settle(token)
    }
  }

  private settle(token: number) {
    // A newer generation (cancel + re-push) owns the state now — leave it alone.
    if (token !== this.generation) return
    this.draining = false
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** Resolves when the queue is empty and nothing is being spoken. */
  onIdle(): Promise<void> {
    if (!this.draining && !this.queue.length) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /** Stops playback, drops queued sentences, and aborts in-flight synthesis. */
  cancel(): void {
    this.generation += 1
    this.queue = []
    this.cursor = 0
    this.draining = false
    this.speaker.cancel()
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const resolve of waiters) resolve()
  }
}
