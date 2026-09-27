/**
 * Smoke test for the additive ML endpoints.
 *
 *   node scripts/smoke-ml.mjs
 *
 * Boots the real Express app in-process, registers a throwaway user, and
 * exercises every /api/analytics/ml route. Verifies the existing rule-based
 * endpoints still behave identically (no regression).
 */

import request from 'node:http'
import { createApp } from '../src/app.js'
import { prisma } from '../src/prisma.js'

const app = createApp()
const server = app.listen(0)
const { port } = server.address()
const base = `http://127.0.0.1:${port}`

function call(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = request.request(
      `${base}${path}`,
      {
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let parsed = null
          try {
            parsed = JSON.parse(data)
          } catch {
            parsed = data
          }
          resolve({ status: res.statusCode, body: parsed })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

let pass = 0
let fail = 0
function check(label, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ok    ${label}`)
  } else {
    fail += 1
    console.error(`  FAIL  ${label} ${extra}`)
  }
}

try {
  const email = `ml-smoke-${Date.now()}@test.local`
  const reg = await call('POST', '/api/auth/signup', {
    body: { name: 'ML Smoke', email, password: 'test1234', role: 'student' },
  })
  const token = reg.body?.token
  check('register + token', reg.status === 201 && Boolean(token), JSON.stringify(reg.body))
  if (!token) throw new Error('no token')

  console.log('\nmodel-info')
  const info = await call('GET', '/api/analytics/ml/model-info')
  check('200', info.status === 200)
  check('primary model is Logistic Regression', info.body?.primaryModel === 'Logistic Regression')
  check('accuracy 86.84', info.body?.accuracyTest === 86.84, String(info.body?.accuracyTest))
  check('8 study models present', info.body?.studyResults?.length === 8)
  check('quantile thresholds present', typeof info.body?.thresholds?.q1 === 'number')

  console.log('\nsummary (student, no enrollments yet)')
  const sum0 = await call('GET', '/api/analytics/ml/summary', { token })
  check('200', sum0.status === 200)
  check('latest prediction present', sum0.body?.latest != null, JSON.stringify(sum0.body))
  check('student counted', typeof sum0.body?.students === 'number')

  console.log('\npredict (ad-hoc)')
  const bad = await call('POST', '/api/analytics/ml/predict', {
    token,
    body: { sentiment: 0.05, attendance: 38, cgpa: 4.5 },
  })
  check('200', bad.status === 200)
  check('poor signals -> High risk', bad.body?.risk === 'High', JSON.stringify(bad.body?.risk))
  check('confidence present', typeof bad.body?.confidence === 'number')

  const good = await call('POST', '/api/analytics/ml/predict', {
    token,
    body: { sentiment: 0.98, attendance: 97, cgpa: 9.4 },
  })
  check('strong signals -> Low risk', good.body?.risk === 'Low', JSON.stringify(good.body?.risk))

  const partial = await call('POST', '/api/analytics/ml/predict', {
    token,
    body: { attendance: 90 },
  })
  check('partial input imputed, not crashed', partial.status === 200)
  check('imputed features reported', partial.body?.imputed?.length === 2, JSON.stringify(partial.body?.imputed))

  const junk = await call('POST', '/api/analytics/ml/predict', { token, body: { attendance: 'abc' } })
  check('garbage input falls back to mean', junk.status === 200 && junk.body?.risk != null)

  console.log('\nrisk-students')
  const rs = await call('GET', '/api/analytics/ml/risk-students', { token })
  check('200', rs.status === 200)
  check('array', Array.isArray(rs.body))
  check('student sees only self', rs.body?.length <= 1, `len=${rs.body?.length}`)
  check('anonymous gets []', (await call('GET', '/api/analytics/ml/risk-students')).body?.length === 0)

  console.log('\nno-regression: existing rule-based endpoints')
  const oldStudents = await call('GET', '/api/analytics/risk-students', { token })
  const oldWeights = await call('GET', '/api/analytics/factor-weights', { token })
  const oldSummary = await call('GET', '/api/analytics/summary', { token })
  const oldSent = await call('GET', '/api/analytics/chat-sentiment', { token })
  const oldTrend = await call('GET', '/api/analytics/risk-trend', { token })
  check('/risk-students 200', oldStudents.status === 200)
  check('/factor-weights still 40/35/25', JSON.stringify(oldWeights.body) === JSON.stringify([
    { name: 'Grades', value: 40 },
    { name: 'Attendance', value: 35 },
    { name: 'Well-being Sentiment', value: 25 },
  ]), JSON.stringify(oldWeights.body))
  check('/summary 200 + same shape', oldSummary.status === 200 && 'avgAttendance' in (oldSummary.body ?? {}))
  check('/chat-sentiment 200', oldSent.status === 200)
  check('/risk-trend 200 + 6 weeks', oldTrend.status === 200 && oldTrend.body?.length === 6)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
} catch (err) {
  console.error(err)
  process.exitCode = 1
} finally {
  server.close()
  await prisma.$disconnect()
}
