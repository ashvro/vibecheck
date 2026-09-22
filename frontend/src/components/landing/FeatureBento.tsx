import clsx from 'clsx'
import { CrystalMark } from '../CrystalMark'
import { Reveal } from './Reveal'
import { GhostNum } from './GhostNum'
import { useInView } from '../../hooks/useInView'
import type { PointerEvent } from 'react'

const features = [
  {
    n: '01',
    title: 'Talk it out. We route it.',
    description:
      'One conversation for mental health, academics, and campus life — classified automatically.',
    kind: 'chat' as const,
    span: 'md:col-span-4',
  },
  {
    n: '02',
    title: 'Peer space, low pressure',
    description: 'Anonymous-friendly forums that feel safe at 1am.',
    kind: 'people' as const,
    span: 'md:col-span-2',
  },
  {
    n: '03',
    title: 'Find your people',
    description: 'Clubs and peer matches that cut through isolation.',
    kind: 'bars' as const,
    span: 'md:col-span-2',
  },
  {
    n: '04',
    title: 'Grades without the spiral',
    description: 'Attendance, marks, and quizzes in one calm view.',
    kind: 'chart' as const,
    span: 'md:col-span-4',
  },
  {
    n: '05',
    title: 'Catch risk early',
    description:
      'Sentiment, attendance, and grades → clear interventions — not opaque scary scores.',
    kind: 'risk' as const,
    span: 'md:col-span-6',
  },
]

const GRADES_DATA = [
  { m: 'Oct', v: 44 },
  { m: 'Nov', v: 50 },
  { m: 'Dec', v: 47 },
  { m: 'Jan', v: 56 },
  { m: 'Feb', v: 54 },
  { m: 'Mar', v: 64 },
  { m: 'Apr', v: 70 },
]

function ChatMock({ active }: { active: boolean }) {
  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60',
        'mock-chat',
        active && 'mock-active',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ice/10 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet/25 text-[10px] font-bold text-violet-soft">
            C
          </span>
          <p className="font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase">
            triage · 1:1
          </p>
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-emerald-soft uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-soft" />
          routed
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 px-3 py-2.5">
        <div className="bubble flex justify-end">
          <span className="max-w-[82%] rounded-2xl rounded-br-md bg-thaw-lift px-2.5 py-1 text-[10px] leading-snug text-ice/75">
            “exam week hit. feels like drowning.”
          </span>
        </div>
        <div className="bubble flex justify-start" style={{ animationDelay: '200ms' }}>
          <span className="max-w-[85%] rounded-2xl rounded-bl-md border border-ice/15 bg-thaw px-2.5 py-1 text-[10px] leading-snug text-ice/70">
            that’s real. want space, or a person?
          </span>
        </div>
        <div className="bubble flex justify-end" style={{ animationDelay: '400ms' }}>
          <span className="max-w-[82%] rounded-2xl rounded-br-md bg-thaw-lift px-2.5 py-1 text-[10px] leading-snug text-ice/75">
            “a person, please.”
          </span>
        </div>
        <div className="bubble flex justify-start" style={{ animationDelay: '600ms' }}>
          <span className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-ice/15 bg-thaw px-2.5 py-1 text-[10px] text-ice/70">
            routing → well-being desk
            <span className="typing-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-ice/10 px-3 py-2">
        <span className="flex h-6 flex-1 items-center rounded-full bg-thaw px-2.5 font-mono text-[9px] tracking-[0.12em] text-ice/40 uppercase">
          type a thought…
        </span>
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet/30 text-[11px] text-violet-soft">
          →
        </span>
      </div>
    </div>
  )
}

function GradesMock({ active }: { active: boolean }) {
  const W = 300
  const H = 40
  const PAD = 3
  const minV = 40
  const maxV = 76
  const px = (i: number) => PAD + (i / (GRADES_DATA.length - 1)) * (W - PAD * 2)
  const py = (v: number) => H - PAD - ((v - minV) / (maxV - minV)) * (H - PAD * 2)
  const pts = GRADES_DATA.map((d, i) => [px(i).toFixed(1), py(d.v).toFixed(1)])
  const linePath = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')
  const areaPath = `${linePath} L ${px(GRADES_DATA.length - 1).toFixed(1)} ${H} L ${px(0).toFixed(1)} ${H} Z`

  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60',
        'mock-chart',
        active && 'mock-active',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ice/10 px-3.5 py-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase">
          term · grade trend
        </p>
        <span className="flex items-center gap-1 rounded-full bg-violet/15 px-2 py-0.5 font-mono text-[9px] text-violet-soft">
          GPA 3.7 <span className="text-emerald-soft">▲</span>
        </span>
      </div>

      <div className="flex shrink-0 items-stretch gap-1.5 px-3.5 pt-2.5">
        <div
          className="mock-btn flex flex-1 flex-col items-center rounded-lg bg-thaw py-1.5"
          style={{ animationDelay: '150ms' }}
        >
          <span className="font-mono text-[8px] tracking-[0.14em] text-ice/40 uppercase">gpa</span>
          <span className="font-mono text-[11px] font-semibold text-violet-soft">3.7 ▲</span>
        </div>
        <div
          className="mock-btn flex flex-1 flex-col items-center rounded-lg bg-thaw py-1.5"
          style={{ animationDelay: '280ms' }}
        >
          <span className="font-mono text-[8px] tracking-[0.14em] text-ice/40 uppercase">attend</span>
          <span className="font-mono text-[11px] font-semibold text-violet-soft">91%</span>
        </div>
        <div
          className="mock-btn flex flex-1 flex-col items-center rounded-lg bg-thaw py-1.5"
          style={{ animationDelay: '410ms' }}
        >
          <span className="font-mono text-[8px] tracking-[0.14em] text-ice/40 uppercase">labs</span>
          <span className="font-mono text-[11px] font-semibold text-violet-soft">12·14</span>
        </div>
      </div>

      <div className="chart-plot flex min-h-10 flex-1 flex-col justify-between px-2 py-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="heroGradesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#heroGradesFill)" />
          <polyline
            points={pts.join(' ')}
            fill="none"
            stroke="#c4b5fd"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <div className="flex justify-between px-0.5">
          {GRADES_DATA.map((d) => (
            <span key={d.m} className="font-mono text-[8px] tracking-[0.04em] text-ice/40">
              {d.m}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-t border-ice/10 px-3 py-2">
        <span className="font-mono text-[8px] tracking-[0.14em] text-ice/45 uppercase">
          midterm readiness
        </span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-thaw">
          <span className="block h-full w-[68%] rounded-full bg-gradient-to-r from-violet-deep to-violet-soft" />
        </div>
        <span className="font-mono text-[9px] text-violet-soft">68%</span>
      </div>
    </div>
  )
}

function PeopleMock({ active }: { active: boolean }) {
  const rows = [
    { c: '#8b5cf6', n: 'Maya', m: 'shared · study group', p: '94%' },
    { c: '#b8a4e0', n: 'Dev', m: 'late-night coders', p: '88%' },
    { c: '#5b21b6', n: 'Ava', m: 'both · 2am people', p: '91%' },
  ]
  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60',
        'mock-people',
        active && 'mock-active',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ice/10 px-3 py-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase">matches</p>
        <span className="font-mono text-[9px] text-violet-soft">2 new</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 px-3 py-2.5">
        {rows.map((r, i) => (
          <div key={r.n} className="avatar flex items-center gap-2" style={{ animationDelay: `${i * 90}ms` }}>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ice/20 text-[10px] font-bold text-frost"
              style={{ background: r.c }}
            >
              {r.n[0]}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[11px] font-semibold text-ice/85">{r.n}</p>
              <p className="truncate font-mono text-[8px] tracking-[0.08em] text-ice/40 uppercase">
                {r.m}
              </p>
            </div>
            <span className="font-mono text-[9px] text-violet-soft">{r.p}</span>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-ice/10 px-3 py-2">
        <span className="flex h-6 w-full items-center justify-center gap-1.5 rounded-full bg-violet/20 font-mono text-[9px] tracking-[0.16em] text-violet-soft uppercase">
          join a circle <span aria-hidden>→</span>
        </span>
      </div>
    </div>
  )
}

function BarsMock({ active }: { active: boolean }) {
  const days = [38, 62, 50, 78, 58, 45, 70]
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60',
        'mock-bars',
        active && 'mock-active',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ice/10 px-3 py-2">
        <p className="font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase">
          clubs · this wk
        </p>
        <span className="font-mono text-[9px] text-violet-soft">+18 active</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-end px-3 pt-3 pb-1.5">
        <div className="flex h-full items-end gap-1.5">
          {days.map((h, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              {i === 3 && (
                <span className="mock-btn font-mono text-[8px] tracking-[0.1em] text-violet-soft">
                  peak
                </span>
              )}
              <span
                className={clsx(
                  'bar w-full rounded-sm',
                  i === 3
                    ? 'bg-gradient-to-t from-violet-deep to-violet-soft'
                    : 'bg-gradient-to-t from-violet-deep/40 to-violet-soft/50',
                )}
                style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 text-center font-mono text-[8px] tracking-[0.05em] text-ice/35">
              {l}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-ice/10 px-3 py-2">
        <span className="font-mono text-[9px] text-ice/45">design jam · tomorrow</span>
        <span className="font-mono text-[9px] text-ice/35">4:20 pm</span>
      </div>
    </div>
  )
}

function RiskMock({ active }: { active: boolean }) {
  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60',
        'mock-risk',
        active && 'mock-active',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-ice/10 px-3.5 py-2">
        <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-ice/70 uppercase">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-soft" />
          risk console · live
        </p>
        <span className="font-mono text-[9px] tracking-[0.16em] text-ice/40 uppercase">auto-watch</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3.5 py-2">
        <span className="chip hero-chip" style={{ animationDelay: '0ms' }}>
          sentiment · dip
        </span>
        <span className="chip hero-chip" style={{ animationDelay: '110ms' }}>
          attendance ↓ 2×
        </span>
        <span className="chip hero-chip" style={{ animationDelay: '220ms' }}>
          grades · watch
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center px-4 pb-1">
        <div className="trail">
          <div className="trail-track">
            <div className="flex flex-col items-center gap-1.5">
              <span className="trail-node" />
              <span className="trail-label">detect</span>
            </div>
            <span className="trail-line" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="trail-node" />
              <span className="trail-label">nudge</span>
            </div>
            <span className="trail-line" />
            <div className="flex flex-col items-center gap-1.5">
              <span className="trail-node trail-node-on" />
              <span className="trail-label">follow-up</span>
            </div>
          </div>
          <span className="trail-pulse" aria-hidden />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-ice/10 px-3.5 py-2">
        <span className="font-mono text-[9px] tracking-[0.14em] text-ice/45 uppercase">
          detect · 3 signals
        </span>
        <span className="font-mono text-[9px] tracking-[0.14em] text-violet-soft uppercase">
          → caring nudge sent
        </span>
      </div>
    </div>
  )
}

const mocks = {
  chat: ChatMock,
  people: PeopleMock,
  bars: BarsMock,
  chart: GradesMock,
  risk: RiskMock,
}

type Feature = (typeof features)[number]

function BentoCard({ feature }: { feature: Feature }) {
  const [ref, inView] = useInView<HTMLElement>({ once: false, threshold: 0.3 })
  const Mock = mocks[feature.kind]

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  return (
    <Reveal key={feature.title} className={feature.span} delay={(Number(feature.n) % 2) * 90} mask>
      <article
        ref={ref}
        onPointerMove={handlePointerMove}
        className="bento-card group relative flex h-full flex-col rounded-2xl border border-ice/10 bg-white/[0.035] p-7 transition-all duration-500 hover:-translate-y-1 hover:border-ice/25 hover:bg-white/[0.05] hover:shadow-[0_24px_60px_rgba(0,0,0,0.35)] md:p-8"
      >
        <div className="flex items-center gap-2.5">
          <CrystalMark size="sm" spinOnView />
          <p className="font-mono text-[11px] tracking-[0.16em] text-ice/35">{feature.n}</p>
        </div>
        <h3 className="mt-4 font-display text-[22px] font-bold tracking-tight text-ice">
          {feature.title}
        </h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ice/50">{feature.description}</p>
        <div className="relative mt-6 flex min-h-24 flex-1 overflow-hidden rounded-xl">
          <div className="mock-ambient" aria-hidden />
          <div className="relative z-10 w-full">
            <Mock active={inView} />
          </div>
        </div>
      </article>
    </Reveal>
  )
}

export function FeatureBento() {
  return (
    <section id="features" className="relative scroll-mt-20 landing-frost py-20 text-ice sm:py-28">
      <GhostNum>01</GhostNum>
      <div className="relative z-10 mx-auto max-w-[1100px] px-5 sm:px-8 lg:px-10">
        <Reveal className="max-w-xl">
          <div className="section-marker" aria-hidden>
            <span className="h-px w-9 bg-gradient-to-r from-violet-soft/70 to-transparent" />
            <span className="font-mono text-[10px] tracking-[0.28em] text-ice/30 uppercase">
              01 · approach
            </span>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <CrystalMark spinOnView />
            <p className="font-mono text-[11px] tracking-[0.18em] text-ice/45 uppercase">Approach</p>
          </div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ice sm:text-5xl">
            Campus support, without the noise
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-ice/55">
            Well-being signals meet academic reality — designed to feel quiet, not like another
            dashboard.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-6">
          {features.map((feature) => (
            <BentoCard key={feature.n} feature={feature} />
          ))}
        </div>
      </div>
    </section>
  )
}