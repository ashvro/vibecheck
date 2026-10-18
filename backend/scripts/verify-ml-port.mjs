/**
 * Verifies the JavaScript port against Python's output.
 *
 *   node scripts/verify-ml-port.mjs
 *
 * Exits non-zero if the JS port disagrees with reference_predictions.json,
 * so this can be wired into CI.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { predictRisk } from '../src/ml/predictor.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ref = JSON.parse(readFileSync(join(HERE, '..', 'src', 'ml', 'reference_predictions.json'), 'utf8'))

let mismatches = 0
let maxScoreDelta = 0
const confusion = new Map()

for (const row of ref.rows) {
  const out = predictRisk({
    attendance: row.attendance_percent,
    cgpa: row.marks_cgpa,
  })

  if (out.risk !== row.expected) {
    mismatches += 1
    if (mismatches <= 10) {
      console.error(
        `MISMATCH ${row.username}: python=${row.expected} js=${out.risk} ` +
          `(att=${row.attendance_percent} cgpa=${row.marks_cgpa})`,
      )
    }
  }

  maxScoreDelta = Math.max(maxScoreDelta, Math.abs(out.score - row.expectedScore))
  const key = `${row.expected} -> ${out.risk}`
  confusion.set(key, (confusion.get(key) ?? 0) + 1)
}

const total = ref.rows.length
const agree = total - mismatches

console.log(`rows checked        : ${total}`)
console.log(`label agreement     : ${agree}/${total} (${((agree / total) * 100).toFixed(2)}%)`)
console.log(`max score delta     : ${maxScoreDelta.toFixed(4)} (noise-free score vs noisy training score)`)

if (mismatches > 0) {
  console.error(`\nFAIL: ${mismatches} prediction mismatch(es)`)
  process.exit(1)
}

console.log('\nPASS: JS port reproduces every Python prediction.')
