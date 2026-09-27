/**
 * ML dropout-risk endpoints.
 *
 * Mounted at /api/analytics/ml, entirely separate from the existing
 * rule-based endpoints. Nothing here alters the existing risk criteria:
 * /risk-students, /risk-trend, /chat-sentiment and /factor-weights all keep
 * their current thresholds, labels and weights.
 */

import { Router } from 'express'
import { getModelInfo, predictRisk } from '../ml/predictor.js'
import { buildFeatureRows } from '../ml/liveData.js'

export const mlRoutes = Router()

const isStaff = (req) => ['teacher', 'admin'].includes(req.user?.role)

/** Model card: weights, accuracy, class balance, the original 8-model study. */
mlRoutes.get('/model-info', (_req, res, next) => {
  try {
    res.json(getModelInfo())
  } catch (err) {
    next(err)
  }
})

/**
 * ML risk for every student, scored at student level.
 * Students see only themselves; staff see everyone.
 */
mlRoutes.get('/risk-students', async (req, res, next) => {
  try {
    if (!req.user) return res.json([])

    const allUsers = isStaff(req)
    const rows = await buildFeatureRows({ allUsers, userId: allUsers ? null : req.user.id })

    let students = rows.map((row) => {
      const p = predictRisk(row)
      return {
        id: row.userId,
        name: allUsers ? row.name : null,
        risk: p.risk,
        score: p.score,
        confidence: p.confidence,
        probabilities: p.probabilities,
        contributions: p.contributions,
        imputed: p.imputed,
        sentiment: row.sentiment != null ? Math.round(row.sentiment * 100) : null,
        attendance: row.attendance != null ? Math.round(row.attendance) : null,
        cgpa: row.cgpa != null ? Math.round(row.cgpa * 100) / 100 : null,
        subjectCount: row.subjectCount,
        subjects: row.subjects,
      }
    })

    const risk = req.query.risk ? String(req.query.risk) : null
    if (risk && risk !== 'All') students = students.filter((s) => s.risk === risk)
    if (req.query.missing === 'true') students = students.filter((s) => s.imputed.length > 0)

    students.sort((a, b) => b.score - a.score)
    res.json(students)
  } catch (err) {
    next(err)
  }
})

/** Aggregate ML distribution — powers the dashboard card and the analytics header. */
mlRoutes.get('/summary', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.json({ model: null, students: 0, distribution: {}, averageScore: null, highRisk: 0 })
    }

    const allUsers = isStaff(req)
    const rows = await buildFeatureRows({ allUsers, userId: allUsers ? null : req.user.id })
    const scored = rows.map((row) => ({ row, p: predictRisk(row) }))

    const distribution = { Low: 0, Medium: 0, High: 0 }
    for (const { p } of scored) distribution[p.risk] = (distribution[p.risk] ?? 0) + 1

    const averageScore = scored.length
      ? Math.round((scored.reduce((s, x) => s + x.p.score, 0) / scored.length) * 100) / 100
      : null

    const me = scored.length === 1 ? scored[0] : null

    res.json({
      model: getModelInfo().primaryModel,
      accuracyTest: getModelInfo().accuracyTest,
      students: scored.length,
      distribution,
      averageScore,
      highRisk: distribution.High ?? 0,
      latest: me
        ? { risk: me.p.risk, score: me.p.score, confidence: me.p.confidence, imputed: me.p.imputed }
        : null,
    })
  } catch (err) {
    next(err)
  }
})

/** Ad-hoc prediction from raw features — used by the "test the model" form. */
mlRoutes.post('/predict', (req, res, next) => {
  try {
    const { sentiment, attendance, cgpa } = req.body ?? {}
    const prediction = predictRisk({ sentiment, attendance, cgpa })
    res.json(prediction)
  } catch (err) {
    next(err)
  }
})
