import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { getVoiceLevel, type VoicePhase } from '../lib/voice'

type Props = {
  phase: VoicePhase
  size?: number
  className?: string
}

/** Logical viewBox — the SVG scales to `size`, so all maths stays in 0..200. */
const VB = 200
const C = VB / 2

const LABELS: Record<VoicePhase, string> = {
  idle: 'Tap to talk',
  ready: 'Ready',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
}

type Ring = {
  /** Base radius as a fraction of the half-size. */
  rh: number
  points: number
  /** How fast this band drifts through the wobble. */
  speed: number
  seed: number
  freq: [number, number]
  grad: string
  /** Opacity at rest; scaled up by the live voice level. */
  opacity: number
  wobble: number
}

/**
 * The aurora bands. Each is a closed blob whose radius is modulated by a few
 * out-of-phase sine waves, so the layers slide over each other like northern
 * lights. Higher bands are slower, dimmer and calmer.
 */
const RINGS: Ring[] = [
  { rh: 0.60, points: 84, speed: 0.78, seed: 0.0, freq: [3, 5], grad: 'aurora-1', opacity: 0.62, wobble: 0.10 },
  { rh: 0.74, points: 84, speed: 0.56, seed: 2.1, freq: [4, 3], grad: 'aurora-2', opacity: 0.45, wobble: 0.09 },
  { rh: 0.88, points: 84, speed: 0.42, seed: 4.4, freq: [3, 6], grad: 'aurora-3', opacity: 0.32, wobble: 0.08 },
]

/** Smooth, closed blob path: a circle whose radius breathes per angle. */
function blobPath(
  cx: number,
  cy: number,
  radius: number,
  points: number,
  t: number,
  seed: number,
  [f1, f2]: [number, number],
  wobble: number,
): string {
  const out: string[] = []
  for (let i = 0; i <= points; i += 1) {
    const a = (i / points) * Math.PI * 2
    const n =
      Math.sin(a * f1 + t * 1.15 + seed) * 0.5 +
      Math.sin(a * f2 - t * 0.85 + seed * 1.7) * 0.32 +
      Math.sin(a * 2 + t * 0.6 + seed * 2.3) * 0.18
    const r = radius * (1 + wobble * n)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    out.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  out.push('Z')
  return out.join(' ')
}

/**
 * Centre-stage voice orb: a glowing white/blue core wrapped in drifting aurora
 * bands that breathe with the real mic or playback loudness — the same visual
 * language as ChatGPT's voice mode, so listening / thinking / speaking reads
 * at a glance without any on-screen text.
 *
 * Animation runs entirely in a rAF loop writing to SVG refs. React state is
 * only the phase; 60 level updates a second would otherwise re-render the page.
 */
export default function VoiceOrb({ phase, size = 300, className }: Props) {
  const ringRefs = useRef<Array<SVGPathElement | null>>([])
  const coreRef = useRef<SVGCircleElement | null>(null)
  const glowRef = useRef<SVGCircleElement | null>(null)
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
      const target = current === 'idle' ? 0 : getVoiceLevel()

      // Rise fast, fall slow — responsive without flickering.
      const rate = target > level ? 16 : 5
      level += (target - level) * Math.min(1, rate * dt)

      // Idle/ready keep a slow, self-contained pulse so the orb never looks dead.
      const breathe = current === 'idle' || current === 'ready' ? (Math.sin(t * 1.5) + 1) / 2 : 0

      const center = (s: number) => `translate(${C} ${C}) scale(${s.toFixed(4)}) translate(${-C} ${-C})`

      if (glowRef.current) {
        glowRef.current.setAttribute('transform', center(1 + level * 0.4 + breathe * 0.06))
        glowRef.current.setAttribute('opacity', (0.30 + level * 0.42 + breathe * 0.08).toFixed(3))
      }

      if (coreRef.current) {
        coreRef.current.setAttribute('transform', center(1 + level * 0.16 + breathe * 0.03))
        coreRef.current.setAttribute('opacity', (0.78 + level * 0.22).toFixed(3))
      }

      RINGS.forEach((ring, i) => {
        const el = ringRefs.current[i]
        if (!el) return
        const radius = C * 0.94 * ring.rh
        const wobble = ring.wobble + level * 0.16 + breathe * 0.02
        el.setAttribute('d', blobPath(C, C, radius, ring.points, t * ring.speed, ring.seed, ring.freq, wobble))
        const op = Math.min(1, ring.opacity * (0.5 + level * 0.95 + breathe * 0.18))
        el.setAttribute('opacity', op.toFixed(3))
      })

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      className={clsx('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
      role="status"
      aria-live="polite"
      aria-label={LABELS[phase]}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VB} ${VB}`}
        className="overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="orb-core" cx="50%" cy="42%" r="64%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="42%" stopColor="#dbeafe" />
            <stop offset="72%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.9" />
          </radialGradient>
          <radialGradient id="orb-glow">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="aurora-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="52%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#3b82f6" />
          </linearGradient>
          <linearGradient id="aurora-2" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfdbfe" />
            <stop offset="55%" stopColor="#60a5fa" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
          <linearGradient id="aurora-3" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="50%" stopColor="#7dd3fc" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <filter id="orb-aurora-blur" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="5.5" />
          </filter>
          <filter id="orb-glow-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        <circle cx={C} cy={C} r={C * 0.62} fill="url(#orb-glow)" filter="url(#orb-glow-blur)" />

        <circle
          ref={glowRef}
          cx={C}
          cy={C}
          r={C * 0.44}
          fill="url(#orb-glow)"
          opacity="0.3"
        />

        <g filter="url(#orb-aurora-blur)">
          {RINGS.map((ring, i) => (
            <path
              key={ring.grad}
              ref={(el) => {
                ringRefs.current[i] = el
              }}
              fill={`url(#${ring.grad})`}
              opacity={ring.opacity}
            />
          ))}
        </g>

        <circle ref={coreRef} cx={C} cy={C} r={C * 0.33} fill="url(#orb-core)" opacity="0.8" />
      </svg>

      <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center font-mono text-[10px] font-medium tracking-[0.28em] text-white/70 uppercase">
        {LABELS[phase]}
      </span>
    </div>
  )
}
