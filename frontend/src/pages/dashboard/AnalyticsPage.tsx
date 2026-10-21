import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download, ShieldCheck } from 'lucide-react'
import { analyticsApi } from '../../lib/analytics'

type Course = {
  subject: string
  code: string
  ia1: number | null
  ia2: number | null
  delta: number | null
  attendance: number | null
  threshold: number
  belowThreshold: boolean
  classesNeeded: number
}

type Driver = { label: string; points: number }
type Action = { title: string; detail: string; impactPoints: number; cta: string | null }

type Overview = {
  range: string
  riskScore: number
  riskLabel: string
  stats: { attendance: number | null; marks: number | null; trend: number[] | null; delta: number | null; percentile?: string }
  courses: Course[]
  drivers: Driver[]
  safeZone: { course: string; current: number; classesNeeded: number } | null
  actions: Action[]
  summaryText: string
}

const CHART_TOOLTIP = {
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-line)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-ink)',
}

const AXIS_TICK = { fontSize: 10, fill: 'var(--chart-tick)' }

const COURSE_COLORS = ['#818cf8', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#22d3ee', '#60a5fa']

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>
}

function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-surface-2/60', className)} />
}

function RiskGauge({ score, label }: { score: number; label: string }) {
  const r = 60
  const c = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, score)) / 100
  const dash = c * pct
  const color = score <= 33 ? '#9db8a8' : score <= 66 ? '#d4b896' : '#f43f5e'
  return (
    <div className="flex flex-col items-center">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(184,164,224,0.12)" strokeWidth="12" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 80 80)"
        />
        <text x="80" y="76" textAnchor="middle" fill="var(--color-ink)" style={{ fontSize: 28, fontWeight: 700 }}>
          {score}
        </text>
        <text x="80" y="98" textAnchor="middle" fill="var(--color-muted)" style={{ fontSize: 11 }}>
          {label}
        </text>
      </svg>
    </div>
  )
}

export function AnalyticsPage() {
  const [range, setRange] = useState<'semester' | '30d'>('semester')
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await analyticsApi.summaryV2(range)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => {
    load()
  }, [load])

  function exportCsv() {
    if (!data) return
    const rows = [['Course', 'IA1', 'IA2', 'Delta', 'Attendance', 'Classes needed']]
    for (const c of data.courses) {
      rows.push([c.subject, String(c.ia1 ?? ''), String(c.ia2 ?? ''), String(c.delta ?? ''), String(c.attendance ?? ''), String(c.classesNeeded)])
    }
    const csv = rows.map((r) => r.map((x) => `"${x}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${range}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rise-grid mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Your Academic Analysis</h1>
        <p className="text-sm text-muted">{data?.summaryText ?? 'Loading your analytics…'}</p>
      </div>

      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['semester', '30d'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                range === r ? 'border-ice/25 bg-ice/15 text-ice' : 'border-ice/10 bg-ice/[0.03] text-muted hover:text-ink',
              )}
            >
              {r === 'semester' ? 'This semester' : 'Last 30 days'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-xl border border-ice/20 bg-ice/10 px-3 py-1.5 text-xs font-semibold text-ice transition hover:bg-ice/15"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <span className="rounded-full border border-ice/20 bg-ice/[0.03] px-3 py-1.5 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
            <ShieldCheck className="mr-1 inline h-3 w-3" /> Your own data only
          </span>
        </div>
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {/* Row 1 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="glass-ice rounded-xl p-4 lg:col-span-5">
          <h3 className="text-xs font-semibold text-ink">Risk level</h3>
          {loading ? (
            <Skeleton className="mt-4 h-40" />
          ) : data ? (
            <RiskGauge score={data.riskScore} label={data.riskLabel} />
          ) : (
            <EmptyState>No risk data.</EmptyState>
          )}
        </div>
        <div className="lg:col-span-7 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-ice rounded-xl p-3">
              <p className="font-mono text-[10px] text-muted uppercase">Attendance</p>
              {loading ? <Skeleton className="mt-2 h-6" /> : <p className="mt-1 text-xl font-semibold text-ink">{data?.stats.attendance ?? '—'}%</p>}
            </div>
            <div className="glass-ice rounded-xl p-3">
              <p className="font-mono text-[10px] text-muted uppercase">Marks</p>
              {loading ? <Skeleton className="mt-2 h-6" /> : <p className="mt-1 text-xl font-semibold text-ink">{data?.stats.marks ?? '—'}%</p>}
              {data?.stats.percentile && <p className="text-[10px] text-muted">{data.stats.percentile}</p>}
            </div>
          </div>
          <div className="glass-ice rounded-xl p-4">
            <h3 className="text-xs font-semibold text-ink">What's pushing your risk up</h3>
            {loading ? (
              <Skeleton className="mt-3 h-24" />
            ) : data && data.drivers.length ? (
              <ul className="mt-3 space-y-2">
                {data.drivers.map((d, i) => (
                  <li key={i} className="flex items-center justify-between text-sm">
                    <span className="text-ink/90">{d.label}</span>
                    <span className={clsx('font-mono text-xs', d.points > 0 ? 'text-rose-400' : 'text-emerald-soft')}>
                      {d.points > 0 ? '+' : ''}{d.points}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>No risk drivers.</EmptyState>
            )}
          </div>
        </div>
      </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="glass-ice rounded-xl p-4 lg:col-span-7">
          <h3 className="text-xs font-semibold text-ink">Marks by course</h3>
          {loading ? (
            <Skeleton className="mt-3 h-48" />
          ) : data && data.courses.length ? (
            <div className="mt-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.courses} layout="vertical" margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} />
                  <YAxis type="category" dataKey="code" tick={AXIS_TICK} width={55} />
                  <Tooltip contentStyle={CHART_TOOLTIP} />
                  <Bar dataKey="ia1" name="IA1" radius={[3, 3, 0, 0]} maxBarSize={18}>
                    {data.courses.map((_, i) => (
                      <Cell key={i} fill={COURSE_COLORS[i % COURSE_COLORS.length]} fillOpacity={0.5} />
                    ))}
                  </Bar>
                  <Bar dataKey="ia2" name="IA2" radius={[3, 3, 0, 0]} maxBarSize={18}>
                    {data.courses.map((_, i) => (
                      <Cell key={i} fill={COURSE_COLORS[i % COURSE_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState>No course data.</EmptyState>
          )}
        </div>
        <div className="glass-ice rounded-xl p-4 lg:col-span-5">
          <h3 className="text-xs font-semibold text-ink">Attendance by course</h3>
          {loading ? (
            <Skeleton className="mt-3 h-48" />
          ) : data && data.courses.length ? (
            <div className="mt-3 space-y-2">
              {data.courses.map((c, i) => (
                <div key={c.subject} className="mb-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-ink/90">{c.code}</span>
                    <span className={clsx('font-mono', c.belowThreshold ? 'text-rose-400' : 'text-muted')}>{c.attendance ?? 0}%</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded bg-surface-2/60">
                    <div
                      className="h-full rounded"
                      style={{ width: `${Math.min(100, c.attendance ?? 0)}%`, backgroundColor: COURSE_COLORS[i % COURSE_COLORS.length] }}
                    />
                  </div>
                  {c.belowThreshold && <p className="mt-0.5 text-[10px] text-rose-400">{c.classesNeeded} more classes to reach 75%</p>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No attendance data.</EmptyState>
          )}
        </div>
      </div>

      {/* Row 3 */}
      <div className="glass-ice rounded-xl p-4">
        <h3 className="text-xs font-semibold text-ink">Your next moves</h3>
        {loading ? (
          <Skeleton className="mt-3 h-32" />
        ) : data && data.actions.length ? (
          <ul className="mt-3 space-y-3">
            {data.actions.map((a, i) => (
              <li key={i} className="rounded-lg border border-ice/10 bg-surface-2/40 p-3">
                <p className="text-sm font-semibold text-ink">{a.title}</p>
                <p className="text-xs text-muted">{a.detail}</p>
                {a.cta && <p className="mt-1 font-mono text-[9px] tracking-[0.12em] text-violet-soft uppercase">{a.cta}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No actions.</EmptyState>
        )}
      </div>
    </div>
  )
}
