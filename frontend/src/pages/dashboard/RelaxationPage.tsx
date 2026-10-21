import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Play, Square, Volume2, VolumeX, Sparkles, Heart } from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'

const STEPS = [
  { title: 'Settle in', text: 'Find a comfortable position. Close your eyes if you can. Take a slow, deep breath in through your nose… and let it out through your mouth. Let your shoulders drop.' },
  { title: 'Body scan', text: 'Bring your attention to your feet. Notice any tension there, and let it soften. Move slowly up through your calves, your knees, your thighs. Let each part release as you go.' },
  { title: 'Breathing rhythm', text: 'Breathe in for four counts… hold for four… and out for six. In two three four… hold two three four… out two three four five six. Let the rhythm be gentle and steady.' },
  { title: 'Let go of thoughts', text: 'Thoughts will come. That is okay. Notice them like clouds passing, and gently return your attention to your breath. No judgement. Just breathe.' },
  { title: 'Grounding', text: 'Feel the support beneath you. The chair, the floor, the earth. You are safe here. You are exactly where you need to be.' },
  { title: 'Closing', text: 'Slowly bring your attention back. Wiggle your fingers and toes. Take one more deep breath. When you are ready, open your eyes. You did well. Carry this calm with you.' },
]

export function RelaxationPage() {
  const [running, setRunning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [muted, setMuted] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

  const speak = useCallback((text: string) => {
    if (muted) return
    if (!('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.85
    u.pitch = 1
    u.volume = 1
    synth.speak(u)
    synthRef.current = synth
  }, [muted])

  const stopAll = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setRunning(false)
  }, [])

  const start = useCallback(() => {
    setRunning(true)
    setStepIndex(0)
    setSecondsLeft(150) // 2.5 minutes
    setStartedAt(Date.now())
    speak(STEPS[0].text)
  }, [speak])

  // countdown + step progression
  useEffect(() => {
    if (!running) return
    timerRef.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          stopAll()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [running, stopAll])

  // progress step based on elapsed
  useEffect(() => {
    if (!running || !startedAt) return
    const elapsed = (Date.now() - startedAt) / 1000
    const perStep = 150 / STEPS.length
    const idx = Math.min(STEPS.length - 1, Math.floor(elapsed / perStep))
    if (idx !== stepIndex) {
      setStepIndex(idx)
      speak(STEPS[idx].text)
    }
  }, [secondsLeft, running, startedAt, stepIndex, speak])

  useEffect(() => {
    return () => stopAll()
  }, [stopAll])

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')
  const progress = startedAt ? Math.min(100, ((150 - secondsLeft) / 150) * 100) : 0

  return (
    <div className="rise-grid mx-auto max-w-3xl space-y-6">
      <PageHeader title="Relaxation" description="A guided 2-3 minute voice session to help you unwind." />

      <div className="glass-ice rounded-2xl p-8 text-center space-y-6">
        <div className="flex items-center justify-center gap-3">
          <Heart className="h-6 w-6 text-rose-400" />
          <h2 className="text-xl font-semibold text-ink">{running ? STEPS[stepIndex].title : 'Ready to relax?'}</h2>
        </div>

        <div className="relative mx-auto h-40 w-40">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r="70" fill="none" stroke="rgba(184,164,224,0.12)" strokeWidth="10" />
            <circle
              cx="80"
              cy="80"
              r="70"
              fill="none"
              stroke="url(#relaxGrad)"
              strokeWidth="10"
              strokeDasharray={`${2 * Math.PI * 70 * (progress / 100)} ${2 * Math.PI * 70}`}
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="relaxGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#8b5cf6" />
                <stop offset="1" stop-color="#ec4899" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums text-ink">{mm}:{ss}</span>
            <span className="text-xs text-muted">{running ? 'remaining' : '2:30'}</span>
          </div>
        </div>

        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted">
          {running ? STEPS[stepIndex].text : 'Press start to begin a guided relaxation session. Find a quiet spot, sit comfortably, and let the voice guide you.'}
        </p>

        <div className="flex items-center justify-center gap-3">
          {!running ? (
            <button
              type="button"
              onClick={start}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-violet to-violet-deep px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition hover:opacity-90"
            >
              <Play className="h-4 w-4" /> Start session
            </button>
          ) : (
            <button
              type="button"
              onClick={stopAll}
              className="inline-flex items-center gap-2 rounded-full border border-ice/20 bg-ice/10 px-6 py-3 text-sm font-semibold text-ice transition hover:bg-ice/15"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          )}
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-ice/20 bg-ice/[0.03] text-muted transition hover:text-ice"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-muted">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Voice-guided · 2.5 minutes · No data collected</span>
        </div>
      </div>

      <div className="glass-ice rounded-2xl p-6">
        <h3 className="text-sm font-semibold text-ink mb-3">Session steps</h3>
        <ol className="space-y-2">
          {STEPS.map((s, i) => (
            <li
              key={i}
              className={clsx(
                'flex items-start gap-3 rounded-xl border px-3 py-2 text-sm transition',
                i === stepIndex && running
                  ? 'border-violet/40 bg-violet/10 text-ink'
                  : 'border-ice/10 bg-ice/[0.03] text-muted',
              )}
            >
              <span className="font-mono text-[10px] text-muted mt-0.5">{i + 1}</span>
              <div>
                <p className="font-medium text-ink">{s.title}</p>
                <p className="text-xs text-muted line-clamp-1">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}