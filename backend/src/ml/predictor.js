/**
 * Dropout-risk inference ported to plain JavaScript.
 *
 * The model itself was trained in Python (see train_model.py) and exported to
 * model.json, so the Express backend needs no Python or ML dependency at
 * runtime. Scoring is exact arithmetic on the exported parameters:
 *
 *   1. standardise features with the training mean / scale
 *   2. logistic decision vector  z_k = coef_k . x_scaled + intercept_k
 *   3. softmax over z, take argmax as the predicted class
 *
 * The reported `score` is the label-stage risk formula evaluated WITHOUT the
 * N(0, 0.05) noise term — noise is only used to make the training labels
 * imperfectly separable, never at inference time.
 *
 * This module is purely additive: it shares no code path with the existing
 * rule-based scoring in routes/analytics.routes.js.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

let cached = null

function load() {
  if (cached) return cached
  const raw = JSON.parse(readFileSync(join(HERE, 'model.json'), 'utf8'))
  const m = raw.primaryModel
  if (!m || m.type !== 'logistic_regression') {
    throw new Error('model.json: unsupported primaryModel type')
  }
  cached = raw
  return cached
}

function softmax(z) {
  const max = Math.max(...z)
  const exps = z.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((v) => v / sum)
}

/**
 * Normalise a number, falling back to the training mean (a statistically
 * neutral imputation) when a live record has no value for that feature.
 */
function coerce(value, fallback, { min, max }) {
  const n = Number(value)
  if (!Number.isFinite(n)) return { value: fallback, imputed: true }
  return { value: Math.min(max, Math.max(min, n)), imputed: false }
}

/**
 * Score one student.
 *
 * @param {object} input
 * @param {number|null} [input.sentiment]  0–1 well-being sentiment
 * @param {number|null} [input.attendance] 0–100 attendance percent
 * @param {number|null} [input.cgpa]       0–10 CGPA (pass marks / 10)
 * @returns {object} prediction payload
 */
export function predictRisk(input = {}) {
  const model = load()
  const pm = model.primaryModel
  const { mean, scale } = pm.scaler
  const [fSent, fAtt, fCgpa] = pm.featureOrder

  const sent = coerce(input.sentiment, mean[0], { min: 0, max: 1 })
  const att = coerce(input.attendance, mean[1], { min: 0, max: 100 })
  const cgpa = coerce(input.cgpa, mean[2], { min: 0, max: 10 })

  const raw = [sent.value, att.value, cgpa.value]
  const scaled = raw.map((v, i) => (v - mean[i]) / scale[i])

  const z = pm.coef.map((row, k) => row.reduce((s, c, i) => s + c * scaled[i], pm.intercept[k]))
  const probs = softmax(z)

  let best = 0
  for (let i = 1; i < probs.length; i += 1) if (probs[i] > probs[best]) best = i
  const risk = pm.classes[best]

  // Label-stage formula, no noise — the interpretable 0–100 risk score.
  const w = model.labelWeights
  const scorePct =
    (((100 - att.value) / 100) * w.attendance +
      (1 - sent.value) * w.sentiment +
      ((10 - cgpa.value) / 10) * w.marks) *
    100

  // Per-feature linear contribution, for the "why" breakdown in the UI.
  const contributions = pm.featureOrder.map((feature, i) => {
    const delta = raw[i] - mean[i]
    const label =
      feature === fSent ? 'Well-being sentiment' : feature === fAtt ? 'Attendance' : 'Marks (CGPA)'
    return {
      feature,
      label,
      value: Math.round(raw[i] * 100) / 100,
      imputed: [sent, att, cgpa][i].imputed,
      contribution: Math.round(pm.coef[best][i] * delta * 1000) / 1000,
    }
  })

  const probObj = {}
  pm.classes.forEach((c, i) => {
    probObj[c] = Math.round(probs[i] * 1000) / 10
  })

  const imputed = contributions.filter((c) => c.imputed).map((c) => c.label)

  return {
    risk,
    score: Math.round(scorePct * 100) / 100,
    confidence: probObj[risk],
    probabilities: probObj,
    contributions,
    imputed,
    model: pm.name,
  }
}

/** Quantile cut-points the model was trained against. */
export function getThresholds() {
  return load().thresholds
}

/** Metadata for the UI: weights, accuracy, class balance, study table. */
export function getModelInfo() {
  const m = load()
  return {
    version: m.version,
    trainedAt: m.trainedAt,
    source: m.source,
    primaryModel: m.primaryModel.name,
    accuracyTest: m.primaryModel.accuracyTest,
    accuracyFull: m.primaryModel.accuracyFull,
    labelWeights: m.labelWeights,
    thresholds: m.thresholds,
    classOrder: m.classOrder,
    classes: m.primaryModel.classes,
    dataset: m.dataset,
    studyResults: m.studyResults ?? [],
  }
}

export { load as loadModel }
