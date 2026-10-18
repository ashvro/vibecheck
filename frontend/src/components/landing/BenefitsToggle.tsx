import { useState } from 'react'
import clsx from 'clsx'
import { CrystalMark } from '../CrystalMark'
import { Reveal } from './Reveal'
import { GhostNum } from './GhostNum'

const steps = [
  {
    n: '01',
    title: 'Check in',
    body: 'A message in your own words — no forms, no judgment.',
    tie: 'talk it out',
    kind: 'pulse' as const,
  },
  {
    n: '02',
    title: 'AI routes support',
    body: 'Well-being, academics, or campus life — the backend classifies and responds.',
    tie: 'peer space',
    kind: 'routes' as const,
  },
  {
    n: '03',
    title: 'Early alerts',
    body: 'Institutions see risk early. Students get help before things spiral.',
    tie: 'catch risk early',
    kind: 'alerts' as const,
  },
]

const STEP_NODE_LEFT = ['16.5%', '50%', '83.5%']

const studentBenefits = [
  { title: 'Always-on companion', body: 'Mental health and academic questions whenever you need them.' },
  { title: 'Your VibeTag, your space', body: 'Peer community that lowers the bar on asking for help.' },
  { title: 'Real campus connection', body: 'Clubs and friend matches that fight the lonely lecture-hall vibe.' },
  { title: 'Clarity on academics', body: 'Attendance, grades, and upcoming assessments in one place.' },
  { title: 'Support that adapts', body: 'Your context quietly feeds better, more personal support.' },
]

const educatorBenefits = [
  { title: 'Early warning, not panic', body: 'Risk matrix from attendance and grades.' },
  { title: 'Faculty tools that stick', body: 'Marks and attendance entry without five portals.' },
  { title: 'Prioritized interventions', body: 'Recommendations ordered by urgency.' },
  { title: 'Privacy-aware trends', body: 'Campus wellness signals without voyeuristic dashboards.' },
  { title: 'Crisis pathways ready', body: 'Escalation aligned with counseling protocols.' },
]

function StepPulse() {
  return (
    <div className="step-mock mt-4 rounded-xl border border-ice/10 bg-surface-2/60 p-3">
      <div className="flex items-center gap-2.5">
        <span className="bubble flex min-h-[32px] flex-1 items-center rounded-lg bg-thaw px-2 py-1.5 text-[10px] leading-snug text-ice/75">
          “heavy today.”
        </span>
        <div className="flex items-end gap-1">
          {[40, 65, 100, 55].map((h, i) => (
            <span
              key={i}
              className={clsx(
                'mood-bar w-1.5 rounded-sm bg-gradient-to-t from-violet-deep to-violet-soft',
                i === 2 && 'ring-1 ring-violet-soft/40',
              )}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[8px] text-ice/40">
        <span className="h-1 w-1 rounded-full bg-emerald-soft" /> message · heard
      </div>
    </div>
  )
}

function StepRoutes() {
  return (
    <div className="step-mock mt-4 rounded-xl border border-ice/10 bg-surface-2/60 p-3">
      <div className="flex items-center gap-2">
        <span className="bubble min-w-0 flex-1 truncate rounded-lg border border-ice/15 bg-thaw px-2 py-1.5 text-[10px] text-ice/70">
          exam week hit
        </span>
        <span className="route-arrow font-mono text-sm text-violet-soft">→</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {['well-being', 'academics', 'campus'].map((c, i) => (
          <span
            key={c}
            className={clsx(
              'route-chip rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.1em] uppercase',
              i === 0
                ? 'border-violet/40 bg-violet/15 text-violet-soft'
                : 'border-ice/15 bg-ice/5 text-ice/45',
            )}
          >
            {c}
          </span>
        ))}
      </div>
    </div>
  )
}

function StepAlerts() {
  return (
    <div className="step-mock mt-4 rounded-xl border border-ice/10 bg-surface-2/60 px-3 py-2.5">
      <div className="trail">
        <div className="trail-track">
          <div className="flex flex-col items-center gap-1">
            <span className="trail-node" />
            <span className="trail-label">detect</span>
          </div>
          <span className="trail-line" />
          <div className="flex flex-col items-center gap-1">
            <span className="trail-node" />
            <span className="trail-label">nudge</span>
          </div>
          <span className="trail-line" />
          <div className="flex flex-col items-center gap-1">
            <span className="trail-node trail-node-on" />
            <span className="trail-label">follow-up</span>
          </div>
        </div>
        <span className="trail-pulse" aria-hidden />
      </div>
    </div>
  )
}

const stepMocks = {
  pulse: StepPulse,
  routes: StepRoutes,
  alerts: StepAlerts,
}



export function BenefitsToggle() {
  const [tab, setTab] = useState<'students' | 'educators'>('students')
  const items = tab === 'students' ? studentBenefits : educatorBenefits

  return (
    <>
      <section
        id="how"
        className="relative scroll-mt-20 border-t border-ice/10 bg-thaw py-20 text-ice sm:py-28"
      >
        <GhostNum>02</GhostNum>
        <div className="relative z-10 mx-auto max-w-[1100px] px-5 sm:px-8 lg:px-10">
          <Reveal>
            <div className="section-marker" aria-hidden>
              <span className="h-px w-9 bg-gradient-to-r from-violet-soft/70 to-transparent" />
              <span className="font-mono text-[10px] tracking-[0.28em] text-ice/30 uppercase">
                02 · how it works
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <CrystalMark spinOnView />
              <p className="font-mono text-[11px] tracking-[0.18em] text-ice/45 uppercase">
                How it works
              </p>
            </div>
            <h2 className="mt-4 max-w-lg font-display text-3xl font-bold tracking-tight sm:text-5xl">
              Three quiet steps to clarity
            </h2>
          </Reveal>

          <div className="relative mt-14">
            <Reveal className="absolute inset-x-0 top-[1.2rem] z-10">
              <div className="steps-progress" />
              {STEP_NODE_LEFT.map((left, i) => (
                <span key={i} className="step-node pointer-events-none hidden md:flex" style={{ left }}>
                  {i + 1}
                </span>
              ))}
            </Reveal>

            <div className="grid gap-10 md:grid-cols-3 md:gap-8 mt-32">
              {steps.map((step, i) => {
                const Mock = stepMocks[step.kind]
                return (
                  <Reveal key={step.n} delay={i * 120 + 300}>
                    <div className="landing-facet flex h-full flex-col pt-6">
                      <h3 className="mt-3 font-display text-xl font-bold text-ice">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-ice/50">{step.body}</p>
                      <Mock />
                      <a
                        href="#features"
                        className="mt-4 inline-flex items-center gap-1.5 self-start font-mono text-[9px] tracking-[0.16em] text-violet-soft/80 uppercase transition hover:text-violet-soft"
                      >
                        ↳ {step.tie} <span aria-hidden>→</span>
                      </a>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>

        </div>
      </section>

      <section
        id="students"
        className="relative scroll-mt-20 overflow-hidden border-t border-ice/10 landing-frost py-20 text-ice sm:py-28"
      >
        <GhostNum>03</GhostNum>
        <div
          className="haze-blob pointer-events-none absolute -right-40 top-1/3 h-[34rem] w-[34rem] rounded-full bg-violet/10 blur-[120px]"
          aria-hidden
        />
        <div id="institutions" className="mx-auto max-w-[1100px] scroll-mt-20 px-5 sm:px-8 lg:px-10">
          <div className="relative z-10 grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start lg:gap-16">
            <div>
              <Reveal>
                <div className="section-marker" aria-hidden>
                  <span className="h-px w-9 bg-gradient-to-r from-violet-soft/70 to-transparent" />
                  <span className="font-mono text-[10px] tracking-[0.28em] text-ice/30 uppercase">
                    03 · science
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <CrystalMark spinOnView />
                  <p className="font-mono text-[11px] tracking-[0.18em] text-ice/45 uppercase">
                    Science
                  </p>
                </div>
                <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl">
                  For the 2am spiral.
                  <br />
                  <span className="text-ice/40">And the 9am briefing.</span>
                </h2>
                <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ice/50">
                  Same product, two energies — support that meets people where they are.
                </p>
              </Reveal>

              <div className="mt-8 flex gap-8 border-b border-ice/10">
                {(
                  [
                    { id: 'students', label: 'For Students' },
                    { id: 'educators', label: 'For Educators' },
                  ] as const
                ).map((option) => {
                  const isActive = tab === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setTab(option.id)}
                      className={clsx(
                        'relative pb-3 font-mono text-[11px] font-medium tracking-[0.14em] uppercase transition',
                        isActive ? 'text-ice' : 'text-ice/40 hover:text-ice/70',
                      )}
                    >
                      {option.label}
                      {isActive && <span className="tab-underline absolute inset-x-0 -bottom-px h-px" />}
                    </button>
                  )
                })}
              </div>
            </div>

            <ol key={tab} className="border-t border-ice/10">
              {items.map((item, i) => (
                <li
                  key={item.title}
                  className="animate-fade-up flex gap-4 border-b border-ice/10 py-5 transition hover:bg-ice/[0.03]"
                  style={{ animationDelay: `${i * 55}ms` }}
                >
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center">
                    <CrystalMark size="sm" spinOnView />
                  </span>
                  <div>
                    <p className="font-display text-[15px] font-bold tracking-tight text-ice">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ice/50">{item.body}</p>
                  </div>
                  <span className="ml-auto hidden font-mono text-[11px] text-ice/25 sm:block">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </>
  )
}