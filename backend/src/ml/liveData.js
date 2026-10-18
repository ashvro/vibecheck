/**
 * Live feature extraction for the dropout-risk model.
 *
 * The training dataset is one row per student, so inference is also done at
 * student level (credit-weighted CGPA + mean attendance), not per enrolment.
 *
 * Feature mapping
 *   attendance_percent <- mean of Enrollment.attendance        (0–100)
 *   marks_cgpa         <- credit-weighted IA-1/IA-2 mean / 10 (0–10)
 *
 * Missing values are left null so the predictor can impute them with the
 * training mean, and so the UI can flag them.
 */

import { prisma } from '../prisma.js'

/**
 * Credit-weighted academic + attendance aggregates per user.
 * Mirrors the CGPA calculation already used by /api/analytics/summary.
 */
export async function academicAggregatesByUser() {
  const enrollments = await prisma.enrollment.findMany({
    include: { course: { select: { credits: true, code: true, name: true } } },
  })

  const byUser = new Map()
  for (const e of enrollments) {
    if (!byUser.has(e.userId)) {
      byUser.set(e.userId, {
        attendanceSum: 0,
        attendanceCount: 0,
        weighted: 0,
        credits: 0,
        subjects: 0,
      })
    }
    const agg = byUser.get(e.userId)
    const credits = e.course.credits || 3

    if (e.attendance != null) {
      agg.attendanceSum += e.attendance
      agg.attendanceCount += 1
    }
    if (e.ia1 != null && e.ia2 != null) {
      agg.weighted += ((e.ia1 + e.ia2) / 2) * credits
      agg.credits += credits
    }
    agg.subjects += 1
  }

  for (const agg of byUser.values()) {
    agg.attendance = agg.attendanceCount > 0 ? agg.attendanceSum / agg.attendanceCount : null
    agg.cgpa = agg.credits > 0 ? agg.weighted / agg.credits / 10 : null
  }

  return byUser
}

/** Enrolment ids grouped by user, for linking a prediction back to subjects. */
export async function enrollmentIdsByUser() {
  const rows = await prisma.enrollment.findMany({
    select: { id: true, userId: true, course: { select: { code: true, name: true } } },
  })
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.userId)) map.set(r.userId, [])
    map.get(r.userId).push(r)
  }
  return map
}

/**
 * Build one model feature row per student.
 *
 * @param {object} opts
 * @param {boolean} [opts.allUsers] score every user, not just those enrolled
 * @param {number} [opts.userId]    restrict to a single user (dashboard card)
 */
export async function buildFeatureRows({ allUsers = false, userId = null } = {}) {
  const [academics, subjects] = await Promise.all([
    academicAggregatesByUser(),
    enrollmentIdsByUser(),
  ])

  let users = []
  if (userId != null) {
    users = await prisma.user.findMany({ where: { id: userId }, select: { id: true, name: true } })
  } else if (allUsers) {
    users = await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } })
  } else {
    const ids = [...academics.keys()].sort((a, b) => a - b)
    if (!ids.length) return []
    users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    users.sort((a, b) => a.id - b.id)
  }

  return users.map((u) => {
    const agg = academics.get(u.id) ?? {
      attendance: null,
      cgpa: null,
      subjects: 0,
    }
    return {
      userId: u.id,
      name: u.name,
      attendance: agg.attendance,
      cgpa: agg.cgpa,
      subjectCount: agg.subjects,
      subjects: (subjects.get(u.id) ?? []).map((e) => `${e.course.code} · ${e.course.name}`),
    }
  })
}
