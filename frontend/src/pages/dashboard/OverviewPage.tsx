import { useEffect, useState } from 'react'
import {
  CalendarDays,
  Clock,
  GraduationCap,
  MessageSquareText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { CrystalMark } from '../../components/CrystalMark'
import { api, getUser } from '../../lib/api'
import { mlApi, type MlRisk, type MlSummary } from '../../lib/ml'

type StatCard = {
  label: string
  value: string
  unit?: string
  icon: LucideIcon
  bar?: number
  kind?: 'risk' | 'academics'
}

type Summary = {
  messages: number
  posts: number
  clubs: number
  enrollments: number
  avgAttendance: number | null
  cgpa: number | null
}

type Todo = {
  id: string
  title: string
  course: string
  date: string
  daysLeft: number | null
  kind: 'quiz' | 'assignment'
  enrolled?: boolean
}

const riskLevels = ['Low', 'Mid', 'High']
const academicsLevels = ['At risk', 'Average', 'On track', 'Strong', 'Outstanding']

const kindColors: Record<string, string> = {
  quiz: 'bg-violet/15 text-violet-soft border-violet/30',
  assignment: 'bg-ice/10 text-ice border-ice/25',
  midterm: 'bg-amber-gentle/15 text-amber-gentle border-amber-gentle/30',
  exam: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
}

/** The model emits Low | Medium | High; the card keeps its original "Mid" label. */
function mlPosition(risk: MlRisk): number {
  return risk === 'High' ? 2 : risk === 'Medium' ? 1 : 0
}

/**
 * Risk is now driven by the ML model rather than attendance alone, but the
 * card stays empty until the model has both real features — attendance and
 * CGPA. A new user with no interaction has neither, so the initial state is a
 * plain "Low" with no score.
 */
function riskKind(ml: MlSummary | null): { label: string; position: number; score: number | null } {
  const latest = ml?.latest ?? null
  if (!latest || latest.imputed.length > 0) return { label: 'Low', position: 0, score: null }
  const position = mlPosition(latest.risk)
  return { label: riskLevels[position], position, score: latest.score }
}

function academicKind(cgpa: number | null): { label: string; index: number } {
  if (cgpa === null || cgpa < 5) return { label: 'At risk', index: 0 }
  if (cgpa < 7) return { label: 'Average', index: 1 }
  if (cgpa < 8.5) return { label: 'On track', index: 2 }
  if (cgpa < 9.5) return { label: 'Strong', index: 3 }
  return { label: 'Outstanding', index: 4 }
}

function RiskContent({ ml }: { ml: MlSummary | null }) {
  const risk = riskKind(ml)
  return (
    <>
      <p className="mt-3 flex items-baseline gap-1.5 text-xl font-semibold tracking-tight text-ink">
        <span className="font-display tabular-nums">{risk.label}</span>
        {risk.score != null && (
          <span className="text-xs font-normal text-muted">{risk.score} / 100 risk</span>
        )}
      </p>
      <div className="mt-2.5">
        <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-soft/40 via-amber-gentle/40 to-rose-400/40">
          <span
            className={clsx(
              'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-thaw-deep shadow-[0_0_10px_rgba(157,184,168,0.6)]',
              risk.position === 2 ? 'left-[98%] bg-rose-400' : risk.position === 1 ? 'left-1/2 bg-amber-gentle' : 'left-[2%] bg-emerald-soft',
            )}
          />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[8px] tracking-[0.1em] text-muted uppercase">
          {riskLevels.map((lvl) => (
            <span key={lvl}>{lvl}</span>
          ))}
        </div>
      </div>
    </>
  )
}

function AcademicsContent({ cgpa }: { cgpa: number | null }) {
  const acad = academicKind(cgpa)
  return (
    <>
      <p className="mt-3 flex items-baseline gap-1.5 text-xl font-semibold tracking-tight text-ink">
        <span className="font-display tabular-nums">{acad.label}</span>
        {cgpa != null && <span className="text-xs font-normal text-muted">{cgpa.toFixed(1)} / 10</span>}
      </p>
      <div className="mt-2.5 flex gap-1">
        {academicsLevels.map((lvl, i) => (
          <div
            key={lvl}
            className={clsx(
              'h-1.5 flex-1 rounded-sm',
              i <= acad.index ? 'bg-gradient-to-r from-emerald-soft/60 to-emerald-soft' : 'bg-line/60',
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[8px] tracking-[0.1em] text-muted uppercase">
        {academicsLevels.map((lvl, i) => (
          <span key={lvl} className={clsx(i === acad.index && 'text-emerald-soft')}>
            {lvl}
          </span>
        ))}
      </div>
    </>
  )
}

export function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [ml, setMl] = useState<MlSummary | null>(null)
  const [todos, setTodos] = useState<Todo[]>([])
  const user = getUser()

  useEffect(() => {
    api
      .get<Summary>('/api/analytics/summary')
      .then(setSummary)
      .catch(() => setSummary(null))
    mlApi
      .summary()
      .then(setMl)
      .catch(() => setMl(null))
    api
      .get<Todo[]>('/api/lms/todos')
      .then(setTodos)
      .catch(() => setTodos([]))
  }, [])

  const firstName = user?.name ? String(user.name).split(' ')[0] : 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const statCards: StatCard[] = [
    {
      label: 'Community posts',
      value: String(summary?.posts ?? 0),
      unit: 'shared',
      icon: MessageSquareText,
    },
    {
      label: 'Attendance',
      value: summary?.avgAttendance != null ? String(summary.avgAttendance) : '—',
      unit: '%',
      icon: CalendarDays,
      bar: summary?.avgAttendance ?? undefined,
    },
    { label: 'Risk', value: riskKind(ml).label, icon: ShieldCheck, kind: 'risk' },
    { label: 'Academics', value: academicKind(summary?.cgpa ?? null).label, icon: GraduationCap, kind: 'academics' },
  ]

  const tdo = (todos || [])
    .filter((t) => t.enrolled !== false)
    .map((q, i) => ({
      id: q.id ?? String(i),
      title: q.title,
      course: q.course ?? 'Course',
      date: q.date ?? '',
      daysLeft: q.daysLeft ?? 0,
      kind: q.kind ?? 'quiz',
    }))

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="border-b border-line pb-8">
        <div className="mb-3 flex items-center gap-3">
          <CrystalMark spinOnView />
          <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Overview</p>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {greeting}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted">{today} · {time}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {statCards.map(({ label, value, unit, icon: Icon, bar, kind }) => (
          <div key={label} className="glass-ice rounded-xl px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ice/15 bg-ice/[0.06] text-ice">
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                {label}
              </p>
            </div>

            {kind === 'risk' && <RiskContent ml={ml} />}
            {kind === 'academics' && <AcademicsContent cgpa={summary?.cgpa ?? null} />}

            {!kind && (
              <>
                <p className="mt-3 flex items-baseline gap-1.5 text-xl font-semibold tracking-tight text-ink">
                  <span className="font-display tabular-nums">{value}</span>
                  {unit && <span className="text-xs font-normal text-muted">{unit}</span>}
                </p>
                {bar !== undefined && (
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line/70">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet to-violet-soft"
                      style={{ width: `${bar}%` }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <section className="glass-ice p-6">
        <div className="flex items-center gap-2.5">
          <CrystalMark size="sm" spinOnView />
          <h2 className="text-sm font-semibold text-ink">To-do list</h2>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
            <Clock className="h-3 w-3 text-ice/50" /> {tdo.length} upcoming
          </span>
        </div>

        <ul className="mt-4 space-y-2.5">
          {tdo.length === 0 && (
            <li className="rounded-xl border border-ice/10 bg-white/[0.03] px-3.5 py-3 text-sm text-muted">
              No upcoming quizzes or assignments — enjoy the calm.
            </li>
          )}
          {tdo.map(({ id, title, course, date, daysLeft, kind }) => (
            <li
              key={id}
              className="group flex items-center gap-3.5 rounded-xl border border-ice/10 bg-white/[0.03] px-3.5 py-3 transition hover:border-ice/25 hover:bg-white/[0.05]"
            >
              <span
                className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                  daysLeft <= 2 ? 'border-violet/50 bg-violet/15' : 'border-ice/15',
                )}
              >
                <span
                  className={clsx(
                    'h-1.5 w-1.5 rounded-full',
                    daysLeft <= 2 ? 'bg-ice-bright' : 'bg-ice/30',
                  )}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink/90">
                  {title}
                </span>
                <span className="mt-0.5 flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                  {course} <span className="text-ice/20">·</span> {date || 'No date set'}
                </span>
              </span>

              <span
                className={clsx(
                  'shrink-0 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.1em] uppercase',
                  kindColors[kind] ?? kindColors.quiz,
                )}
              >
                {daysLeft == null
                  ? 'Upcoming'
                  : daysLeft === 0
                    ? 'Today'
                    : daysLeft === 1
                      ? '1 day'
                      : `${daysLeft} days`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}