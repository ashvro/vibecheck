import { Router } from 'express'
import { prisma } from '../prisma.js'
import { requireRole } from '../middleware/auth.js'

export const lmsRoutes = Router()

function daysLeft(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000))
}

function withDaysLeft(row) {
  return { ...row, daysLeft: daysLeft(row.date) }
}

async function recomputeCourseAttendance(courseId) {
  const [sessions, enrollments] = await Promise.all([
    prisma.classSession.count({ where: { courseId } }),
    prisma.enrollment.findMany({ where: { courseId } }),
  ])
  if (sessions === 0) return
  const present = await prisma.attendanceRecord.groupBy({
    by: ['userId'],
    where: { present: true, session: { courseId } },
    _count: { _all: true },
  })
  const counts = new Map(present.map((p) => [p.userId, p._count._all]))
  await Promise.all(
    enrollments.map((e) => {
      const attended = counts.get(e.userId) ?? 0
      const pct = Math.round((attended / sessions) * 100)
      return prisma.enrollment.update({ where: { id: e.id }, data: { attendance: pct } })
    }),
  )
}

async function withAttendanceStats(enrollments) {
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))]
  if (courseIds.length === 0) return enrollments

  const sessions = await prisma.classSession.findMany({
    where: { courseId: { in: courseIds } },
    select: { id: true, courseId: true },
  })
  const sessionCourse = new Map(sessions.map((s) => [s.id, s.courseId]))
  const byCourse = new Map()
  for (const s of sessions) byCourse.set(s.courseId, (byCourse.get(s.courseId) ?? 0) + 1)

  const records = await prisma.attendanceRecord.findMany({
    where: { sessionId: { in: [...sessionCourse.keys()] }, present: true },
    select: { sessionId: true, userId: true },
  })
  const attended = new Map()
  for (const r of records) {
    const key = `${r.userId}:${sessionCourse.get(r.sessionId)}`
    attended.set(key, (attended.get(key) ?? 0) + 1)
  }

  return enrollments.map((e) => ({
    ...e,
    classesTaken: byCourse.get(e.courseId) ?? 0,
    classesAttended: attended.get(`${e.userId}:${e.courseId}`) ?? 0,
  }))
}

function validDate(dateStr) {
  return typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
}

lmsRoutes.get('/courses', async (req, res, next) => {
  try {
    const courses = await prisma.course.findMany({
      include: { quizzes: true, assignments: true, _count: { select: { sessions: true } } },
      orderBy: { code: 'asc' },
    })
    res.json(courses.map(({ _count, ...c }) => ({ ...c, classCount: _count.sessions })))
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/courses', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { name, code, credits, instructor, color } = req.body || {}
    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({ error: 'name and code are required.' })
    }
    const existing = await prisma.course.findUnique({ where: { code: code.trim().toUpperCase() } })
    if (existing) {
      return res.status(409).json({ error: 'A course with this code already exists.' })
    }

    const course = await prisma.course.create({
      data: {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        credits: credits ? Math.max(1, Math.min(10, Number(credits))) : 3,
        instructor: instructor?.trim() || null,
        color: color?.trim() || null,
      },
      include: { quizzes: true, assignments: true },
    })
    res.status(201).json(course)
  } catch (err) {
    next(err)
  }
})

lmsRoutes.delete('/courses/:id', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const course = await prisma.course.findUnique({ where: { id } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    await prisma.course.delete({ where: { id } })
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/quizzes', async (req, res, next) => {
  try {
    const quizzes = await prisma.quiz.findMany({ include: { course: true }, orderBy: { date: 'asc' } })
    res.json(quizzes.map(withDaysLeft))
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/quizzes', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { courseId, title, date } = req.body || {}
    if (!courseId || !title?.trim()) {
      return res.status(400).json({ error: 'courseId and title are required.' })
    }
    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const quiz = await prisma.quiz.create({
      data: { courseId: Number(courseId), title: title.trim(), date: date || null },
    })
    res.status(201).json(withDaysLeft(quiz))
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/assignments', async (req, res, next) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: { course: true },
      orderBy: { createdAt: 'asc' },
    })

    const submissions = req.user
      ? await prisma.submission.findMany({
          where: { userId: req.user.id, type: 'assignment' },
          select: { courseId: true },
        })
      : []
    const submittedCourseIds = new Map()
    for (const s of submissions) {
      submittedCourseIds.set(s.courseId, (submittedCourseIds.get(s.courseId) ?? 0) + 1)
    }

    res.json(
      assignments.map((a) => ({
        ...a,
        submitted: req.user ? (submittedCourseIds.get(a.courseId) ?? 0) > 0 : false,
      })),
    )
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/assignments', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { courseId, title, due } = req.body || {}
    if (!courseId || !title?.trim()) {
      return res.status(400).json({ error: 'courseId and title are required.' })
    }
    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const assignment = await prisma.assignment.create({
      data: { courseId: Number(courseId), title: title.trim(), due: due || null },
    })
    res.status(201).json(assignment)
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/todos', async (req, res, next) => {
  try {
    const [quizzes, assignments] = await Promise.all([
      prisma.quiz.findMany({ include: { course: true } }),
      prisma.assignment.findMany({ include: { course: true } }),
    ])

    const enrolledCourseIds = new Set(
      req.user
        ? (await prisma.enrollment.findMany({ where: { userId: req.user.id }, select: { courseId: true } })).map((e) => e.courseId)
        : [],
    )

    const items = [
      ...quizzes.map((q) => ({
        id: `quiz-${q.id}`,
        title: q.title,
        course: q.course.code,
        courseName: q.course.name,
        date: q.date ?? '',
        daysLeft: daysLeft(q.date),
        kind: 'quiz',
        enrolled: enrolledCourseIds.size === 0 || enrolledCourseIds.has(q.courseId),
      })),
      ...assignments.map((a) => ({
        id: `assignment-${a.id}`,
        title: a.title,
        course: a.course?.code ?? 'Course',
        courseName: a.course?.name ?? '',
        date: a.due ?? '',
        daysLeft: daysLeft(a.due),
        kind: 'assignment',
        enrolled: enrolledCourseIds.size === 0 || enrolledCourseIds.has(a.courseId),
      })),
    ]

    items.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    res.json(items)
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/enrollments', async (req, res, next) => {
  try {
    if (!req.user) return res.json([])
    const where = {}
    if (req.query.courseId) where.courseId = Number(req.query.courseId)
    else where.userId = req.user.id

    const enrollments = await prisma.enrollment.findMany({
      where,
      include: { course: true, user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json(await withAttendanceStats(enrollments))
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/courses/:id/attendance', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const courseId = Number(req.params.id)
    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const [sessions, enrollments] = await Promise.all([
      prisma.classSession.findMany({
        where: { courseId },
        include: { records: true },
        orderBy: { date: 'asc' },
      }),
      prisma.enrollment.findMany({
        where: { courseId },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    res.json({
      course,
      sessions,
      enrollments: enrollments.map((e) => ({ id: e.id, userId: e.userId, name: e.user?.name ?? 'Student' })),
    })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/courses/:id/attendance', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const courseId = Number(req.params.id)
    const course = await prisma.course.findUnique({ where: { id: courseId } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const { date, records } = req.body || {}
    if (!validDate(date)) return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' })
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records must be an array.' })

    const session = await prisma.classSession.upsert({
      where: { courseId_date: { courseId, date } },
      create: { courseId, date },
      update: { date },
    })

    const entries = records
      .filter((r) => r && Number.isFinite(Number(r.userId)))
      .map((r) => ({ userId: Number(r.userId), present: Boolean(r.present) }))

    if (entries.length) {
      await Promise.all(
        entries.map((r) =>
          prisma.attendanceRecord.upsert({
            where: { sessionId_userId: { sessionId: session.id, userId: r.userId } },
            create: { sessionId: session.id, userId: r.userId, present: r.present },
            update: { present: r.present },
          }),
        ),
      )
    }

    await recomputeCourseAttendance(courseId)

    const full = await prisma.classSession.findUnique({
      where: { id: session.id },
      include: { records: true },
    })
    res.status(201).json(full)
  } catch (err) {
    next(err)
  }
})

lmsRoutes.delete('/courses/:id/attendance/:sessionId', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const courseId = Number(req.params.id)
    const sessionId = Number(req.params.sessionId)
    const session = await prisma.classSession.findUnique({ where: { id: sessionId } })
    if (!session || session.courseId !== courseId) {
      return res.status(404).json({ error: 'Session not found.' })
    }

    await prisma.classSession.delete({ where: { id: sessionId } })
    await recomputeCourseAttendance(courseId)
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/enroll', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required to enroll.' })
    const { courseId } = req.body || {}
    if (!courseId) return res.status(400).json({ error: 'courseId is required.' })

    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const enrollment = await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: req.user.id, courseId: Number(courseId) } },
      create: { userId: req.user.id, courseId: Number(courseId), ia1: 0, ia2: 0, attendance: 0 },
      update: {},
      include: { course: true },
    })
    res.status(201).json(enrollment)
  } catch (err) {
    next(err)
  }
})

lmsRoutes.delete('/enroll/:courseId', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required.' })
    const courseId = Number(req.params.courseId)
    await prisma.enrollment.deleteMany({ where: { userId: req.user.id, courseId } })
    res.json({ enrolled: false })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.patch('/enrollment/:id', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const { ia1, ia2, attendance } = req.body || {}
    const data = {}
    if (attendance !== undefined) data.attendance = attendance === null ? null : Math.max(0, Math.min(100, Number(attendance)))
    if (ia1 !== undefined) data.ia1 = ia1 === null ? null : Math.max(0, Math.min(100, Number(ia1)))
    if (ia2 !== undefined) data.ia2 = ia2 === null ? null : Math.max(0, Math.min(100, Number(ia2)))

    const enrollment = await prisma.enrollment.update({ where: { id }, data, include: { course: true } })
    res.json(enrollment)
  } catch (err) {
    next(err)
  }
})