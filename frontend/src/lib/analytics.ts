import { api } from './api'

/** The three views the analytics surface is built around. */
export type ViewerRole = 'student' | 'teacher' | 'admin'

/** Model class labels. `Medium` is the model's own wording for the middle band. */
export type RiskLevel = 'Low' | 'Medium' | 'High'

/** One enrollment row: a student in a course, with that course's risk. */
export type InsightRow = {
  enrollmentId: number
  studentId: number
  name: string | null
  courseId: number
  subject: string
  instructorId: number | null
  attendance: number | null
  marks: number | null
  /** Raw internal-assessment scores, for the IA1-vs-IA2 marks chart. */
  ia1: number | null
  ia2: number | null
  risk: RiskLevel
  score: number
  confidence: number
  imputed: string[]
  dataComplete: boolean
  referralOpen: boolean
}

/** Course roll-up. Aggregates identify nobody, so teachers can see them. */
export type CourseInsight = {
  id: number
  subject: string
  students: number
  atRisk: number
  unassigned: boolean
  avgAttendance: number | null
  avgMarks: number | null
}

export type Insights = {
  viewer: { role: ViewerRole; scope: string }
  counts: Record<RiskLevel, number>
  students: number
  rows: InsightRow[]
  courses: CourseInsight[]
  canResolveReferrals: boolean
  openReferrals: number
}

export type Referral = {
  id: number
  studentId: number
  student: string | null
  course: string | null
  raisedBy: string | null
  reason: string
  note: string | null
  status: 'open' | 'acknowledged' | 'closed'
  createdAt: string
  canResolve: boolean
}

export type ModelCoverage = { students: number; fullyObserved: number; pct: number }

export type ModelGovernance = MlModelInfoShape & { coverage: ModelCoverage }

type MlModelInfoShape = {
  version: string
  primaryModel: string
  accuracyTest: number
  accuracyFull: number
  labelWeights: { attendance: number; marks: number }
  dataset: {
    rows: number
    trainRows: number
    testRows: number
    classDistribution: Record<string, number>
  }
}

export type AuditEntry = {
  id: number
  actor: string
  actorRole: string | null
  action: string
  target: string | null
  scope: string | null
  createdAt: string
}

export type DashboardSummary = {
  checkIns: number
  checkInsThisWeek: number
  messages: number
  posts: number
  clubs: number
  enrollments: number
  avgAttendance: number | null
  cgpa: number | null
  latestMood: string | null
  role?: ViewerRole
  countsArePlatformWide?: boolean
}

export const analyticsApi = {
  insights: () => api.get<Insights>('/api/analytics/insights'),
  referrals: () => api.get<Referral[]>('/api/analytics/referrals'),
  raiseReferral: (body: { studentId: number; courseId?: number | null; reason: string; note?: string | null }) =>
    api.post<{ id: number; status: string }>('/api/analytics/referrals', body),
  resolveReferral: (id: number, status: 'acknowledged' | 'closed') =>
    api.patch<{ id: number; status: string }>(`/api/analytics/referrals/${id}`, { status }),
  model: () => api.get<ModelGovernance>('/api/analytics/model'),
  audit: (limit = 60) => api.get<AuditEntry[]>(`/api/analytics/audit?limit=${limit}`),
  factorWeights: () => api.get<{ name: string; value: number }[]>('/api/analytics/factor-weights'),
  summary: () => api.get<DashboardSummary>('/api/analytics/summary'),
}

export const riskTone: Record<RiskLevel, string> = {
  Low: 'text-emerald-soft bg-emerald-soft/15',
  Medium: 'text-amber-gentle bg-amber-gentle/15',
  High: 'text-rose-400 bg-rose-500/15',
}

export const riskBar: Record<RiskLevel, string> = {
  Low: 'bg-emerald-soft',
  Medium: 'bg-amber-gentle',
  High: 'bg-rose-400',
}

/** A short, non-clinical next step derived from the strongest weak signal. */
export function nextStepFor(row: InsightRow): string {
  if (row.referralOpen) return 'Referred for support — no action needed from you.'
  if (row.marks != null && row.marks < 60) return 'Marks are the weak signal — a catch-up plan is the highest-value next step.'
  if (row.attendance != null && row.attendance < 70) return 'Attendance is slipping — worth a direct conversation.'
  if (row.risk === 'High') return 'Multiple signals are weak together — schedule a check-in.'
  if (!row.dataComplete) return `Not enough data yet — still needs ${row.imputed.length} more signal(s).`
  return 'Signals look healthy — keep up the engagement.'
}
