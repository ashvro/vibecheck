import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChevronRight, ShieldCheck } from 'lucide-react'
import { MlRiskPanel } from '../../components/ml/MlRiskPanel'
import { PageHeader } from '../../components/PageHeader'
import {
  analyticsApi,
  nextStepFor,
  riskBar,
  riskTone,
  type AuditEntry,
  type CourseInsight,
  type InsightRow,
  type Insights,
  type ModelGovernance,
  type Referral,
  type RiskLevel,
} from '../../lib/analytics'
import { mlApi, mlRiskStyles, type MlSummary } from '../../lib/ml'

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

const CHART_TOOLTIP = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-line)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-ink)',
}

const AXIS_TICK = { fontSize: 10, fill: 'var(--chart-tick)' }

/** Short course label for a crowded x-axis: "CS301 · Databases" -> "CS301". */
function codeOf(subject: string) {
  return subject.split('·')[0].trim()
}

function avgOf(values: (number | null)[]) {
  const nums = values.filter((v): v is number => v != null)
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>
}

function StatChip({
  label,
  value,
  unit,
  tone,
}: {
  label: string
  value: string
  unit?: string
  tone?: string
}) {
  return (
    <div className="glass-ice rounded-xl px-3.5 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums tracking-tight', tone ?? 'text-ink')}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </p>
    </div>
  )
}

function ChartCard({
  title,
  caption,
  aside,
  children,
}: {
  title: string
  caption?: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="glass-ice rounded-xl p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-ink">{title}</h3>
        {aside ? (
          <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {aside}
          </span>
        ) : null}
      </div>
      {caption ? <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{caption}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex h-[200px] items-center justify-center px-6 text-center text-xs leading-relaxed text-muted">
      {children}
    </p>
  )
}

/* ------------------------------------------------------------------ *
 * Charts
 * ------------------------------------------------------------------ */

type BarPoint = { label: string; primary: number | null; secondary?: number | null }

/** Marks per course. Students compare IA1 vs IA2; staff see the course average. */
function MarksChart({ points, compare }: { points: BarPoint[]; compare: boolean }) {
  const data = points.filter((p) => p.primary != null || p.secondary != null)
  if (!data.length) return <ChartEmpty>No marks recorded yet.</ChartEmpty>
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} interval={0} />
        <YAxis domain={[0, 100]} tick={AXIS_TICK} />
        <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'var(--chart-cursor)' }} />
        {compare ? (
          <>
            <Legend wrapperStyle={{ fontSize: 10, color: 'var(--chart-tick)' }} />
            <Bar dataKey="primary" name="IA1" fill="#7c5cfa" radius={[3, 3, 0, 0]} maxBarSize={20} />
            <Bar dataKey="secondary" name="IA2" fill="#4ade80" radius={[3, 3, 0, 0]} maxBarSize={20} />
          </>
        ) : (
          <Bar dataKey="primary" name="Marks" fill="#7c5cfa" radius={[3, 3, 0, 0]} maxBarSize={32} />
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

function AttendanceChart({ points }: { points: { label: string; value: number | null }[] }) {
  const data = points.filter((p) => p.value != null)
  if (!data.length) return <ChartEmpty>No attendance recorded yet.</ChartEmpty>
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} interval={0} />
        <YAxis domain={[0, 100]} tick={AXIS_TICK} />
        <Tooltip
          contentStyle={CHART_TOOLTIP}
          cursor={{ fill: 'var(--chart-cursor)' }}
          formatter={(v) => [`${v}%`, 'Attendance']}
        />
        <Bar dataKey="value" name="Attendance" fill="#7dd3fc" radius={[3, 3, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ------------------------------------------------------------------ *
 * Staff: course roll-up, referrals, governance, audit
 * ------------------------------------------------------------------ */

function Disclosure({
  title,
  meta,
  children,
}: {
  title: string
  meta?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details className="group glass-ice rounded-xl">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-ice/60 transition group-open:rotate-90" />
        <span className="text-sm font-semibold text-ink">{title}</span>
        {meta ? (
          <span className="ml-auto font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
            {meta}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-line px-4 pt-4 pb-5">{children}</div>
    </details>
  )
}

function CourseRollup({ courses }: { courses: CourseInsight[] }) {
  if (!courses.length) {
    return (
      <EmptyState>
        No courses are assigned to you yet. An admin assigns a course by setting its instructor — until
        then you cannot see its students.
      </EmptyState>
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {courses.map((c) => (
        <div key={c.id} className="rounded-xl border border-ice/10 tint-subtle px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-ink">{c.subject}</p>
            <span
              className={clsx(
                'shrink-0 px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                c.atRisk > 0 ? riskTone.Medium : riskTone.Low,
              )}
            >
              {c.atRisk} need attention
            </span>
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                { k: 'Students', v: c.students },
                { k: 'Attendance', v: c.avgAttendance != null ? `${c.avgAttendance}%` : '—' },
                { k: 'Marks', v: c.avgMarks != null ? `${c.avgMarks}%` : '—' },
              ] as const
            ).map((x) => (
              <div key={x.k}>
                <dt className="font-mono text-[9px] tracking-[0.1em] text-muted uppercase">{x.k}</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{x.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function ReferButton({ row, onDone }: { row: InsightRow; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('Slipping attendance or marks')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      await analyticsApi.raiseReferral({ studentId: row.studentId, courseId: row.courseId, reason })
      setOpen(false)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not raise referral')
    } finally {
      setBusy(false)
    }
  }

  if (row.referralOpen) {
    return (
      <span className="font-mono text-[10px] tracking-[0.1em] text-amber-gentle uppercase">referred</span>
    )
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-ice/20 px-2 py-1 text-[11px] text-ice/80 transition hover:border-ice/40 hover:bg-ice/5"
      >
        Refer for support
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-lg border border-ice/15 bg-thaw px-2 py-1 text-[11px] text-ice/80 outline-none focus:border-ice/35"
      >
        {[
          'Slipping attendance or marks',
          'Repeatedly absent',
          'Needs a wellbeing check-in',
          'Other academic concern',
        ].map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        onClick={submit}
        disabled={busy}
        className="rounded-lg bg-ice/15 px-2 py-1 text-[11px] font-medium text-ice transition hover:bg-ice/25 disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Confirm'}
      </button>
      <button onClick={() => setOpen(false)} className="text-[11px] text-muted hover:text-ink">
        Cancel
      </button>
      {err && <span className="text-[11px] text-rose-400">{err}</span>}
    </div>
  )
}

function ReferralQueue({ referrals, onChanged }: { referrals: Referral[]; onChanged: () => void }) {
  if (!referrals.length) {
    return <EmptyState>No referrals yet. Raise one from a student row above.</EmptyState>
  }
  return (
    <div className="divide-y divide-line border-y border-line">
      {referrals.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              <span className="font-semibold">{r.student ?? 'Unknown student'}</span>
              {r.course && <span className="text-muted"> · {r.course}</span>}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {r.reason} · raised by {r.raisedBy ?? 'unknown'}
            </p>
          </div>
          <span
            className={clsx(
              'px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase',
              r.status === 'open'
                ? riskTone.High
                : r.status === 'acknowledged'
                  ? riskTone.Medium
                  : riskTone.Low,
            )}
          >
            {r.status}
          </span>
          {r.canResolve && r.status !== 'closed' && (
            <button
              onClick={async () => {
                await analyticsApi.resolveReferral(r.id, r.status === 'open' ? 'acknowledged' : 'closed')
                onChanged()
              }}
              className="rounded-lg border border-ice/20 px-2 py-1 text-[11px] text-ice/80 transition hover:border-ice/40 hover:bg-ice/5"
            >
              {r.status === 'open' ? 'Acknowledge' : 'Close'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

function Governance({ model }: { model: ModelGovernance | null }) {
  if (!model) return <EmptyState>Model card unavailable.</EmptyState>
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(
        [
          { k: 'Test accuracy', v: `${model.accuracyTest}%` },
          { k: 'Full-sample accuracy', v: `${model.accuracyFull}%` },
          { k: 'Students fully observed', v: `${model.coverage.pct}%` },
        ] as const
      ).map((x) => (
        <div key={x.k} className="rounded-xl border border-ice/10 tint-subtle px-4 py-3">
          <p className="font-mono text-[9px] tracking-[0.12em] text-muted uppercase">{x.k}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{x.v}</p>
        </div>
      ))}
      <div className="sm:col-span-3">
        <p className="text-xs leading-relaxed text-muted">
          <span className="text-ink/80">{model.primaryModel}</span> · v{model.version} ·{' '}
          {model.dataset.rows} training records ({model.dataset.trainRows} train / {model.dataset.testRows}{' '}
          test). {model.coverage.fullyObserved} of {model.coverage.students} students currently have all
          features observed; the rest are scored with neutral imputation and flagged as such.
        </p>
      </div>
    </div>
  )
}

function AuditTrail({ entries }: { entries: AuditEntry[] }) {
  if (!entries.length) return <EmptyState>No staff access recorded yet.</EmptyState>
  return (
    <div className="max-h-80 overflow-y-auto border-y border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-thaw/95 backdrop-blur">
          <tr className="font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
            <th className="py-2 pr-3 font-normal">Staff</th>
            <th className="py-2 pr-3 font-normal">Action</th>
            <th className="py-2 pr-3 font-normal">Student</th>
            <th className="py-2 font-normal">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {entries.map((e) => (
            <tr key={e.id} className="text-muted">
              <td className="py-1.5 pr-3 text-ink/90">
                {e.actor}
                <span className="ml-1 text-muted/60">({e.actorRole})</span>
              </td>
              <td className="py-1.5 pr-3 font-mono text-[10px]">{e.action}</td>
              <td className="py-1.5 pr-3">{e.target ?? <span className="text-muted/50">—</span>}</td>
              <td className="py-1.5 tabular-nums">{new Date(e.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export function AnalyticsPage() {
  const [insights, setInsights] = useState<Insights | null>(null)
  const [ml, setMl] = useState<MlSummary | null>(null)
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [model, setModel] = useState<ModelGovernance | null>(null)
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [filter, setFilter] = useState<'All' | RiskLevel>('All')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const [i, m] = await Promise.all([
        analyticsApi.insights(),
        // The student's own prediction; staff get an institution distribution
        // here, which this compact page does not need.
        mlApi.summary().catch(() => null),
      ])
      setInsights(i)
      setMl(m)
      // Referrals are staff-only; a 403 here is expected for students.
      analyticsApi
        .referrals()
        .then(setReferrals)
        .catch(() => setReferrals([]))
      if (i.viewer.role === 'admin') {
        analyticsApi.model().then(setModel).catch(() => setModel(null))
        analyticsApi.audit().then(setAudit).catch(() => setAudit([]))
      }
    } catch {
      setInsights(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(() => {
    if (!insights) return []
    return filter === 'All' ? insights.rows : insights.rows.filter((r) => r.risk === filter)
  }, [insights, filter])

  if (loading) {
    return <p className="py-10 text-center text-sm text-muted">Loading analytics…</p>
  }

  if (!insights) {
    return <p className="py-10 text-center text-sm text-muted">Analytics unavailable.</p>
  }

  const role = insights.viewer.role
  const isStudent = role === 'student'
  const isAdmin = role === 'admin'

  // Students chart their own courses; staff chart course averages.
  const marksPoints: BarPoint[] = isStudent
    ? insights.rows.map((r) => ({ label: codeOf(r.subject), primary: r.ia1, secondary: r.ia2 }))
    : insights.courses.map((c) => ({ label: codeOf(c.subject), primary: c.avgMarks, secondary: null }))

  const attendancePoints = isStudent
    ? insights.rows.map((r) => ({ label: codeOf(r.subject), value: r.attendance }))
    : insights.courses.map((c) => ({ label: codeOf(c.subject), value: c.avgAttendance }))

  const avgAttendance = avgOf(
    isStudent ? insights.rows.map((r) => r.attendance) : insights.courses.map((c) => c.avgAttendance),
  )
  const avgMarks = avgOf(
    isStudent ? insights.rows.map((r) => r.marks) : insights.courses.map((c) => c.avgMarks),
  )

  const stats: { label: string; value: string; unit?: string; tone?: string }[] = isStudent
    ? [
        {
          label: 'Risk',
          value: ml?.latest?.risk ?? '—',
          tone: ml?.latest ? mlRiskStyles[ml.latest.risk].text : undefined,
        },
        { label: 'Attendance', value: avgAttendance != null ? String(avgAttendance) : '—', unit: '%' },
        { label: 'Marks', value: avgMarks != null ? String(avgMarks) : '—', unit: '%' },
      ]
    : [
        { label: 'Students', value: String(insights.students) },
        { label: 'At risk', value: String(insights.counts.Medium + insights.counts.High) },
        { label: 'Avg attendance', value: avgAttendance != null ? String(avgAttendance) : '—', unit: '%' },
      ]

  return (
    <div className="rise-grid mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="Insights"
        title={isStudent ? 'Your analysis' : 'Risk analytics'}
        description={
          isStudent
            ? 'Marks and attendance — and the dropout risk they add up to.'
            : isAdmin
              ? 'Institution-wide risk, model governance and the staff access trail.'
              : 'Risk across the courses you teach.'
        }
        aside={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ice/15 bg-ice/[0.06] px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] text-ice/80 uppercase">
            <ShieldCheck className="h-3 w-3" />
            {insights.viewer.scope}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <StatChip key={s.label} label={s.label} value={s.value} unit={s.unit} tone={s.tone} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Marks"
          caption={isStudent ? 'IA1 vs IA2 by course.' : 'Average marks by course.'}
        >
          <MarksChart points={marksPoints} compare={isStudent} />
        </ChartCard>

        <ChartCard
          title="Attendance"
          caption={isStudent ? 'Attendance % by course.' : 'Average attendance by course.'}
        >
          <AttendanceChart points={attendancePoints} />
        </ChartCard>
      </div>

      {!isStudent && (
        <>
          <Disclosure
            title="Students & courses"
            meta={`${insights.students} students · ${insights.openReferrals} open referrals`}
          >
            <CourseRollup courses={insights.courses} />

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink">Students</h3>
              <div className="ml-auto flex gap-1">
                {(['All', 'Low', 'Medium', 'High'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={clsx(
                      'rounded-lg px-2 py-1 font-mono text-[10px] tracking-[0.1em] uppercase transition',
                      filter === f ? 'bg-ice/15 text-ice' : 'text-muted hover:text-ink',
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 divide-y divide-line border-y border-line">
              {rows.length === 0 && (
                <EmptyState>
                  {filter === 'All'
                    ? 'No students in your courses have attendance or marks recorded yet.'
                    : `No students in your courses are ${filter.toLowerCase()} risk.`}
                </EmptyState>
              )}
              {rows.map((r) => (
                <div key={r.enrollmentId} className="grid gap-3 py-4 lg:grid-cols-[1fr_110px_1fr] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">
                        {r.name && <span className="mr-1 text-ice/70">{r.name}</span>}
                        {r.subject}
                      </p>
                      <span className={clsx('px-1.5 py-0.5 font-mono text-[10px] font-semibold', riskTone[r.risk])}>
                        {r.risk} · {r.score}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Marks {r.marks ?? '—'}% · Attendance {r.attendance ?? '—'}% ·{' '}
                      {r.dataComplete ? 'all signals observed' : `${r.imputed.length} signal(s) imputed`}
                    </p>
                  </div>
                  <div className="h-1 overflow-hidden bg-ice/10">
                    <div className={clsx('h-full', riskBar[r.risk])} style={{ width: `${r.score}%` }} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed text-muted">{nextStepFor(r)}</p>
                    <ReferButton row={r} onDone={load} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <h3 className="text-sm font-semibold text-ink">Referrals</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {isAdmin
                  ? 'You can resolve these. Resolving is recorded in the audit trail.'
                  : 'Cases you have handed to the safeguarding team. You can see their status, not the underlying records.'}
              </p>
              <div className="mt-3">
                <ReferralQueue referrals={referrals} onChanged={load} />
              </div>
            </div>
          </Disclosure>

          <Disclosure title="How this is scored">
            <MlRiskPanel />
          </Disclosure>
        </>
      )}

      {isAdmin && (
        <Disclosure title="Governance & access trail" meta="admin only">
          <h3 className="text-sm font-semibold text-ink">Model governance</h3>
          <div className="mt-3">
            <Governance model={model} />
          </div>
          <h3 className="mt-6 text-sm font-semibold text-ink">Staff access trail</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Every read of a student&apos;s records by staff is logged here, so access to sensitive data is
            attributable.
          </p>
          <div className="mt-3">
            <AuditTrail entries={audit} />
          </div>
        </Disclosure>
      )}
    </div>
  )
}
