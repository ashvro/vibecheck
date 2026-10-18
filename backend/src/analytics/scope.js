/**
 * Role scoping for every analytics surface.
 *
 * Three views, one rule set:
 *
 *   student  self only. Sees their own risk, marks and attendance.
 *   teacher  only students enrolled in courses they teach (Course.instructorId).
 *            Sees per-student marks and attendance, plus a referral action that
 *            hands a concern to staff with a safeguarding duty.
 *   admin    institution wide, and the only role that can resolve a referral.
 *            Every read of a student's records is written to the audit log.
 *
 * A course with no instructorId belongs to nobody: no teacher can see its
 * students until an admin assigns an instructor. Admins always can.
 */

import { prisma } from '../prisma.js'

export const ROLE = { STUDENT: 'student', TEACHER: 'teacher', ADMIN: 'admin' }

export function roleOf(user) {
  const r = String(user?.role ?? '')
  return r === 'admin' || r === 'teacher' ? r : ROLE.STUDENT
}

export function isAdmin(user) {
  return roleOf(user) === ROLE.ADMIN
}

export function isTeacher(user) {
  return roleOf(user) === ROLE.TEACHER
}

/** Course ids the viewer may read student records for. `null` means "all". */
export async function scopedCourseIds(user) {
  if (isAdmin(user)) return null
  if (isTeacher(user)) {
    const rows = await prisma.course.findMany({
      where: { instructorId: user.id },
      select: { id: true },
    })
    return rows.map((r) => r.id)
  }
  return []
}

/**
 * Prisma `where` for the enrollment rows a viewer is allowed to see.
 * Returns a clause that can be spread into any enrollment query.
 */
export async function scopedEnrollmentWhere(user) {
  const role = roleOf(user)
  if (role === ROLE.STUDENT) return { userId: user.id }

  if (role === ROLE.ADMIN) return {}

  const courseIds = await scopedCourseIds(user)
  // `in: []` is a valid, always-false Int filter: a teacher with no assigned
  // courses gets nothing, rather than everything.
  if (!courseIds.length) return { courseId: { in: [] } }
  return { courseId: { in: courseIds } }
}

/** Ids of the students a viewer may see, derived from enrollment scope. */
export async function scopedStudentIds(user) {
  const role = roleOf(user)
  if (role === ROLE.STUDENT) return [user.id]
  if (role === ROLE.ADMIN) {
    const rows = await prisma.user.findMany({ where: { role: ROLE.STUDENT }, select: { id: true } })
    return rows.map((r) => r.id)
  }
  const courseIds = await scopedCourseIds(user)
  if (!courseIds.length) return []
  const rows = await prisma.enrollment.findMany({
    where: { courseId: { in: courseIds } },
    select: { userId: true },
    distinct: ['userId'],
  })
  return rows.map((r) => r.userId)
}

/** Human-readable description of what this viewer can see, for the UI header. */
export async function scopeLabel(user) {
  const role = roleOf(user)
  if (role === ROLE.STUDENT) return 'Your own data only'
  if (role === ROLE.ADMIN) return 'All students, all courses'
  const courseIds = await scopedCourseIds(user)
  if (!courseIds.length) return 'No courses assigned to you yet'
  return `${courseIds.length} course${courseIds.length === 1 ? '' : 's'} you teach`
}

/**
 * Record that staff read a student's records. Never throws: an audit write
 * must not be able to break the response the viewer is waiting for.
 */
export async function logAccess({ actor, action, targetId = null, scope = null, metadata = null }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action,
        targetId,
        scope,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    })
  } catch {
    /* auditing is best-effort */
  }
}

/**
 * Log one entry per student record the caller is about to return. Bulk reads
 * are the interesting case, so this is called in a loop by the routes rather
 * than once per request.
 */
export async function logRosterAccess(actor, studentIds, action, scope) {
  const role = roleOf(actor)
  if (role === ROLE.STUDENT) return
  await Promise.all(studentIds.map((id) => logAccess({ actor, action, targetId: id, scope })))
}
