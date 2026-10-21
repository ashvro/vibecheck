/**
 * Role-scoped analytics.
 *
 * Every route here goes through src/analytics/scope.js. There is exactly one
 * risk model in the product - the trained one in src/ml - so the numbers a
 * student, a teacher and an admin see all come from the same predictor.
 */

import { Router } from 'express'
import { prisma } from '../prisma.js'
import { factorWeights } from '../data/store.js'
import { getModelInfo, predictRisk } from '../ml/predictor.js'
import { buildFeatureRows } from '../ml/liveData.js'
import { requireAuth } from '../middleware/auth.js'
import {
  ROLE,
  roleOf,
  isAdmin,
  scopedEnrollmentWhere,
  scopedStudentIds,
  scopedCourseIds,
  scopeLabel,
  logAccess,
  logRosterAccess,
} from '../analytics/scope.js'

export const analyticsRoutes = Router()

analyticsRoutes.use(requireAuth)

/** Credit-weighted marks percentage for an enrollment row. */
function marksOf(e) {
  return e.ia1 != null && e.ia2 != null ? Math.round((e.ia1 + e.ia2) / 2) : null
}

/* ------------------------------------------------------------------ *
 * /summary - dashboard header. Counts are scoped to the viewer.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/summary', async (req, res, next) => {
  try {
    const user = req.user
    const uid = user?.id
    const role = roleOf(user)
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Students see their own participation, not platform-wide totals.
    const [postWhere, clubWhere] =
      role === ROLE.STUDENT
        ? [{ ownerId: uid }, { memberships: { some: { userId: uid } } }]
        : [{}, {}]

    const [posts, clubs] = await Promise.all([
      prisma.post.count({ where: postWhere }),
      prisma.club.count({ where: clubWhere }),
    ])

    const [checkIns, messages, checkInsWeek] = uid
      ? await Promise.all([
          prisma.checkIn.count({ where: { userId: uid } }),
          prisma.chatMessage.count({ where: { userId: uid, role: 'user' } }),
          prisma.checkIn.count({ where: { userId: uid, createdAt: { gte: weekAgo } } }),
        ])
      : [0, 0, 0]

    let enrollments = 0
    let avgAttendance = null
    let cgpa = null
    let latestMood = null

    if (uid) {
      const myEnrollments = await prisma.enrollment.findMany({
        where: { userId: uid },
        include: { course: true },
      })
      enrollments = myEnrollments.length

      const withAttendance = myEnrollments.filter((e) => e.attendance != null)
      if (withAttendance.length) {
        avgAttendance = Math.round(
          withAttendance.reduce((s, e) => s + e.attendance, 0) / withAttendance.length,
        )
      }

      let weighted = 0
      let credits = 0
      for (const e of myEnrollments) {
        if (e.ia1 != null && e.ia2 != null) {
          weighted += marksOf(e) * (e.course.credits || 3)
          credits += e.course.credits || 3
        }
      }
      if (credits > 0) cgpa = Math.round((weighted / credits / 10) * 100) / 100

      const latest = await prisma.checkIn.findFirst({
        where: { userId: uid },
        orderBy: { createdAt: 'desc' },
      })
      latestMood = latest?.mood ?? null
    }

    res.json({
      checkIns,
      checkInsThisWeek: checkInsWeek,
      messages,
      posts,
      clubs,
      enrollments,
      avgAttendance,
      cgpa,
      latestMood,
      role,
      countsArePlatformWide: role !== ROLE.STUDENT,
    })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ *
 * /insights - the role-scoped table behind the Analytics tab.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/insights', async (req, res, next) => {
  try {
    const user = req.user
    const role = roleOf(user)

    const [enrollmentWhere, studentIds] = await Promise.all([
      scopedEnrollmentWhere(user),
      scopedStudentIds(user),
    ])

    const enrollments = await prisma.enrollment.findMany({
      where: enrollmentWhere,
      include: { course: { select: { id: true, code: true, name: true, credits: true, instructorId: true } } },
      orderBy: { id: 'asc' },
    })

    const students = new Map()
    for (const u of await prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true } })) {
      students.set(u.id, u)
    }

    const referrals = await prisma.wellbeingReferral.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, courseId: true, status: true, raisedById: true },
    })
    const referredKeys = new Set(
      referrals.filter((r) => r.status === 'open').map((r) => `${r.studentId}:${r.courseId ?? ''}`),
    )

    const byEnrollment = new Map()

    // One risk score per STUDENT, not per enrolment.
    //
    // The model is trained on one row per student (credit-weighted CGPA, mean
    // attendance across every course), which is also what the dashboard card
    // and /api/ml/summary use. Scoring each enrolment separately would show a
    // student two different risk numbers in this table, neither of which
    // matched the one on their own Overview page.
    const featureRows = await buildFeatureRows({ allUsers: true })
    const studentRisk = new Map()
    for (const f of featureRows) {
      studentRisk.set(f.userId, predictRisk({ attendance: f.attendance, cgpa: f.cgpa }))
    }

    const rows = enrollments.map((e) => {
      const marks = marksOf(e)
      const p =
        studentRisk.get(e.userId) ??
        predictRisk({ attendance: e.attendance, cgpa: marks == null ? null : marks / 10 })

      const row = {
        enrollmentId: e.id,
        studentId: e.userId,
        // A student looking at their own row sees their own name, obviously.
        name: students.get(e.userId)?.name ?? null,
        courseId: e.course.id,
        subject: `${e.course.code} · ${e.course.name}`,
        instructorId: e.course.instructorId,
        attendance: e.attendance ?? null,
        marks,
        // Raw assessment scores, so a student's marks chart can show IA1 vs IA2
        // per course. Already visible to the viewer for their own courses.
        ia1: e.ia1 ?? null,
        ia2: e.ia2 ?? null,
        risk: p.risk,
        score: p.score,
        confidence: p.confidence,
        imputed: p.imputed,
        dataComplete: p.imputed.length === 0,
        referralOpen: referredKeys.has(`${e.userId}:${e.course.id}`),
      }
      byEnrollment.set(e.id, row)
      return row
    })

    // Course roll-up. Teachers need the shape of their own cohort even though
    // they cannot see the individuals behind it.
    const courseMap = new Map()
    for (const e of enrollments) {
      if (!courseMap.has(e.course.id)) {
        courseMap.set(e.course.id, {
          id: e.course.id,
          subject: `${e.course.code} · ${e.course.name}`,
          unassigned: e.course.instructorId == null,
          students: 0,
          atRisk: 0,
          attendanceSum: 0,
          attendanceN: 0,
          marksSum: 0,
          marksN: 0,
        })
      }
      const c = courseMap.get(e.course.id)
      const marks = marksOf(e)
      const row = byEnrollment.get(e.id)
      c.students += 1
      if (row && (row.risk === 'High' || row.risk === 'Medium')) c.atRisk += 1
      if (e.attendance != null) { c.attendanceSum += e.attendance; c.attendanceN += 1 }
      if (marks != null) { c.marksSum += marks; c.marksN += 1 }
    }
    const courses = [...courseMap.values()].map((c) => ({
      id: c.id,
      subject: c.subject,
      students: c.students,
      atRisk: c.atRisk,
      unassigned: c.unassigned,
      avgAttendance: c.attendanceN ? Math.round(c.attendanceSum / c.attendanceN) : null,
      avgMarks: c.marksN ? Math.round(c.marksSum / c.marksN) : null,
    }))

    const counts = { Low: 0, Medium: 0, High: 0 }
    for (const r of rows) counts[r.risk] += 1

    await logRosterAccess(user, studentIds, 'analytics.insights', await scopeLabel(user))

    res.json({
      viewer: { role, scope: await scopeLabel(user) },
      counts,
      students: studentIds.length,
      rows: rows.sort((a, b) => b.score - a.score),
      courses: courses.sort((a, b) => b.atRisk - a.atRisk),
      canResolveReferrals: role === ROLE.ADMIN,
      openReferrals: referrals.filter((r) => r.status === 'open').length,
    })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ *
 * /model - model governance, admin only.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/model', async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' })
    const info = getModelInfo()

    const enrollments = await prisma.enrollment.findMany({ select: { userId: true, attendance: true, ia1: true, ia2: true } })

    let complete = 0
    const seen = new Set()
    for (const e of enrollments) {
      const key = e.userId
      if (seen.has(key)) continue
      seen.add(key)
      if (e.attendance != null && e.ia1 != null && e.ia2 != null) complete += 1
    }

    await logAccess({ actor: req.user, action: 'analytics.model' })
    res.json({
      ...info,
      coverage: {
        students: seen.size,
        fullyObserved: complete,
        pct: seen.size ? Math.round((complete / seen.size) * 100) : 0,
      },
    })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ *
 * /referrals - teacher raises, admin resolves.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/referrals', async (req, res, next) => {
  try {
    const user = req.user
    const role = roleOf(user)
    if (role === ROLE.STUDENT) return res.json([])

    const studentIds = await scopedStudentIds(user)
    if (!studentIds.length) return res.json([])

    // Teachers see only referrals they raised; admins see the full queue.
    const referrals = await prisma.wellbeingReferral.findMany({
      where: {
        studentId: { in: studentIds },
        ...(role === ROLE.ADMIN ? {} : { raisedById: user.id }),
      },
      include: {
        student: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, name: true } },
        raisedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(
      referrals.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        student: r.student?.name ?? null,
        course: r.course ? `${r.course.code} · ${r.course.name}` : null,
        raisedBy: r.raisedBy?.name ?? null,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
        canResolve: role === ROLE.ADMIN,
      })),
    )
  } catch (err) {
    next(err)
  }
})

analyticsRoutes.post('/referrals', async (req, res, next) => {
  try {
    const user = req.user
    if (roleOf(user) === ROLE.STUDENT) return res.status(403).json({ error: 'Teachers only' })

    const { studentId, courseId = null, reason, note = null } = req.body ?? {}
    if (!studentId || !reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'studentId and reason are required' })
    }

    // The referral must target someone the raiser can actually see, otherwise
    // this becomes a probe for "does this student id exist".
    const allowed = await scopedStudentIds(user)
    if (!allowed.includes(Number(studentId))) {
      return res.status(403).json({ error: 'That student is not in your scope' })
    }

    // courseId is attacker-controlled. Validating only the student would let a
    // teacher attach a case to a course outside their remit, and - because the
    // response echoes nothing but a status - use the endpoint to test whether
    // an arbitrary course id exists. Require it to be a course the raiser owns
    // *and* one the target is actually enrolled in. Admins are exempt: they are
    // the safeguarding backstop and may refer across course boundaries.
    let course = courseId == null ? null : Number(courseId)
    if (course != null && (!Number.isInteger(course) || course <= 0)) {
      return res.status(400).json({ error: 'courseId is not a valid course' })
    }
    if (course != null && !isAdmin(user)) {
      const owned = await scopedCourseIds(user)
      if (!owned.includes(course)) {
        return res.status(403).json({ error: 'That course is not in your scope' })
      }
      const enrolled = await prisma.enrollment.findFirst({
        where: { userId: Number(studentId), courseId: course },
        select: { id: true },
      })
      if (!enrolled) {
        return res.status(400).json({ error: 'That student is not enrolled in that course' })
      }
    }

    // One *open* referral per student/course/raiser. Closed and acknowledged
    // cases do not block a new one: a student can relapse, and the teacher who
    // is worried about them must be able to raise a fresh concern.
    const openDuplicate = await prisma.wellbeingReferral.findFirst({
      where: { studentId: Number(studentId), courseId: course, raisedById: user.id, status: 'open' },
      select: { id: true },
    })
    if (openDuplicate) return res.status(409).json({ error: 'Already referred' })

    const referral = await prisma.wellbeingReferral.create({
      data: {
        studentId: Number(studentId),
        courseId: course,
        raisedById: user.id,
        reason: String(reason).trim().slice(0, 200),
        note: note ? String(note).slice(0, 500) : null,
      },
    })

    await logAccess({ actor: user, action: 'referral.raised', targetId: Number(studentId), scope: await scopeLabel(user) })
    res.status(201).json({ id: referral.id, status: referral.status })
  } catch (err) {
    // Unique(studentId, courseId, raisedById) - a second referral is a no-op.
    if (err?.code === 'P2002') return res.status(409).json({ error: 'Already referred' })
    next(err)
  }
})

analyticsRoutes.patch('/referrals/:id', async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' })
    const { status } = req.body ?? {}
    if (!['open', 'acknowledged', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be open | acknowledged | closed' })
    }
    const id = Number(req.params.id)
    const existing = await prisma.wellbeingReferral.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const updated = await prisma.wellbeingReferral.update({
      where: { id },
      data: { status, resolvedAt: status === 'closed' ? new Date() : null },
    })

    await logAccess({
      actor: req.user,
      action: `referral.${status}`,
      targetId: existing.studentId,
      metadata: { referralId: id },
    })
    res.json({ id: updated.id, status: updated.status })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ *
 * /audit - admin only.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/audit', async (req, res, next) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admins only' })
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const entries = await prisma.auditLog.findMany({
      include: {
        actor: { select: { id: true, name: true, role: true } },
        target: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    await logAccess({ actor: req.user, action: 'audit.viewed' })
    res.json(
      entries.map((e) => ({
        id: e.id,
        actor: e.actor?.name ?? 'unknown',
        actorRole: e.actor?.role ?? null,
        action: e.action,
        target: e.target?.name ?? null,
        scope: e.scope,
        createdAt: e.createdAt,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ *
 * /factor-weights - the hand-tuned weights behind the model.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/factor-weights', (_req, res) => {
  res.json(factorWeights)
})

/* ------------------------------------------------------------------ *
 * /overview - redesigned analytics payload for the student.
 * ------------------------------------------------------------------ */
analyticsRoutes.get('/overview', async (req, res, next) => {
  try {
    const user = req.user
    const uid = user?.id
    if (!uid) return res.status(401).json({ error: 'Login required.' })
    const range = String(req.query.range || 'semester')
    if (!['semester', '30d', 'ia1'].includes(range)) {
      return res.status(400).json({ error: 'Invalid range.' })
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { userId: uid },
      include: { course: true },
    })

    let attSum = 0, attCount = 0, weighted = 0, credits = 0
    for (const e of enrollments) {
      if (e.attendance != null) { attSum += e.attendance; attCount += 1 }
      if (e.ia1 != null && e.ia2 != null) {
        const cr = e.course?.credits || 3
        weighted += ((e.ia1 + e.ia2) / 2) * cr
        credits += cr
      }
    }
    const avgAttendance = attCount > 0 ? Math.round(attSum / attCount) : null
    const cgpa = credits > 0 ? weighted / credits / 10 : null
    const markRows = enrollments.filter((e) => marksOf(e) != null)
    const avgMarks = markRows.length
      ? Math.round(markRows.reduce((s, e) => s + (marksOf(e) ?? 0), 0) / markRows.length)
      : null

    const prediction = predictRisk({ attendance: avgAttendance, cgpa })
    const riskScore = Math.round(prediction.score)
    const riskLabel = prediction.risk

    const courses = enrollments.map((e) => {
      const att = e.attendance ?? 0
      const totalClasses = 100
      const attendedClasses = Math.round((att / 100) * totalClasses)
      const classesNeeded = att >= 75 ? 0 : Math.max(0, Math.ceil(3 * totalClasses - 4 * attendedClasses))
      return {
        subject: `${e.course?.code ?? ''} · ${e.course?.name ?? ''}`.trim(),
        code: e.course?.code ?? '',
        ia1: e.ia1 ?? null,
        ia2: e.ia2 ?? null,
        delta: e.ia1 != null && e.ia2 != null ? e.ia2 - e.ia1 : null,
        attendance: e.attendance ?? null,
        threshold: 75,
        belowThreshold: (e.attendance ?? 0) < 75,
        classesNeeded,
      }
    })

    const drivers = []
    for (const c of courses) {
      if (c.attendance != null && c.attendance < 75) {
        drivers.push({ label: `Low attendance in ${c.code}`, points: Math.round((75 - c.attendance) * 0.5) })
      }
      if (c.delta != null && c.delta < 0) {
        drivers.push({ label: `${c.code} marks dropped ${Math.abs(c.delta)} pts`, points: Math.abs(c.delta) })
      }
    }
    drivers.sort((a, b) => b.points - a.points)
    const topDrivers = drivers.slice(0, 4)

    const below = courses.filter((c) => c.attendance != null && c.attendance < 75)
    let safeZone = null
    if (below.length) {
      const worst = below.reduce((a, b) => (a.attendance < b.attendance ? a : b))
      safeZone = { course: worst.code, current: worst.attendance, classesNeeded: worst.classesNeeded }
    }

    const actions = []
    for (const c of below.slice(0, 2)) {
      actions.push({ title: `Show up for ${c.code} this week`, detail: `Attendance is ${c.attendance}%`, impactPoints: (75 - c.attendance) * 0.5, cta: 'Add to planner' })
    }
    for (const c of courses.filter((x) => x.delta != null && x.delta < 0).slice(0, 2)) {
      if (actions.length < 3) actions.push({ title: `Revise ${c.code} before IA3`, detail: `Marks dropped ${Math.abs(c.delta)} pts`, impactPoints: Math.abs(c.delta), cta: 'Ask AI tutor' })
    }
    for (const c of courses) {
      if (actions.length >= 3) break
      if ((c.attendance ?? 0) >= 90 && (c.ia2 ?? 0) >= 90) {
        actions.push({ title: `Keep ${c.code} going`, detail: 'Great marks and attendance', impactPoints: 0, cta: null })
      }
    }
    actions.sort((a, b) => b.impactPoints - a.impactPoints)
    const topActions = actions.slice(0, 3)

    const goodMarks = (avgMarks ?? 0) >= 75
    const goodAtt = (avgAttendance ?? 0) >= 75
    let summaryText = ''
    if (goodMarks && !goodAtt) summaryText = "You're acing exams. Attendance is the one thing holding your risk at " + riskLabel.toLowerCase() + "."
    else if (!goodMarks && goodAtt) summaryText = "Attendance is solid, but marks need work to lower your risk."
    else if (!goodMarks && !goodAtt) summaryText = "Both marks and attendance need attention to reduce your risk."
    else summaryText = "Great work! Keep your marks and attendance up."

    let percentile = null
    const cohort = await prisma.enrollment.groupBy({ by: ['userId'], _count: true })
    if (cohort.length >= 10 && avgMarks != null) {
      const all = await prisma.enrollment.findMany({ select: { ia1: true, ia2: true, userId: true } })
      const byUser = new Map()
      for (const e of all) {
        if (e.ia1 != null && e.ia2 != null) {
          const m = Math.round((e.ia1 + e.ia2) / 2)
          if (!byUser.has(e.userId)) byUser.set(e.userId, [])
          byUser.get(e.userId).push(m)
        }
      }
      const avgs = [...byUser.values()].map((arr) => arr.reduce((a, b) => a + b, 0) / arr.length)
      const belowCount = avgs.filter((m) => m < avgMarks).length
      percentile = `Top ${100 - Math.round((belowCount / avgs.length) * 100)}% of your batch`
    }

    res.json({
      range,
      riskScore,
      riskLabel,
      stats: { attendance: avgAttendance, marks: avgMarks, trend: null, delta: null, percentile: percentile || undefined },
      courses,
      drivers: topDrivers,
      safeZone,
      actions: topActions,
      summaryText,
    })
  } catch (err) {
    next(err)
  }
})
