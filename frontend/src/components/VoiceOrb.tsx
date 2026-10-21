import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { getVoiceLevel, type VoicePhase } from '../lib/voice'

type Props = {
  phase: VoicePhase
  size?: number
  className?: string
}

const LABELS: Record<VoicePhase, string> = {
  idle: 'Tap to talk',
  ready: 'Ready',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
}

/**
 * Centre-stage voice orb, matched to the mockups: a solid violet sphere lit
 * from the top — near-white at the crown, mid lavender at the core, deep
 * indigo at the base. Loudness from the real mic or playback drives its scale
 * and the halo behind it, so listening / thinking / speaking reads at a glance
 * without any on-screen text (the phase is still announced to screen readers).
 *
 * Animation runs entirely in a rAF loop writing to DOM refs. React state is
 * only the phase; 60 level updates a second would otherwise re-render the page.
 */
export default function VoiceOrb({ phase, size = 300, className }: Props) {
  const haloRef = useRef<HTMLSpanElement | null>(null)
  const sphereRef = useRef<HTMLDivElement | null>(null)
  const phaseRef = useRef<VoicePhase>(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    let raf = 0
    let level = 0
    let t = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 1000
      last = now
      t += dt

      const current = phaseRef.current
      // The mic only reports a level while listening/speaking, so idle phases
      // fall back to zero and lean on the slow self-pulse below.
      const target = current === 'idle' ? 0 : getVoiceLevel()

      // Rise fast, fall slow — responsive without flickering.
      const rate = target > level ? 16 : 5
      level += (target - level) * Math.min(1, rate * dt)

      // So the orb never looks dead between turns.
      const breathe = current === 'idle' || current === 'ready' ? (Math.sin(t * 1.5) + 1) / 2 : 0

      if (sphereRef.current) {
        // No enlarging — the sphere keeps its size so only the interior moves.
        // Cloud frequency tracks the voice: calm drift at rest (~30s per cycle)
        // tightening to a brisk swirl at full level (~8s). Written as a plain
        // number so each `animation-duration` picks it up.
        const speed = (30 - level * 22).toFixed(2)
        sphereRef.current.style.setProperty('--vc-flow-speed', `${speed}s`)
      }
      if (haloRef.current) {
        haloRef.current.style.opacity = (0.42 + level * 0.24 + breathe * 0.1).toFixed(3)
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  const speaking = phase === 'speaking'

  return (
    <div
      className={clsx('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
      aria-label={LABELS[phase]}
    >
      <span
        ref={haloRef}
        aria-hidden
        className={clsx(
          'vc-orb-halo pointer-events-none absolute inset-[-14%] rounded-full',
          speaking && 'vc-orb-halo-speaking',
        )}
      />
      <div
        ref={sphereRef}
        aria-hidden
        className="vc-orb-rim relative h-full w-full overflow-hidden rounded-full"
        style={{
          /* Base body: the violet mass the clouds drift through. Kept a step
             lighter than the raw mockup so the clouds read inside it and the
             deep-violet band does not swallow the flanks. */
          background:
            'radial-gradient(circle at 50% 34%, #ab98f3 0%, #9d89f0 16%, #9280ec 34%, #7f6ce0 56%, #6d5dd0 78%, #5d47bd 100%)',
          boxShadow: '0 30px 90px -30px rgba(110, 88, 216, 0.85)',
        }}
      >
        {/* Cloud masses folding through the sphere. They sit under the white
            crown, and their animation-duration reads `--vc-flow-speed`, which
            the rAF loop shortens as the voice level rises. */}
        <span aria-hidden className="vc-cloud vc-cloud-1" />
        <span aria-hidden className="vc-cloud vc-cloud-2" />
        <span aria-hidden className="vc-cloud vc-cloud-3" />
        <span aria-hidden className="vc-cloud vc-cloud-4" />

        {/* The lit white crown. Held at roughly 40% of the sphere so the
            purple:white balance reads about 60:40. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(ellipse 66% 52% at 50% 0%, rgba(248,246,255,1) 0%, rgba(245,242,255,0.99) 44%, rgba(238,233,254,0.86) 64%, rgba(229,222,253,0.46) 84%, rgba(221,212,252,0) 100%)',
          }}
        />
      </div>
    </div>
  )
}
