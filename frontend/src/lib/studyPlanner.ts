import { api } from './api'

export type PlanEntry = {
  label: string
  /** Present for single-day entries; weekly blocks omit it. */
  date?: string
  hours: number
  focus: string
  topics: string[]
  importantQuestions: string[]
  tip?: string
}

export type StudyPlan = {
  subject: string
  examDate: string
  daysUntilExam: number
  totalHours: number
  summary: string
  entries: PlanEntry[]
  finalTips: string[]
}

/**
 * Builds the plan from a multipart form: `subject`, `examDate` and up to ten
 * `modules` files (JPEG/PNG/WebP/GIF photos or PDFs).
 */
export function generatePlan(form: FormData): Promise<StudyPlan> {
  return api.upload<StudyPlan>('/api/study-planner/generate', form)
}
