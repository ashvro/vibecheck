import { Router } from 'express'
import { prisma } from '../prisma.js'
import { requireRole, requireAuth } from '../middleware/auth.js'
import { acceptPdf, sendPdf, absoluteUploadPath, removeUpload, cleanDisplayName } from '../utils/uploads.js'

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
      include: {
        quizzes: true,
        assignments: true,
        _count: { select: { sessions: true, enrollments: true } },
      },
      orderBy: { code: 'asc' },
    })
    res.json(
      courses.map(({ _count, ...c }) => ({
        ...c,
        classCount: _count.sessions,
        // Head-count per course, so the faculty dashboard can show how many
        // students sit in each course without one roster request per course.
        studentCount: _count.enrollments,
      })),
    )
  } catch (err) {
    next(err)
  }
})

/**
 * Staff directory for the course-assignment picker. Admin only: it is the list
 * a member of staff can be assigned to, and teachers cannot assign courses to
 * anyone, so they have no reason to see the full staff roster.
 */
lmsRoutes.get('/staff', requireRole('admin'), async (req, res, next) => {
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['teacher', 'admin'] } },
      select: { id: true, name: true, role: true, email: true },
      orderBy: { name: 'asc' },
    })
    res.json(staff)
  } catch (err) {
    next(err)
  }
})

/**
 * Headline counts for the faculty dashboard. `students` is distinct people,
 * not enrolments — a student in three courses must count once, or the card
 * reads higher than any roster behind it.
 */
lmsRoutes.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const [courses, students] = await Promise.all([
      prisma.course.count(),
      prisma.enrollment.groupBy({ by: ['userId'] }),
    ])
    res.json({ courses, students: students.length })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post('/courses', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const { name, code, credits, instructor, color, instructorId } = req.body || {}
    if (!name?.trim() || !code?.trim()) {
      return res.status(400).json({ error: 'name and code are required.' })
    }
    const existing = await prisma.course.findUnique({ where: { code: code.trim().toUpperCase() } })
    if (existing) {
      return res.status(409).json({ error: 'A course with this code already exists.' })
    }

    // instructorId is what authorises course-scoped analytics, so it decides
    // who can see the students enrolled here. A teacher may only claim a
    // course for themselves; assigning someone else's course is admin-only.
    let assignedId = null
    if (instructorId != null && instructorId !== '') {
      const target = Number(instructorId)
      if (!Number.isInteger(target)) {
        return res.status(400).json({ error: 'instructorId must be a user id.' })
      }
      const staff = await prisma.user.findUnique({ where: { id: target }, select: { id: true, role: true } })
      if (!staff) return res.status(400).json({ error: 'Instructor not found.' })
      if (!['teacher', 'admin'].includes(staff.role)) {
        return res.status(400).json({ error: 'Instructor must be teaching staff.' })
      }
      if (req.user.role !== 'admin' && target !== req.user.id) {
        return res.status(403).json({ error: 'Only an admin can assign a course to another member of staff.' })
      }
      assignedId = target
    }

    const course = await prisma.course.create({
      data: {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        credits: credits ? Math.max(1, Math.min(10, Number(credits))) : 3,
        instructor: instructor?.trim() || null,
        instructorId: assignedId,
        color: color?.trim() || null,
      },
      include: { quizzes: true, assignments: true },
    })
    res.status(201).json(course)
  } catch (err) {
    next(err)
  }
})

/**
 * Assign or clear a course's instructor. Admin only, because this is the
 * control that decides who may see the enrolled students in analytics.
 */
lmsRoutes.patch('/courses/:id/instructor', requireRole('admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const course = await prisma.course.findUnique({ where: { id } })
    if (!course) return res.status(404).json({ error: 'Course not found.' })

    const { instructorId, instructor } = req.body || {}
    let assignedId = null
    if (instructorId != null && instructorId !== '') {
      const target = Number(instructorId)
      if (!Number.isInteger(target)) {
        return res.status(400).json({ error: 'instructorId must be a user id.' })
      }
      const staff = await prisma.user.findUnique({ where: { id: target }, select: { id: true, role: true } })
      if (!staff) return res.status(400).json({ error: 'Instructor not found.' })
      if (!['teacher', 'admin'].includes(staff.role)) {
        return res.status(400).json({ error: 'Instructor must be teaching staff.' })
      }
      assignedId = target
    }

    const updated = await prisma.course.update({
      where: { id },
      data: {
        instructorId: assignedId,
        ...(instructor !== undefined ? { instructor: instructor?.trim() || null } : {}),
      },
      select: { id: true, code: true, name: true, instructor: true, instructorId: true },
    })
    res.json(updated)
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

const isStaff = (user) => user?.role === 'teacher' || user?.role === 'admin'

/** Shapes a submission for the owning student (no staff-only grading fields). */
function ownSubmission(s) {
  if (!s) return null
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    hasFile: Boolean(s.fileStoredAs),
    fileName: s.fileName ?? null,
    fileSize: s.fileSize ?? null,
    notes: s.notes ?? null,
    score: s.score ?? null,
    feedback: s.feedback ?? null,
    graded: Boolean(s.gradedAt),
    submittedAt: s.createdAt,
  }
}

function presentAssignment(a, { submission, submissionCount }) {
  return {
    id: a.id,
    courseId: a.courseId,
    course: a.course,
    title: a.title,
    due: a.due,
    daysLeft: daysLeft(a.due),
    instructions: a.instructions ?? null,
    hasPdf: Boolean(a.pdfStoredAs),
    pdfName: a.pdfName ?? null,
    pdfSize: a.pdfSize ?? null,
    createdAt: a.createdAt,
    submitted: Boolean(submission),
    submission: ownSubmission(submission),
    // Staff-only tally; omitted entirely for students.
    ...(submissionCount === undefined ? {} : { submissionCount }),
  }
}

lmsRoutes.get('/assignments', async (req, res, next) => {
  try {
    const assignments = await prisma.assignment.findMany({
      include: { course: true },
      orderBy: [{ courseId: 'asc' }, { createdAt: 'asc' }],
    })

    const staff = isStaff(req.user)
    const ids = assignments.map((a) => a.id)

    const [mine, grouped] = await Promise.all([
      req.user && !staff && ids.length
        ? prisma.submission.findMany({ where: { userId: req.user.id, assignmentId: { in: ids } } })
        : [],
      ids.length
        ? prisma.submission.groupBy({
            by: ['assignmentId'],
            where: { assignmentId: { in: ids } },
            _count: { _all: true },
          })
        : [],
    ])

    const mineByAssignment = new Map(mine.map((s) => [s.assignmentId, s]))
    const countByAssignment = new Map(grouped.map((g) => [g.assignmentId, g._count._all]))

    res.json(
      assignments.map((a) =>
        presentAssignment(a, {
          submission: mineByAssignment.get(a.id),
          submissionCount: staff ? (countByAssignment.get(a.id) ?? 0) : undefined,
        }),
      ),
    )
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post(
  '/assignments',
  requireRole('teacher', 'admin'),
  acceptPdf('assignments'),
  async (req, res, next) => {
    try {
      const { courseId, title, due, instructions } = req.body || {}
      if (!courseId || !title?.trim()) {
        if (req.file) removeUpload('assignments', req.file.filename)
        return res.status(400).json({ error: 'courseId and title are required.' })
      }
      const course = await prisma.course.findUnique({ where: { id: Number(courseId) } })
      if (!course) {
        if (req.file) removeUpload('assignments', req.file.filename)
        return res.status(404).json({ error: 'Course not found.' })
      }

      const assignment = await prisma.assignment.create({
        data: {
          courseId: Number(courseId),
          title: title.trim(),
          due: due || null,
          instructions: instructions?.trim() || null,
          pdfName: req.file ? cleanDisplayName(req.file.originalname, 'assignment.pdf') : null,
          pdfStoredAs: req.file?.filename ?? null,
          pdfMime: req.file?.mimetype ?? null,
          pdfSize: req.file?.size ?? null,
        },
        include: { course: true },
      })
      res.status(201).json(presentAssignment(assignment, {}))
    } catch (err) {
      if (req.file) removeUpload('assignments', req.file.filename)
      next(err)
    }
  },
)

lmsRoutes.get('/assignments/:id/pdf', requireAuth, async (req, res, next) => {
  try {
    const assignment = await prisma.assignment.findUnique({ where: { id: Number(req.params.id) } })
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })
    if (!assignment.pdfStoredAs) return res.status(404).json({ error: 'No PDF attached to this assignment.' })

    const absolutePath = absoluteUploadPath('assignments', assignment.pdfStoredAs)
    if (!absolutePath) return res.status(404).json({ error: 'File not found.' })
    return sendPdf(res, { absolutePath, downloadName: assignment.pdfName, mime: assignment.pdfMime })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.patch(
  '/assignments/:id',
  requireRole('teacher', 'admin'),
  acceptPdf('assignments'),
  async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const existing = await prisma.assignment.findUnique({ where: { id } })
      if (!existing) {
        if (req.file) removeUpload('assignments', req.file.filename)
        return res.status(404).json({ error: 'Assignment not found.' })
      }

      const { title, due, instructions, removePdf } = req.body || {}
      const data = {}
      if (title !== undefined) {
        if (!title?.trim()) {
          if (req.file) removeUpload('assignments', req.file.filename)
          return res.status(400).json({ error: 'title cannot be empty.' })
        }
        data.title = title.trim()
      }
      if (due !== undefined) data.due = due || null
      if (instructions !== undefined) data.instructions = instructions?.trim() || null

      if (req.file) {
        data.pdfName = cleanDisplayName(req.file.originalname, 'assignment.pdf')
        data.pdfStoredAs = req.file.filename
        data.pdfMime = req.file.mimetype
        data.pdfSize = req.file.size
        // Only drop the previous file once the new one is safely assigned.
        removeUpload('assignments', existing.pdfStoredAs)
      } else if (removePdf === 'true' || removePdf === true) {
        data.pdfName = null
        data.pdfStoredAs = null
        data.pdfMime = null
        data.pdfSize = null
        removeUpload('assignments', existing.pdfStoredAs)
      }

      const assignment = await prisma.assignment.update({
        where: { id },
        data,
        include: { course: true },
      })
      res.json(presentAssignment(assignment, {}))
    } catch (err) {
      if (req.file) removeUpload('assignments', req.file.filename)
      next(err)
    }
  },
)

lmsRoutes.delete('/assignments/:id', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const assignment = await prisma.assignment.findUnique({ where: { id } })
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })

    const attachmentSubmissions = await prisma.submission.findMany({
      where: { assignmentId: id, fileStoredAs: { not: null } },
      select: { fileStoredAs: true },
    })

    await prisma.assignment.delete({ where: { id } })
    removeUpload('assignments', assignment.pdfStoredAs)
    for (const s of attachmentSubmissions) removeUpload('submissions', s.fileStoredAs)
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.post(
  '/assignments/:id/submit',
  requireAuth,
  acceptPdf('submissions'),
  async (req, res, next) => {
    try {
      const assignmentId = Number(req.params.id)
      const assignment = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true, courseId: true, title: true },
      })
      if (!assignment) {
        if (req.file) removeUpload('submissions', req.file.filename)
        return res.status(404).json({ error: 'Assignment not found.' })
      }

      const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null
      if (!req.file && !notes) {
        return res.status(400).json({ error: 'Attach a PDF or add a note before submitting.' })
      }

      const data = {
        userId: req.user.id,
        courseId: assignment.courseId,
        assignmentId,
        type: 'assignment',
        notes: notes || null,
        fileName: req.file ? cleanDisplayName(req.file.originalname, 'submission.pdf') : null,
        fileStoredAs: req.file?.filename ?? null,
        fileMime: req.file?.mimetype ?? null,
        fileSize: req.file?.size ?? null,
      }

      const existing = await prisma.submission.findUnique({
        where: { userId_assignmentId: { userId: req.user.id, assignmentId } },
      })

      if (existing) {
        if (req.file) removeUpload('submissions', existing.fileStoredAs)
        const updated = await prisma.submission.update({
          where: { id: existing.id },
          data: { ...data, score: null, feedback: null, gradedAt: null },
        })
        return res.json(ownSubmission(updated))
      }

      const created = await prisma.submission.create({ data })
      return res.status(201).json(ownSubmission(created))
    } catch (err) {
      if (req.file) removeUpload('submissions', req.file.filename)
      next(err)
    }
  },
)

lmsRoutes.get('/assignments/:id/submissions', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const assignmentId = Number(req.params.id)
    const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } })
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' })

    const [submissions, enrollments] = await Promise.all([
      prisma.submission.findMany({
        where: { assignmentId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.enrollment.findMany({
        where: { courseId: assignment.courseId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const byUser = new Map(submissions.map((s) => [s.userId, s]))
    res.json({
      assignment: presentAssignment(assignment, { submissionCount: submissions.length }),
      submissions: submissions.map((s) => ({
        ...ownSubmission(s),
        userId: s.userId,
        user: s.user,
      })),
      // Everyone enrolled, so faculty can see who has not submitted yet.
      roster: enrollments.map((e) => ({
        userId: e.userId,
        user: e.user,
        submitted: byUser.has(e.userId),
        submissionId: byUser.get(e.userId)?.id ?? null,
      })),
    })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.get('/submissions/:id/file', requireAuth, async (req, res, next) => {
  try {
    const submission = await prisma.submission.findUnique({ where: { id: Number(req.params.id) } })
    if (!submission) return res.status(404).json({ error: 'Submission not found.' })
    // Student work is private: only the owner or staff may open it.
    if (submission.userId !== req.user.id && !isStaff(req.user)) {
      return res.status(403).json({ error: 'You do not have access to this submission.' })
    }
    if (!submission.fileStoredAs) return res.status(404).json({ error: 'No file attached to this submission.' })

    const absolutePath = absoluteUploadPath('submissions', submission.fileStoredAs)
    if (!absolutePath) return res.status(404).json({ error: 'File not found.' })
    return sendPdf(res, {
      absolutePath,
      downloadName: submission.fileName,
      mime: submission.fileMime,
    })
  } catch (err) {
    next(err)
  }
})

lmsRoutes.patch('/submissions/:id', requireRole('teacher', 'admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const submission = await prisma.submission.findUnique({ where: { id } })
    if (!submission) return res.status(404).json({ error: 'Submission not found.' })

    const { score, feedback } = req.body || {}
    const data = {}
    if (score !== undefined) {
      if (score === null || score === '') {
        data.score = null
        data.gradedAt = null
      } else {
        const numeric = Number(score)
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
          return res.status(400).json({ error: 'score must be a number between 0 and 100.' })
        }
        data.score = numeric
        data.gradedAt = new Date()
      }
    }
    if (feedback !== undefined) data.feedback = feedback?.trim() || null

    const updated = await prisma.submission.update({ where: { id }, data })
    res.json(ownSubmission(updated))
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