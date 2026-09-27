import * as vad from '@ricky0123/vad-web'
import { SpeechStream } from './tts'
import { streamVoice } from './stream'

export type VoicePhase =
  | 'idle'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'

export type VoiceReplyMeta = {
  intent?: string | null
  riskLevel?: string | null
  sentimentScore?: number | null
  emotion?: string | null
}

export type VoiceHandlers = {
  getSessionId: () => number | null
  onPhase: (phase: VoicePhase) => void
  onLevel?: (level: number) => void
  onTurnStart: (info: { transcript?: string; meta?: VoiceReplyMeta }) => void
  onDelta: (text: string) => void
  onRevision: (text: string) => void
  onTurnEnd: (info: { reply: string; meta?: VoiceReplyMeta; sessionId: number | null }) => void
  onError: (message: string) => void
}

let micVAD: vad.MicVAD | null = null
let initPromise: Promise<vad.MicVAD> | null = null
let handlers: VoiceHandlers | null = null
let processing = false
let speech: SpeechStream | null = null
let turnAbort: AbortController | null = null
let phase: VoicePhase = 'idle'
let currentLevel = 0

/**
 * Current input or playback loudness, 0..1. Kept outside React so the orb can
 * poll it every animation frame without re-rendering the tree ~30x/second.
 */
export function getVoiceLevel(): number {
  return currentLevel
}

export function isVoiceActive(): boolean {
  return handlers !== null
}

function setPhase(next: VoicePhase) {
  phase = next
  handlers?.onPhase(next)
}

/** Root-mean-square of a frame, scaled to a rough 0..1 loudness. */
function frameLevel(frame: Float32Array): number {
  let sum = 0
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i]
  const rms = Math.sqrt(sum / frame.length)
  return Math.min(1, Math.pow(rms * 3.2, 0.7))
}

function reportLevel(level: number) {
  currentLevel = level
  handlers?.onLevel?.(level)
}

function wavBlob(samples: Float32Array): Blob {
  const buffer = vad.utils.encodeWAV(samples, 1, 16000, 1, 16)
  return new Blob([buffer], { type: 'audio/wav' })
}

function abortTurn() {
  turnAbort?.abort()
  turnAbort = null
  processing = false
}

async function resumeListening() {
  if (!handlers) return
  if (speech) {
    await speech.onIdle()
    if (!handlers) return
    speech = null
  }
  if (!handlers) return
  setPhase('listening')
  if (micVAD && !micVAD.listening) await micVAD.start().catch(() => undefined)
}

async function runTurn(audio: Blob) {
  if (!handlers || processing) return
  processing = true
  setPhase('processing')

  const current = handlers
  const stream = new SpeechStream((level) => reportLevel(level))
  speech = stream
  const controller = new AbortController()
  turnAbort = controller

  let lastText = ''
  let received = false
  let meta: VoiceReplyMeta | undefined

  const markSpeaking = () => {
    if (stream.speaking) setPhase('speaking')
  }

  try {
    await streamVoice({
      audio,
      sessionId: current.getSessionId(),
      signal: controller.signal,
      onTranscript: (text) => {
        received = true
        current.onTurnStart({ transcript: text, meta })
      },
      onMeta: (m) => {
        meta = m
        current.onTurnStart({ transcript: undefined, meta: m })
      },
      onDelta: (text) => {
        lastText = text
        received = true
        current.onDelta(text)
        stream.push(text)
        markSpeaking()
      },
      onRevision: (text) => {
        lastText = text
        current.onRevision(text)
        stream.cancel()
        stream.push(text)
        markSpeaking()
      },
      onDone: ({ reply, meta: finalMeta, session }) => {
        if (finalMeta) meta = finalMeta
        current.onTurnEnd({ reply, meta, sessionId: session?.id ?? null })
      },
    })

    if (controller.signal.aborted || !current) return
    if (!received || !lastText) {
      current.onError('The assistant could not generate a reply.')
      stream.cancel()
      await resumeListening()
      return
    }

    stream.flush(lastText)
    markSpeaking()
    await stream.onIdle()
    await resumeListening()
  } catch (err) {
    stream.cancel()
    if (err instanceof DOMException && err.name === 'AbortError') return
    if (controller.signal.aborted) return
    current.onError(err instanceof Error ? err.message : 'Voice request failed.')
    await resumeListening()
  } finally {
    if (turnAbort === controller) turnAbort = null
    processing = false
    if (speech === stream) speech = null
  }
}

async function ensureVad(): Promise<vad.MicVAD> {
  if (micVAD) return micVAD
  if (initPromise) return initPromise
  if (typeof window === 'undefined') {
    throw new Error('Voice input is not supported in this browser.')
  }
  if (!window.isSecureContext) {
    throw new Error('Microphone needs a secure origin — use https:// or http://localhost.')
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is blocked. Allow mic permission in the address bar.')
  }

  initPromise = vad.MicVAD.new({
    model: 'v5',
    baseAssetPath: '/vad/',
    onnxWASMBasePath: '/ort/',
    startOnLoad: false,
    onFrameProcessed: (_probabilities, frame) => {
      // 32ms frames - drives the orb's live listening ring. Only while the VAD
      // is running AND we are actually in the listening phase, so the orb does
      // not show mic motion while it is thinking or speaking.
      if (micVAD?.listening && phase === 'listening') reportLevel(frameLevel(frame))
    },
    onSpeechStart() {
      if (!handlers) return
      // Barge-in: stop speaking and stop generating so the new turn wins.
      if (speech) {
        speech.cancel()
        setPhase('listening')
      }
      if (processing) abortTurn()
    },
    onSpeechEnd: (audio) => {
      if (!handlers || processing) return
      void runTurn(wavBlob(audio))
    },
  })
  try {
    micVAD = await initPromise
  } finally {
    initPromise = null
  }
  return micVAD
}

let prewarmStarted = false

/**
 * Loads the VAD model ahead of time. The ONNX model plus the ONNX Runtime
 * WASM is ~30MB, which is slow enough that starting it on the first mic click
 * reads as "nothing happened". Safe to call repeatedly and does not request
 * microphone permission — that only happens on start().
 */
export function prewarmVoice(): void {
  if (prewarmStarted) return
  if (typeof window === 'undefined') return
  prewarmStarted = true
  void ensureVad().catch((err) => {
    prewarmStarted = false
    console.warn('[voice] prewarm failed', err)
  })
}

export async function startVoice(next: VoiceHandlers): Promise<void> {
  await stopVoiceInternal()
  handlers = next
  setPhase('ready')
  try {
    const vadInstance = await ensureVad()
    await vadInstance.start()
    setPhase('listening')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start voice.'
    console.error('[voice] failed to start', err)
    setPhase('idle')
    next.onError(message)
    handlers = null
    throw err
  }
}

export async function stopVoice(): Promise<void> {
  await stopVoiceInternal()
}

async function stopVoiceInternal(): Promise<void> {
  speech?.cancel()
  speech = null
  abortTurn()
  // Notify before dropping handlers, otherwise the UI never learns we went idle.
  setPhase('idle')
  reportLevel(0)
  handlers = null
  if (micVAD) {
    await micVAD.pause().catch(() => undefined)
  }
}
