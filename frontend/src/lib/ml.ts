import { api } from './api'

/** ML class labels come straight from the trained model: Low | Medium | High. */
export type MlRisk = 'Low' | 'Medium' | 'High'

export type MlContribution = {
  feature: string
  label: string
  value: number
  imputed: boolean
  contribution: number
}

export type MlPrediction = {
  risk: MlRisk
  score: number
  confidence: number
  probabilities: Record<MlRisk, number>
  contributions: MlContribution[]
  imputed: string[]
  model: string
}

export type MlStudent = MlPrediction & {
  id: number
  name?: string | null
  sentiment: number | null
  attendance: number | null
  cgpa: number | null
  subjectCount: number
  subjects: string[]
}

export type MlModelInfo = {
  version: string
  trainedAt: string
  source: string
  primaryModel: string
  accuracyTest: number
  accuracyFull: number
  labelWeights: { attendance: number; sentiment: number; marks: number }
  thresholds: { quantiles: number[]; q1: number; q2: number }
  classOrder: MlRisk[]
  classes: string[]
  dataset: {
    rows: number
    trainRows: number
    testRows: number
    classDistribution: Record<string, number>
  }
  studyResults: { model: string; accuracy: number }[]
}

export type MlSummary = {
  model: string | null
  accuracyTest: number
  students: number
  distribution: Partial<Record<MlRisk, number>>
  averageScore: number | null
  highRisk: number
  latest: { risk: MlRisk; score: number; confidence: number; imputed: string[] } | null
}

export const mlApi = {
  modelInfo: () => api.get<MlModelInfo>('/api/analytics/ml/model-info'),
  riskStudents: (params?: { risk?: string; missing?: string }) => {
    const q = new URLSearchParams()
    if (params?.risk) q.set('risk', params.risk)
    if (params?.missing) q.set('missing', params.missing)
    const suffix = q.toString() ? `?${q}` : ''
    return api.get<MlStudent[]>(`/api/analytics/ml/risk-students${suffix}`)
  },
  summary: () => api.get<MlSummary>('/api/analytics/ml/summary'),
  predict: (input: { sentiment?: number; attendance?: number; cgpa?: number }) =>
    api.post<MlPrediction>('/api/analytics/ml/predict', input),
}

export const mlRiskStyles: Record<MlRisk, { chip: string; bar: string; text: string }> = {
  Low: { chip: 'text-emerald-soft bg-emerald-soft/15', bar: 'bg-emerald-soft', text: 'text-emerald-soft' },
  Medium: { chip: 'text-amber-gentle bg-amber-gentle/15', bar: 'bg-amber-gentle', text: 'text-amber-gentle' },
  High: { chip: 'text-rose-400 bg-rose-500/15', bar: 'bg-rose-400', text: 'text-rose-400' },
}
