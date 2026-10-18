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

export type MlModelInfo = {
  version: string
  trainedAt: string
  source: string
  primaryModel: string
  accuracyTest: number
  accuracyFull: number
  labelWeights: { attendance: number; marks: number }
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
  /**
   * The viewer's own prediction, for the dashboard card. There is deliberately
   * no roster endpoint here: per-student records are served by
   * analyticsApi.insights(), which scopes them by role.
   */
  summary: () => api.get<MlSummary>('/api/analytics/ml/summary'),
  predict: (input: { attendance?: number; cgpa?: number }) =>
    api.post<MlPrediction>('/api/analytics/ml/predict', input),
}

export const mlRiskStyles: Record<MlRisk, { chip: string; bar: string; text: string }> = {
  Low: { chip: 'text-emerald-soft bg-emerald-soft/15', bar: 'bg-emerald-soft', text: 'text-emerald-soft' },
  Medium: { chip: 'text-amber-gentle bg-amber-gentle/15', bar: 'bg-amber-gentle', text: 'text-amber-gentle' },
  High: { chip: 'text-rose-400 bg-rose-500/15', bar: 'bg-rose-400', text: 'text-rose-400' },
}
