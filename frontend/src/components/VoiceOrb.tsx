import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { getVoiceLevel, type VoicePhase } from '../lib/voice'

type Props = {
  phase: VoicePhase
  size?: number
  className?: string
}

type Palette = {
  core: string
  ring: string
  glow: string
  label: string
}

const PALETTES: Record<VoicePhase, Palette> = {
  idle: {
    core: 'rgba(139, 92, 246, 0.16)',
    ring: 'rgba(154, 143, 176, 0.35)',
    glow: 'rgba(139, 92, 246, 0.10)',
    label: 'Paused',
  },
  ready: {
    core: 'rgba(139, 92, 246, 0.26)',
    ring: 'rgba(184, 164, 224, 0.55)',
    glow: 'rgba(139, 92, 246, 0.20)',
    label: 'Ready',
  },
  listening: {
    core: 'rgba(139, 92, 246, 0.42)',
    ring: 'rgba(196, 181, 253, 0.95)',
    glow: 'rgba(139, 92, 246, 0.38)',
    label: 'Listening',
  },
  processing: {
    core: 'rgba(212, 184, 150, 0.32)',
    ring: 'rgba(212, 184, 150, 0.90)',
    glow: 'rgba(212, 184, 150, 0.26)',
    label: 'Thinking',
  },
  speaking: {
    core: 'rgba(91, 33, 182, 0.50)',
    ring: 'rgba(240, 235, 248, 0.95)',
    glow: 'rgba(139, 92, 246, 0.45)',
    label: 'Speaking',
  },
}

const RING_RADII = [0.92, 0.76, 0.6]

/**
 * Centre-stage voice orb. Concentric rings that breathe with the real mic or
 * playback loudness, so it reads as listening / thinking / speaking at a glance.
 *
 * Animation runs entirely in a rAF loop writing to SVG refs - React state is
 * only used for the phase, otherwise 30 level updates a second would re-render
 * the whole page.
 */
export default function VoiceOrb({ phase, size = 260, className }: Props) {
  const palette = PALETTES[phase]
  const coreRef = useRef<SVGCircleElement | null>(null)
  const glowRef = useRef<SVGCircleElement | null>(null)
  const sweepRef = useRef<SVGGElement | null>(null)
  const ringRefs = useRef<Array<SVGCircleElement | null>>([])
  const phaseRef = useRef<VoicePhase>(phase)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    let raf = 0
    let level = 0
    let spin = 0
    let breathe = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(64, now - last) / 1000
      last = now
      breathe += dt

      const current = phaseRef.current
      const target = current === 'idle' ? 0 : getVoiceLevel()

      // Rise fast, fall slow - feels responsive without flickering.
      const rate = target > level ? 18 : 5
      level += (target - level) * Math.min(1, rate * dt)

      const idlePulse = current === 'idle' || current === 'ready'
        ? (Math.sin(breathe * 1.6) + 1) / 2
        : 0

      const base = idlePulse * 0.06
      const amp = base + level * 0.30

      if (coreRef.current) {
        const s = 1 + amp * 0.5
        coreRef.current.setAttribute('transform', `scale(${s.toFixed(4)})`)
        coreRef.current.setAttribute('opacity', (0.55 + level * 0.45).toFixed(3))
      }
      if (glowRef.current) {
        const s = 1 + amp * 1.5
        glowRef.current.setAttribute('transform', `scale(${s.toFixed(4)})`)
        glowRef.current.setAttribute('opacity', (0.25 + level * 0.5).toFixed(3))
      }

      ringRefs.current.forEach((ring, i) => {
        if (!ring) return
        // Outer rings lag behind the inner ones for a ripple effect.
        const offset = i * 0.16
        const l = Math.max(0, level - offset)
        const s = 1 + l * (0.16 + i * 0.05) + idlePulse * 0.02
        ring.setAttribute('transform', `scale(${s.toFixed(4)})`)
        ring.setAttribute('opacity', (0.4 + l * 0.6 - i * 0.08).toFixed(3))
        ring.setAttribute('stroke-width', (1.5 + l * 5).toFixed(2))
      })

      if (current === 'processing') {
        spin += dt * 140
        if (sweepRef.current) {
          sweepRef.current.setAttribute('transform', `rotate(${spin.toFixed(1)} ${size / 2} ${size / 2})`)
        }
      } else if (sweepRef.current) {
        // Ease the sweep back to rest instead of snapping.
        spin += (0 - spin) * Math.min(1, 4 * dt)
        sweepRef.current.setAttribute('transform', `rotate(${spin.toFixed(1)} ${size / 2} ${size / 2})`)
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size])

  const c = size / 2

  return (
    <div
      className={clsx('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90 overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="orb-core">
            <stop offset="0%" stopColor="#f0ebf8" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#c4b5fd" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#5b21b6" stopOpacity="0.9" />
          </radialGradient>
          <filter id="orb-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
        </defs>

        <circle
          ref={glowRef}
          cx={c}
          cy={c}
          r={c * 0.52}
          fill={palette.glow}
          filter="url(#orb-blur)"
          style={{ transformOrigin: `${c}px ${c}px` }}
        />

        {RING_RADII.map((ratio, i) => (
          <circle
            key={ratio}
            ref={(el) => {
              ringRefs.current[i] = el
            }}
            cx={c}
            cy={c}
            r={c * ratio * 0.86}
            fill="none"
            stroke={palette.ring}
            strokeLinecap="round"
            style={{ transformOrigin: `${c}px ${c}px` }}
          />
        ))}

        <g ref={sweepRef} style={{ opacity: phase === 'processing' ? 1 : 0, transition: 'opacity .3s' }}>
          <circle
            cx={c}
            cy={c}
            r={c * 0.86}
            fill="none"
            stroke={palette.ring}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${size * 0.5} ${size * 1.6}`}
          />
        </g>

        <circle
          ref={coreRef}
          cx={c}
          cy={c}
          r={c * 0.3}
          fill="url(#orb-core)"
          style={{ transformOrigin: `${c}px ${c}px` }}
        />
      </svg>

      <span className="relative text-[11px] font-medium tracking-[0.22em] text-muted uppercase">
        {palette.label}
      </span>
    </div>
  )
}
