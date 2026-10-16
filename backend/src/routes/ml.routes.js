/**
 * ML endpoints: the model itself, the viewer's own prediction, and ad-hoc
 * scoring. There is no roster here any more - /api/analytics/insights is the
 * single role-scoped table, so the two can never disagree.
 *
 * Individual student records are never served from this router; wellbeing
 * scoping in particular lives in src/analytics/scope.js.
 */

import { Router } from 'express'
import { getModelInfo, predictRisk } from '../ml/predictor.js'
import { buildFeatureRows } from '../ml/liveData.js'
import { requireAuth } from '../middleware/auth.js'

export const mlRoutes = Router()

// Mounted under the app-wide optionalAuth, so lock this router down explicitly:
// every response here is derived from the viewer's own records.
mlRoutes.use(requireAuth)

/**
 * The viewer's own risk prediction, powering the dashboard card. Staff get
 * their institution's distribution instead, and no `latest` of their own -
 * risk is a per-student metric and staff are not scored as students.
 */
mlRoutes.get('/summary', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.json({ model: null, students: 0, distribution: {}, averageScore: null, highRisk: 0, latest: null })
    }

    const isAdmin = req.user.role === 'admin'
    const isStaff = req.user.role === 'teacher' || isAdmin
    const rows = await buildFeatureRows({ allUsers: isStaff, userId: isStaff ? null : req.user.id })
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

/**
 * Model card: weights, accuracy, class balance, the original 8-model study.
 * Describes the model, not any person, so it is open to any signed-in user;
 * per-student coverage and governance live behind /api/analytics/model.
 */
mlRoutes.get('/model-info', (_req, res, next) => {
  try {
    res.json(getModelInfo())
  } catch (err) {
    next(err)
  }
})

/**
 * Ad-hoc prediction from raw features - the "test the model" form. Scores only
 * the numbers typed in, so it touches no student record.
 */
mlRoutes.post('/predict', (req, res, next) => {
  try {
    const { sentiment, attendance, cgpa } = req.body ?? {}
    const prediction = predictRisk({ sentiment, attendance, cgpa })
    res.json(prediction)
  } catch (err) {
    next(err)
  }
})
