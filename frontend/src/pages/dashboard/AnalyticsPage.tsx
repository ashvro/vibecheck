import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CrystalMark } from '../../components/CrystalMark'
import { MlRiskPanel } from '../../components/ml/MlRiskPanel'
import { PageHeader } from '../../components/PageHeader'
import { api, getUser } from '../../lib/api'

type RiskStudent = {
  id: number
  name?: string | null
  subject: string
  risk: 'Low' | 'Moderate' | 'High'
  score: number
  attendance: number | null
  ia1: number | null
  ia2: number | null
  sentiment?: number | null
  recommendation: string
}

type FactorWeight = { name: string; value: number }

type ChatSentiment = {
  average: number | null
  averagePct: number | null
  messages: number
  sessions: number
  weeks: { week: string; count: number; sentiment: number | null }[]
}

const riskColors = {
  Low: 'text-emerald-soft bg-emerald-soft/15',
  Moderate: 'text-amber-gentle bg-amber-gentle/15',
  High: 'text-rose-400 bg-rose-500/15',
}

export function AnalyticsPage() {
  const [students, setStudents] = useState<RiskStudent[]>([])
  const [weights, setWeights] = useState<FactorWeight[]>([])
  const [sentiment, setSentiment] = useState<ChatSentiment>({
    average: null,
    averagePct: null,
    messages: 0,
    sessions: 0,
    weeks: [],
  })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Staff get the full ML roster; students only ever see their own row.
  const isStaff = ['teacher', 'admin'].includes(String(getUser()?.role ?? ''))

  useEffect(() => {
    Promise.all([
      api.get<RiskStudent[]>('/api/analytics/risk-students'),
      api.get<FactorWeight[]>('/api/analytics/factor-weights'),
      api.get<ChatSentiment>('/api/analytics/chat-sentiment'),
    ])
      .then(([s, w, cs]) => {
        setStudents(s)
        setWeights(w)
        setSentiment(cs)
        setSelectedId((prev) => (prev != null && s.some((x) => x.id === prev) ? prev : (s[0]?.id ?? null)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const riskCounts = { Low: 0, Moderate: 0, High: 0 }
  students.forEach((s) => riskCounts[s.risk]++)
  const total = students.length || 1

  const selected = students.find((s) => s.id === selectedId) ?? students[0]
  const selectedMarks =
    selected && selected.ia1 != null && selected.ia2 != null ? Math.round((selected.ia1 + selected.ia2) / 2) : null
  const radarData = selected
    ? [
        { metric: 'Marks', value: selectedMarks ?? 0 },
        { metric: 'Attendance', value: selected.attendance ?? 0 },
        { metric: 'Sentiment', value: selected.sentiment ?? 0 },
      ]
    : []
  const missingMetrics = selected
    ? [
        selectedMarks == null && 'marks',
        selected.attendance == null && 'attendance',
        selected.sentiment == null && 'sentiment',
      ].filter(Boolean)
    : []

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeader
        eyebrow="Insights"
        title="Risk analytics"
        description="Grades, attendance, and mental-wellbeing sentiment — per-course risk breakdown"
      />

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading analytics…</p>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-10 gap-y-4 border-b border-line pb-8">
            {[
              { label: 'Low risk', value: `${Math.round((riskCounts.Low / total) * 100)}%`, tone: 'text-emerald-soft' },
              { label: 'Moderate', value: `${Math.round((riskCounts.Moderate / total) * 100)}%`, tone: 'text-amber-gentle' },
              { label: 'High risk', value: `${Math.round((riskCounts.High / total) * 100)}%`, tone: 'text-rose-400' },
            ].map((item) => (
              <div key={item.label}>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                  {item.label}
                </dt>
                <dd className={`mt-0.5 text-2xl font-semibold tabular-nums tracking-tight ${item.tone}`}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          <div>
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="text-sm font-semibold text-ink">Model weights</h2>
            </div>
            <ul className="mt-4 grid max-w-sm gap-3">
              {weights.map((factor) => (
                <li key={factor.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted">{factor.name}</span>
                    <span className="font-semibold tabular-nums text-ink">{factor.value}%</span>
                  </div>
                  <div className="h-1 overflow-hidden bg-ice/10">
                    <div className="h-full bg-ice" style={{ width: `${factor.value}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted">
              Missing features are neutral — a student with no mental-health conversations simply has no sentiment component.
            </p>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="text-sm font-semibold text-ink">Risk matrix & interventions</h2>
            </div>
            <div className="mt-3 divide-y divide-line border-y border-line">
              {students.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  No enrollment data yet — enroll in courses and set attendance to see risk analysis.
                </p>
              )}
              {students.map((student) => (
                <div
                  key={student.id}
                  className="grid gap-3 py-4 lg:grid-cols-[1fr_120px_1.5fr] lg:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">
                        {student.name && <span className="mr-1 text-ice/70">{student.name}</span>}
                        {student.subject}
                      </p>
                      <span
                        className={clsx(
                          'px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                          riskColors[student.risk],
                        )}
                      >
                        {student.risk} · {student.score}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Attendance {student.attendance ?? '—'}% · IA-1 {student.ia1 ?? '—'} · IA-2 {student.ia2 ?? '—'}
                    </p>
                  </div>
                  <div>
                    <div className="h-1 overflow-hidden bg-ice/10">
                      <div
                        className={clsx(
                          'h-full',
                          student.risk === 'High'
                            ? 'bg-rose-400'
                            : student.risk === 'Moderate'
                              ? 'bg-amber-gentle'
                              : 'bg-emerald-soft',
                        )}
                        style={{ width: `${student.score}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-muted">{student.recommendation}</p>
                </div>
              ))}
            </div>
          </div>
        <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CrystalMark size="sm" spinOnView />
                <h2 className="text-sm font-semibold text-ink">Student profile — marks · attendance · sentiment</h2>
              </div>
              {students.length > 0 && (
                <select
                  value={selected?.id ?? ''}
                  onChange={(e) => setSelectedId(Number(e.target.value))}
                  className="rounded-lg border border-ice/10 bg-thaw px-2.5 py-1.5 text-[12px] text-ice/70 outline-none focus:border-ice/30"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name ? `${s.name} · ` : ''}
                      {s.subject}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Marks = average of IA-1 &amp; IA-2 · Attendance = enrolment attendance % · Sentiment = latest assistant
              well-being session. All on a 0–100 scale.
            </p>

            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <div className="h-72">
                {students.length > 0 && selected ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData} outerRadius="72%">
                      <PolarGrid stroke="rgba(148,163,184,0.18)" />
                      <PolarAngleAxis
                        dataKey="metric"
                        tick={{ fontSize: 12, fill: 'rgba(148,163,184,0.95)' }}
                      />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar
                        dataKey="value"
                        stroke="#7c5cfa"
                        strokeWidth={2}
                        fill="#7c5cfa"
                        fillOpacity={0.28}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0b1120',
                          border: '1px solid rgba(148,163,184,0.2)',
                          borderRadius: 8,
                          fontSize: 12,
                          color: '#e2e8f0',
                        }}
                        formatter={(value) => [`${value}%`, '']}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-16 text-center text-sm text-muted">No enrollment data yet.</p>
                )}
              </div>
              <div>
                <dl className="space-y-3">
                  {radarData.map((d) => {
                    const present = d.value > 0
                    return (
                      <div key={d.metric}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className={clsx(present ? 'text-muted' : 'text-ice/40')}>{d.metric}</span>
                          <span className={clsx('font-semibold tabular-nums text-ink', !present && 'text-ice/40')}>
                            {present ? `${d.value}%` : '—'}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden bg-ice/10">
                          <div
                            className={clsx(
                              'h-full rounded-full',
                              d.metric === 'Marks' ? 'bg-violet-soft' : d.metric === 'Attendance' ? 'bg-emerald-soft' : 'bg-amber-gentle',
                            )}
                            style={{ width: present ? `${d.value}%` : '0%' }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </dl>
                {missingMetrics.length > 0 && (
                  <p className="mt-4 text-xs leading-relaxed text-muted">
                    No data for: {missingMetrics.join(', ')} — these show as 0 until recorded.
                  </p>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="text-sm font-semibold text-ink">Chatbot well-being sentiment</h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              Average sentiment recorded by the AI assistant on mental-health conversations — computed per message in
              chat history and rolled into a whole-session average.
            </p>

            <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">Avg sentiment</dt>
                <dd
                  className={clsx(
                    'mt-0.5 text-2xl font-semibold tabular-nums tracking-tight',
                    sentiment.averagePct == null
                      ? 'text-muted'
                      : sentiment.averagePct >= 60
                        ? 'text-emerald-soft'
                        : sentiment.averagePct >= 40
                          ? 'text-amber-gentle'
                          : 'text-rose-400',
                  )}
                >
                  {sentiment.averagePct != null ? `${sentiment.averagePct}%` : '—'}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">Messages scored</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {sentiment.messages}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">Sessions scored</dt>
                <dd className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {sentiment.sessions}
                </dd>
              </div>
            </dl>

            <div className="mt-6 max-w-3xl">
              {sentiment.weeks.filter((w) => w.sentiment != null).length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={sentiment.weeks.filter((w) => w.sentiment != null)}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="sentimentFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#4ade80" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#4ade80" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 11, fill: 'rgba(148,163,184,0.9)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        width={30}
                        tick={{ fontSize: 11, fill: 'rgba(148,163,184,0.9)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#0b1120',
                          border: '1px solid rgba(148,163,184,0.2)',
                          borderRadius: 8,
                          fontSize: 12,
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#94a3b8' }}
                        formatter={(value) => [`${value}%`, 'Sentiment (0–100)']}
                      />
                      <Area
                        type="monotone"
                        dataKey="sentiment"
                        stroke="#4ade80"
                        strokeWidth={2}
                        fill="url(#sentimentFill)"
                        connectNulls
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted">
                  No mental-health chat sentiment yet — start a well-being conversation in the AI assistant to build
                  this trend.
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-line pt-10">
            <MlRiskPanel showRoster={isStaff} />
          </div>
        </>
      )}
    </div>
  )
}