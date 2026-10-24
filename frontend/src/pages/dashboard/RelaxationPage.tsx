import { useCallback, useEffect, useRef, useState } from 'react'
import { VoiceStage } from '../../components/relaxation/VoiceStage'
import { VoiceIntroStage } from '../../components/relaxation/VoiceIntroStage'
import { RelaxationSessionsCard } from '../../components/relaxation/RelaxationSessionsCard'
import {
  fetchInstructorVoices, getSavedVoiceId, saveVoiceId, breakTagsForDisplay, createScriptRunner,
} from '../../lib/instructor'
import type { InstructorVoice } from '../../lib/instructor'
import { prewarmVoice, startVoiceInput, stopVoice, getVoiceLevel, pauseVoiceInput, resumeVoiceInput } from '../../lib/voice'
import { SpeechStream } from '../../lib/tts'
import type { VoicePhase } from '../../lib/voice'

export function RelaxationPage() {
  return <VoiceInstructorCard />
}

/* -------------------------------------------------------------------------- */
/*  Live voice instructor (ElevenLabs Conversational agent)                    */
/* -------------------------------------------------------------------------- */
type SessionState = 'idle' | 'connecting' | 'active' | 'disconnecting' | 'ended'

type TranscriptRow = { id: number; role: 'agent' | 'user'; text: string }

/** The opening line the ConvAI agent used, kept word-for-word. */
const GREETING = 'Hello there, how are you doing today?'

const BREAK_TAG = /(<break\s+time="[\d.]+s"\s*\/>)/gi

type ScriptPiece = { text: string; pauseAfter: number }

/**
 * Splits a scripted line into spoken pieces and pauses. The script's exact
 * words are preserved; only the <break> markup is removed from what is sent to
 * TTS, and the pause is recreated locally. This avoids relying on a specific
 * ElevenLabs model honouring SSML and avoids billing the tag characters.
 */
function scriptPieces(line: string): ScriptPiece[] {
  const parts = line.split(BREAK_TAG)
  const pieces: ScriptPiece[] = []
  let pendingPause = 0
  for (const part of parts) {
    if (!part) continue
    const tag = /^<break\s+time="([\d.]+)s"\s*\/>$/i.exec(part.trim())
    if (tag) {
      const seconds = Number(tag[1])
      if (Number.isFinite(seconds) && seconds > 0) {
        if (pieces.length) pieces[pieces.length - 1].pauseAfter += seconds
        else pendingPause += seconds
      }
      continue
    }
    const text = part.replace(/\s+/g, ' ').trim()
    if (!text) continue
    pieces.push({ text, pauseAfter: pendingPause })
    pendingPause = 0
  }
  return pieces
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * Open the microphone before anything else. Browsers show the permission
 * prompt only once getUserMedia is called, so doing it first means the prompt
 * appears immediately after the click instead of after several API calls.
 */
async function primeMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new DOMException('getUserMedia unavailable', 'NotSupportedError')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
  })
  // Release the device; the voice SDK opens its own stream once the token is
  // ready. Permission is now granted, so that second open is instant.
  stream.getTracks().forEach((track) => track.stop())
}

/**
 * The ElevenLabs SDK opens the mic with automatic gain control enabled. In a
 * shared room AGC boosts a voice across the room to the same level as the
 * person at the microphone, which makes the agent treat that voice as the
 * user. Keep echo cancellation / noise suppression / voice isolation, but turn
 * AGC off while this tab is mounted. The patch is removed on unmount, so the
 * assistant's microphone behaviour is untouched.
 */
function installMicConstraints(): () => void {
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) return () => {}
  const original = md.getUserMedia.bind(md)
  md.getUserMedia = (constraints?: MediaStreamConstraints) => {
    const audio = constraints?.audio
    if (!audio) return original(constraints)
    const nextAudio: MediaTrackConstraints = {
      ...(typeof audio === 'object' ? audio : {}),
      autoGainControl: false,
    }
    return original({ ...constraints, audio: nextAudio })
  }
  return () => {
    md.getUserMedia = original
  }
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Microphone access was blocked. Allow it in your browser, then press start again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No microphone found. Connect one, then press start again.'
  }
  if (name === 'NotReadableError') {
    return 'Your microphone is busy in another app. Close it, then press start again.'
  }
  if (name === 'NotSupportedError') {
    return 'This browser cannot record audio. Try Chrome, Edge, or Safari.'
  }
  return 'Could not access the microphone. Check your browser settings and try again.'
}

function VoiceInstructorCard() {
  const [voices, setVoices] = useState<InstructorVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [voiceId, setVoiceId] = useState<string>('')
  const [state, setState] = useState<SessionState>('idle')
  const [phase, setPhase] = useState<'listening' | 'speaking' | null>(null)
  const [transcript, setTranscript] = useState<TranscriptRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [connNote, setConnNote] = useState<'mic' | 'agent' | null>(null)
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0)
  const creditsUsedRef = useRef(0)
  const sessionStartRef = useRef(0)

  const rowIdRef = useRef(0)
  const runnerRef = useRef(createScriptRunner())
  // One session at a time: a double click must never open two audio streams.
  const startingRef = useRef(false)
  const cancelRef = useRef(false)
  const phaseRef = useRef<'listening' | 'speaking' | null>(null)
  const sessionActiveRef = useRef(false)
  const processingRef = useRef(false)
  const ttsRef = useRef<SpeechStream | null>(null)
  const ttsAbortRef = useRef<AbortController | null>(null)
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const ttsLevelRef = useRef(0)
  const voiceIdRef = useRef('')

  useEffect(() => {
    voiceIdRef.current = voiceId
  }, [voiceId])

  // Keep room voices out of the input
  useEffect(() => installMicConstraints(), [])

  // Prewarm voice assets
  useEffect(() => {
    void prewarmVoice()
  }, [])

  // Load the voice catalogue (20 options) once.
  useEffect(() => {
    let alive = true
    fetchInstructorVoices()
      .then((list) => {
        if (!alive) return
        setVoices(list)
        const saved = getSavedVoiceId()
        const chosen = saved && list.some((v) => v.voice_id === saved) ? saved : (list[0]?.voice_id ?? '')
        setVoiceId(chosen)
      })
      .catch(() => alive && setError('Could not load voice options.'))
      .finally(() => alive && setVoicesLoading(false))
    return () => { alive = false }
  }, [])

  // Session stopwatch.
  useEffect(() => {
    if (state !== 'active') return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [state])

  const push = useCallback((role: 'agent' | 'user', text: string) => {
    setTranscript((rows) => [...rows, { id: ++rowIdRef.current, role, text }])
  }, [])

  const finishSession = useCallback(async () => {
    sessionActiveRef.current = false
    setPhase(null)
    phaseRef.current = null
    try {
      await stopVoice()
    } catch {
      /* already stopped */
    }
    if (ttsRef.current) { ttsRef.current.cancel(); ttsRef.current = null }
    ttsLevelRef.current = 0
    const durationSec = sessionStartRef.current ? (Date.now() - sessionStartRef.current) / 1000 : 0
    try {
      const { api } = await import('../../lib/api')
      await api.post('/api/relaxation/sessions', {
        voiceId: voiceIdRef.current || null,
        creditsUsed: creditsUsedRef.current,
        durationSec,
      })
    } catch (err) {
      console.error('[relaxation] save session failed', err)
    }
    setSessionRefreshKey((k) => k + 1)
    setState('ended')
  }, [])

  /**
   * Speaks one scripted line. Break tags are stripped and their durations are
   * inserted as local silence, so the exact script audio is independent of the
   * TTS model's SSML support (and pauses are not billed as characters).
   */
  const speakLine = useCallback(async (line: string) => {
    if (!sessionActiveRef.current || cancelRef.current) return

    const imagine = /imagine/i.test(line)
    const headpalms = /Roll the head/i.test(line) || /chin slowly/i.test(line)
    let pieces = scriptPieces(line)
    if (headpalms) {
      if (/Roll the head/i.test(line)) {
        pieces = line
          .replace(/<break[^>]*>/gi, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => ({ text: s.endsWith('.') ? s : s + (s.endsWith(',') ? '' : '.'), pauseAfter: 2 }))
      } else {
        pieces = [{ text: line.replace(/<break[^>]*>/gi, '').trim(), pauseAfter: 2 }]
      }
    }
    if (imagine) {
      // In the imagine script, speak each sentence on its own and pause 3s
      // after every full stop, regardless of the original cue grouping.
      const sentences = line
        .replace(/<break[^>]*>/gi, ' ')
        .split(/(?<=[.!?…])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
      pieces = sentences.map((s) => ({ text: s, pauseAfter: 3 }))
    }
    if (!pieces.length) return

    setPhase('speaking')
    phaseRef.current = 'speaking'
    await pauseVoiceInput()

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext

    try {
      for (const piece of pieces) {
        if (!sessionActiveRef.current || cancelRef.current) break

        creditsUsedRef.current += piece.text.replace(/\\s+/g, '').length

        const controller = new AbortController()
        ttsAbortRef.current = controller
        try {
          const { getToken } = await import('../../lib/api')
          const auth = getToken()
          const res = await fetch('/api/assistant/tts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
            },
            body: JSON.stringify({ text: piece.text, voiceId: voiceIdRef.current || undefined }),
            signal: controller.signal,
          })
          if (!res.ok || !res.body) throw new Error(`TTS failed (${res.status})`)
          const bytes = await res.arrayBuffer()
          if (controller.signal.aborted) return

          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
          const ctx = new AudioCtx()
          if (ctx.state === 'suspended') await ctx.resume()
          const buffer = await ctx.decodeAudioData(bytes.slice(0))
          if (controller.signal.aborted) return

          ttsLevelRef.current = 0.7
          await new Promise<void>((resolve) => {
            const source = ctx.createBufferSource()
            source.buffer = buffer
            source.connect(ctx.destination)
            ttsSourceRef.current = source
            source.onended = () => {
              ttsSourceRef.current = null
              ttsLevelRef.current = 0
              resolve()
            }
            source.start()
          })
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            console.error('[relaxation] piece failed', err)
          }
        } finally {
          ttsAbortRef.current = null
        }

        if (piece.pauseAfter > 0 && sessionActiveRef.current && !cancelRef.current) {
          await sleep(piece.pauseAfter * 1000)
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('[relaxation] speak failed', err)
      }
    } finally {
      ttsAbortRef.current = null
      ttsSourceRef.current = null
      ttsLevelRef.current = 0
      if (sessionActiveRef.current && !cancelRef.current) {
        setPhase('listening')
        phaseRef.current = 'listening'
        await resumeVoiceInput()
      }
    }
  }, [])

  const getNextLine = useCallback(async () => {
    if (!sessionActiveRef.current || processingRef.current) return
    processingRef.current = true
    try {
      const out = await runnerRef.current.clientTools.get_next_line({})
      let parsed: { kind?: string; line?: string }
      try {
        parsed = JSON.parse(out)
      } catch {
        console.error('[relaxation] invalid script line payload')
        return
      }
      if (!sessionActiveRef.current) return

      if (parsed.kind === 'end') {
        await finishSession()
        return
      }
      if (parsed.kind === 'wait' || !parsed.line) return

      push('agent', breakTagsForDisplay(parsed.line))
      await speakLine(parsed.line)
      if (!sessionActiveRef.current) return

      // Safety / goodbye / end-of-script lines finish the session. Other
      // "speak" lines (pause, note, confirm) return to listening naturally.
      const status = runnerRef.current.status()
      if (parsed.kind === 'speak' && (status.phase === 'done' || status.step === 'closing' || status.step === 'done')) {
        await finishSession()
        return
      }

      setPhase('listening')
      phaseRef.current = 'listening'
    } catch (err) {
      console.error('[relaxation] getNextLine failed', err)
    } finally {
      processingRef.current = false
    }
  }, [finishSession, push, speakLine])

  const start = useCallback(async () => {
    if (startingRef.current || sessionActiveRef.current) return
    startingRef.current = true
    cancelRef.current = false
    setError(null)
    setState('connecting')
    setConnNote('mic')
    setTranscript([])
    setElapsed(0)
    creditsUsedRef.current = 0
    sessionStartRef.current = Date.now()
    runnerRef.current = createScriptRunner()
    phaseRef.current = null
    processingRef.current = false
    ttsLevelRef.current = 0
    const chosen = voiceId
    if (chosen) saveVoiceId(chosen)

    try {
      await primeMicrophone()
    } catch (err) {
      console.error('[relaxation] microphone unavailable', err)
      startingRef.current = false
      setConnNote(null)
      setPhase(null)
      setState('idle')
      setError(micErrorMessage(err))
      return
    }

    setConnNote(null)
    try {
      await startVoiceInput({
        onPhase: (p) => {
          if (sessionActiveRef.current) {
            if (p === 'listening') { setPhase('listening'); phaseRef.current = 'listening' }
            else if (p === 'speaking') { setPhase('speaking'); phaseRef.current = 'speaking' }
          }
        },
        onTranscript: async (text) => {
          if (!sessionActiveRef.current || cancelRef.current) return
          runnerRef.current.hearUser(text)
          push('user', text)
          await getNextLine()
        },
        onError: (message) => {
          setError(message)
        },
      })

      // The user pressed End while the microphone was still starting.
      if (cancelRef.current) {
        await stopVoice()
        setState('idle')
        return
      }

      sessionActiveRef.current = true
      runnerRef.current.markConnected()
      setState('active')
      push('agent', GREETING)
      await speakLine(GREETING)
      // Stop after the greeting and wait for the user's reply before continuing.
      if (sessionActiveRef.current) {
        setPhase('listening')
        phaseRef.current = 'listening'
      }
      if (sessionActiveRef.current) {
        setPhase('listening')
        phaseRef.current = 'listening'
      }
    } catch (err) {
      console.error('[relaxation] start failed', err)
      sessionActiveRef.current = false
      setPhase(null)
      setState('idle')
      setError(
        err instanceof Error && /NotAllowedError|permission/i.test(err.message)
          ? 'Microphone access was blocked. Allow it in your browser to talk with the instructor.'
          : 'Could not start the session. Please try again.',
      )
    } finally {
      startingRef.current = false
      setConnNote(null)
    }
  }, [voiceId, push, getNextLine, speakLine])

  const end = useCallback(async () => {
    cancelRef.current = true
    setState('disconnecting')
    await finishSession()
  }, [finishSession])

  useEffect(() => () => {
    void stopVoice()
    if (ttsRef.current) { ttsRef.current.cancel(); ttsRef.current = null }
  }, [])

  const labelOf = (id: string) => voices.find((v) => v.voice_id === id) || null

  const levelGetter = useCallback(() => {
    if (phaseRef.current === 'speaking') return Math.min(1, ttsLevelRef.current * 1.8)
    try {
      return Math.min(1, getVoiceLevel() * 1.4)
    } catch {
      return 0
    }
  }, [])

  const stageOpen = state === 'connecting' || state === 'active' || state === 'disconnecting'
  const stagePhase: VoicePhase =
    state === 'connecting'
      ? 'ready'
      : state === 'disconnecting'
        ? 'processing'
        : phase === 'speaking'
          ? 'speaking'
          : 'listening'

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <VoiceIntroStage
          voiceName={labelOf(voiceId)?.name}
          voices={voices}
          voiceId={voiceId}
          voicesLoading={voicesLoading}
          onVoiceChange={(id) => { setVoiceId(id); if (id) saveVoiceId(id) }}
          onStart={start}
          ended={state === 'ended'}
          lines={transcript}
          error={error}
          active={stageOpen}
          phase={stagePhase}
          elapsed={elapsed}
          onEnd={end}
          getLevel={levelGetter}
        />
      </div>
      <RelaxationSessionsCard refreshKey={sessionRefreshKey} />
    </div>
  )
}
