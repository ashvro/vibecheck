import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { api, getUser } from '../../lib/api'
import { mlApi, type MlRisk, type MlSummary } from '../../lib/ml'

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

/** The percentage most universities expect a student to stay above. */
const ATTENDANCE_MILESTONE = 75

/**
 * The model emits Low | Medium | High. The overview panel spells the middle
 * band out in full so the row reads as prose rather than a class code.
 */
const riskLabels: Record<MlRisk, string> = {
  Low: 'Low',
  Medium: 'Moderate',
  High: 'High',
}

const kindColors: Record<string, string> = {
  quiz: 'bg-violet/15 text-violet-soft border-violet/30',
  assignment: 'bg-ice/10 text-ice border-ice/25',
  midterm: 'bg-amber-gentle/15 text-amber-gentle border-amber-gentle/30',
  exam: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
}

/**
 * Risk is driven by the ML model rather than attendance alone, but the row
 * stays empty until the model has both real features — attendance and CGPA. A
 * new user with no interaction has neither, so the initial state is a plain
 * "Low" with no score.
 */
function riskKind(ml: MlSummary | null): { label: string; score: number | null } {
  const latest = ml?.latest ?? null
  if (!latest || latest.imputed.length > 0) return { label: riskLabels.Low, score: null }
  return { label: riskLabels[latest.risk], score: latest.score }
}

function academicKind(cgpa: number | null): string {
  if (cgpa === null || cgpa < 5) return 'At risk'
  if (cgpa < 7) return 'Average'
  if (cgpa < 8.5) return 'On track'
  if (cgpa < 9.5) return 'Strong'
  return 'Outstanding'
}

/** Label on the left, optional muted value on the right — the row's title band. */
function RowHeading({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 leading-none">
      <h2 className="text-[15px] font-medium text-ink/85">{label}</h2>
      {value != null && <span className="text-[15px] text-muted">{value}</span>}
    </div>
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
  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  /* Composed from parts rather than one toLocaleDateString call so the order
     stays "Monday 19 October" whatever the viewer's locale prefers. */
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' })
  const day = now.toLocaleDateString(undefined, { day: 'numeric' })
  const month = now.toLocaleDateString(undefined, { month: 'long' })
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  const attendance = summary?.avgAttendance ?? null
  const cgpa = summary?.cgpa ?? null
  const posts = summary?.posts ?? 0
  const risk = riskKind(ml)
  const academicLabel = academicKind(cgpa)

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

  /* The lede is assembled from the two facts the page has: how attendance is
     sitting, and whether anything is due. */
  const attendanceLine =
    attendance == null
      ? 'Your attendance has not been recorded yet.'
      : attendance < ATTENDANCE_MILESTONE
        ? 'Your attendance is below the mark most universities ask for.'
        : attendance < 90
          ? 'Your attendance is a little under where it was.'
          : 'Your attendance is holding up well.'
  const dueLine =
    tdo.length === 0
      ? 'Nothing is due soon, so tonight is a good time to catch up.'
      : `You have ${tdo.length} ${tdo.length === 1 ? 'deadline' : 'deadlines'} coming up — start with the closest one.`

  const buffer = attendance == null ? null : Math.round(attendance - ATTENDANCE_MILESTONE)
  const attendanceNote =
    buffer == null
      ? 'Attendance is averaged across the courses you are enrolled in.'
      : buffer >= 0
        ? `Most universities ask for ${ATTENDANCE_MILESTONE}%, so you have a small buffer of ${buffer} ${buffer === 1 ? 'point' : 'points'}.`
        : `Most universities ask for ${ATTENDANCE_MILESTONE}%, so you are ${Math.abs(buffer)} ${Math.abs(buffer) === 1 ? 'point' : 'points'} short.`

  return (
    <div className="rise-grid mx-auto max-w-6xl">
      <header>
        <p className="text-[15px] leading-none text-muted">
          {weekday} {day} {month}, {time}
        </p>
        <h1 className="mt-1.5 text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-[3.375rem]">
          {greeting}, {firstName}.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-[17px]">
          {attendanceLine} {dueLine}
        </p>
      </header>

      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[1.25fr_1fr] lg:gap-14">
        <section className="rounded-3xl bg-surface p-7 sm:p-9">
          <RowHeading label="Attendance" value="This semester" />

          <p className="mt-3 text-6xl font-semibold tracking-tight text-ink tabular-nums sm:text-7xl lg:text-8xl">
            {attendance != null ? (
              <>
                {attendance}
                <span className="text-lg leading-none font-normal text-muted sm:text-xl">%</span>
              </>
            ) : (
              '—'
            )}
          </p>

          <div className="mt-10 h-3 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet to-violet-soft"
              style={{ width: `${attendance ?? 0}%` }}
            />
          </div>

          <p className="mt-5 text-[15px] leading-relaxed text-muted">{attendanceNote}</p>
        </section>

        <section>
          <div className="border-b border-ice/10 pb-6">
            <RowHeading
              label="Risk"
              value={risk.score != null ? `${risk.score} of 100` : undefined}
            />
            <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl lg:text-[2.625rem]">
              {risk.label}
            </p>
            <div className="relative mt-4 h-1.5 rounded-full bg-gradient-to-r from-emerald-soft via-amber-gentle to-rose-400">
              {risk.score != null && (
                <span
                  className="absolute top-1/2 h-3.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink"
                  style={{ left: `${Math.min(100, Math.max(0, risk.score))}%` }}
                />
              )}
            </div>
          </div>

          <div className="border-b border-ice/10 pt-7 pb-6">
            <RowHeading label="Academics" value={academicLabel} />
            <p className="mt-1.5 text-3xl font-semibold tracking-tight text-ink tabular-nums sm:text-4xl lg:text-[2.625rem]">
              {cgpa != null ? (
                <>
                  {cgpa.toFixed(1)}
                  <span className="text-lg leading-none font-normal text-muted sm:text-xl">
                    {' / 10'}
                  </span>
                </>
              ) : (
                '—'
              )}
            </p>
          </div>

          <div className="border-b border-ice/10 pt-7 pb-12">
            <RowHeading label="Community posts" value={`${posts} shared`} />
          </div>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">To-do</h2>
          <span className="text-[15px] text-muted">
            {tdo.length === 0 ? 'Nothing upcoming' : `${tdo.length} upcoming`}
          </span>
        </div>

        {tdo.length === 0 ? (
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            No quizzes or assignments are due. Enjoy the calm.
          </p>
        ) : (
          <ul className="mt-4">
            {tdo.map(({ id, title, course, date, daysLeft, kind }) => (
              <li
                key={id}
                className="flex items-center gap-4 border-b border-ice/10 py-4 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink/90">{title}</span>
                  <span className="mt-1 block truncate text-[13px] text-muted">
                    {course}
                    {date ? ` · ${date}` : ''}
                  </span>
                </span>
                <span
                  className={clsx(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px]',
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
        )}
      </section>
    </div>
  )
}
