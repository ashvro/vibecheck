import { Router } from 'express'
import { prisma } from '../prisma.js'
import { factorWeights } from '../data/store.js'

export const analyticsRoutes = Router()

analyticsRoutes.get('/summary', async (req, res, next) => {
  try {
    const uid = req.user?.id
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [posts, clubs] = await Promise.all([
      prisma.post.count(),
      prisma.club.count(),
    ])

    const checkIns = uid ? await prisma.checkIn.count({ where: { userId: uid } }) : 0
    const messages = uid ? await prisma.chatMessage.count({ where: { userId: uid, role: 'user' } }) : 0
    const checkInsWeek = uid
      ? await prisma.checkIn.count({ where: { userId: uid, createdAt: { gte: weekAgo } } })
      : 0

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
          const pct = Math.round((e.ia1 + e.ia2) / 2)
          weighted += pct * (e.course.credits || 3)
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
    })
  } catch (err) {
    next(err)
  }
})

analyticsRoutes.get('/risk-students', async (req, res, next) => {
  try {
    if (!req.user) return res.json([])

    const isStaff = ['teacher', 'admin'].includes(req.user.role)
    const uidFilter = isStaff ? {} : { userId: req.user.id }

    const enrollments = await prisma.enrollment.findMany({
      where: uidFilter,
      include: { course: true, user: { select: { id: true, name: true } } },
    })

    const sessions = await prisma.chatSession.findMany({
      where: uidFilter,
      select: { userId: true, sentimentScore: true },
      orderBy: { updatedAt: 'desc' },
    })
    const sentimentByUser = new Map()
    for (const s of sessions) {
      if (s.userId == null || s.sentimentScore == null) continue
      if (!sentimentByUser.has(s.userId)) sentimentByUser.set(s.userId, s.sentimentScore)
    }

    const weightOf = (name) => factorWeights.find((f) => f.name === name)?.value ?? 0
    const wGrade = weightOf('Grades') / 100
    const wAtt = weightOf('Attendance') / 100
    const wSent = weightOf('Well-being Sentiment') / 100

    const students = enrollments
      .filter((e) => e.attendance != null || e.ia1 != null || e.ia2 != null)
      .map((e) => {
        const attendance = e.attendance ?? 0
        const grade = e.ia1 != null && e.ia2 != null ? Math.round((e.ia1 + e.ia2) / 2) : 0
        const sentiment = sentimentByUser.get(e.userId ?? req.user?.id)

        let weightSum = wGrade
        if (e.attendance != null) weightSum += wAtt
        if (sentiment != null) weightSum += wSent
        weightSum = Math.max(weightSum, 1e-6)

        const weightedContribution =
          (grade / 100) * wGrade +
          (attendance / 100) * wAtt +
          (sentiment ?? 0) * wSent

        const score = Math.round((1 - weightedContribution / weightSum) * 100)
        const risk = score < 30 ? 'Low' : score < 55 ? 'Moderate' : 'High'

        const weakFactors = []
        if (grade < 70) weakFactors.push('grades')
        if (attendance < 70) weakFactors.push('attendance')
        if (sentiment != null && sentiment < 0.55) weakFactors.push('well-being')

        let recommendation
        if (risk === 'High') {
          recommendation = `Risk is elevated — ${weakFactors.join(', ') || 'baseline signals'} need attention. Schedule a check-in and agree on a catch-up plan.`
        } else if (risk === 'Moderate') {
          recommendation = `Watch ${weakFactors.join(', ') || 'baseline signals'} closely — a weekly progress review could help.`
        } else {
          recommendation = 'Signals look healthy — keep up the engagement.'
        }

        return {
          id: e.id,
          name: isStaff ? e.user?.name ?? null : null,
          subject: `${e.course.code} · ${e.course.name}`,
          risk,
          score,
          attendance,
          ia1: e.ia1,
          ia2: e.ia2,
          sentiment: sentiment != null ? Math.round(sentiment * 100) : null,
          recommendation,
        }
      })
      .sort((a, b) => b.score - a.score)

    const filtered =
      req.query.risk && String(req.query.risk) !== 'All'
        ? students.filter((s) => s.risk === String(req.query.risk))
        : students

    res.json(filtered)
  } catch (err) {
    next(err)
  }
})

analyticsRoutes.get('/risk-trend', async (req, res, next) => {
  try {
    const weeks = []
    for (let w = 5; w >= 0; w -= 1) {
      const start = new Date()
      start.setDate(start.getDate() - (w + 1) * 7)
      const end = new Date()
      end.setDate(end.getDate() - w * 7)
      const uidFilter = ['teacher', 'admin'].includes(req.user?.role)
        ? {}
        : { userId: req.user?.id }
      const checkIns = req.user
        ? await prisma.checkIn.findMany({
            where: { ...uidFilter, createdAt: { gte: start, lt: end } },
            select: { score: true },
          })
        : []
      const count = checkIns.length
      const avg =
        count > 0 ? Math.round(checkIns.reduce((s, c) => s + (c.score ?? 0), 0) / count * 50 + 50) : null
      weeks.push({ week: `W${6 - w}`, count, sentiment: avg })
    }
    res.json(weeks)
  } catch (err) {
    next(err)
  }
})

analyticsRoutes.get('/chat-sentiment', async (req, res, next) => {
  try {
    if (!req.user) return res.json({ average: null, averagePct: null, messages: 0, sessions: 0, weeks: [] })

    const isStaff = ['teacher', 'admin'].includes(req.user.role)
    const uidFilter = isStaff ? {} : { userId: req.user.id }

    const [rows, sessions] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { ...uidFilter, role: 'user', intent: 'mental_health', score: { not: null } },
        select: { score: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.chatSession.count({
        where: { ...uidFilter, sentimentScore: { not: null } },
      }),
    ])

    const totPct = rows.reduce((sum, r) => sum + r.score, 0)
    const average = rows.length ? Math.round((totPct / rows.length) * 100) / 100 : null
    const averagePct = average != null ? Math.round(average * 100) : null

    const now = new Date()
    const weeks = []
    for (let w = 5; w >= 0; w -= 1) {
      const start = new Date(now.getTime())
      start.setDate(start.getDate() - (w + 1) * 7)
      const end = new Date(now.getTime())
      end.setDate(end.getDate() - w * 7)
      const inWeek = rows.filter((r) => r.createdAt >= start && r.createdAt < end)
      const count = inWeek.length
      weeks.push({
        week: `W${6 - w}`,
        count,
        sentiment: count ? Math.round((inWeek.reduce((s, r) => s + r.score, 0) / count) * 100) : null,
      })
    }

    res.json({ average, averagePct, messages: rows.length, sessions, weeks })
  } catch (err) {
    next(err)
  }
})

analyticsRoutes.get('/factor-weights', (_req, res) => {
  res.json(factorWeights)
})