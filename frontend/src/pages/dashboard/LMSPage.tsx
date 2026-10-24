import { useEffect, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { BookOpen, GraduationCap, LayoutDashboard, CheckCircle2, PlusCircle, UserCheck, Users, FilePlus2, ClipboardCheck, CalendarCheck, Trash2, ClipboardList } from 'lucide-react'
import { api } from '../../lib/api'
import { sortAssignments } from '../../lib/assignments'
import { PageHeader } from '../../components/PageHeader'
import {
  StudentAssignments,
  FacultyAssignments,
  CreateAssignmentForm,
  SubmissionsPanel,
  type Assignment as AssignmentModel,
} from '../../components/lms/AssignmentBoard'

type LmsTab = 'dashboard' | 'assignments' | 'courses' | 'grades'

type Course = {
  id: number
  name: string
  code: string
  credits: number
  instructor: string | null
  instructorId: number | null
  color: string | null
  classCount: number
  studentCount: number
  quizzes: QuizLike[]
  assignments: Assignment[]
}

type QuizLike = { id: number; title: string; date: string; daysLeft: number | null }

type Enrollment = {
  id: number
  courseId: number
  ia1: number | null
  ia2: number | null
  attendance: number | null
  classesTaken?: number
  classesAttended?: number
  course: Course
  user?: { id: number; name: string }
}

type AttendanceSession = {
  id: number
  date: string
  records: { id: number; userId: number; present: boolean }[]
}

type AttendanceStudent = {
  id: number
  userId: number
  name: string
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

type Assignment = AssignmentModel

const lmsTabs: { id: LmsTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'grades', label: 'Grades', icon: GraduationCap },
]

type FacultyTab = 'dashboard' | 'courses' | 'students' | 'record' | 'assignments'

/** One tab per teaching job: see the class, then record against it. */
const facultyTabs: { id: FacultyTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'students', label: 'Students', icon: Users },
  { id: 'record', label: 'Attendance/Marks', icon: ClipboardCheck },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
]

function coursePct(e: Enrollment): number {
  if (e.ia1 == null || e.ia2 == null) return 0
  return Math.round((e.ia1 + e.ia2) / 2)
}

function cgpa10(enrolled: Enrollment[]): number {
  const valid = enrolled.filter((e) => e.ia1 != null && e.ia2 != null)
  if (valid.length === 0) return 0
  const [weighted, credits] = valid.reduce(
    ([w, c], e) => [w + coursePct(e) * (e.course.credits ?? 3), c + (e.course.credits ?? 3)],
    [0, 0],
  )
  return credits > 0 ? Math.round((weighted / credits / 10) * 100) / 100 : 0
}

function avgAttendance(enrolled: Enrollment[]): number {
  const withAtt = enrolled.filter((e) => e.attendance != null)
  if (withAtt.length === 0) return 0
  return Math.round(withAtt.reduce((s, e) => s + (e.attendance ?? 0), 0) / withAtt.length)
}

function letterGrade(pct: number): string {
  if (pct >= 90) return 'A'
  if (pct >= 80) return 'B'
  if (pct >= 70) return 'C'
  if (pct >= 60) return 'D'
  return 'F'
}

export function LMSPage() {
  const [userRole, setUserRole] = useState<string>('student')
  const [userId, setUserId] = useState<number | null>(null)
  const [staff, setStaff] = useState<{ id: number; name: string; role: string }[]>([])
  const [tab, setTab] = useState<LmsTab>('dashboard')
  const [courses, setCourses] = useState<Course[]>([])
  const [enrolled, setEnrolled] = useState<Enrollment[]>([])
  const [, setQuizzes] = useState<QuizLike[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  // The viewer's role decides which dashboard renders, so nothing is painted
  // until /api/auth/me answers — a teacher must never flash the student view.
  const [authLoading, setAuthLoading] = useState(true)

  const isStaff = userRole === 'teacher' || userRole === 'admin'

  useEffect(() => {
    api
      .get<{ role: string; id?: number }>('/api/auth/me')
      .then((me) => {
        setUserRole(me.role)
        if (typeof me.id === 'number') setUserId(me.id)
        // Only admins can hand a course to another member of staff, so only
        // admins need the staff directory.
        if (me.role === 'admin') {
          api
            .get<{ id: number; name: string; role: string }[]>('/api/lms/staff')
            .then(setStaff)
            .catch(() => setStaff([]))
        }
      })
      .catch(() => setUserRole('student'))
      .finally(() => setAuthLoading(false))
  }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [c, e, q, a] = await Promise.all([
        api.get<Course[]>('/api/lms/courses'),
        api.get<Enrollment[]>('/api/lms/enrollments'),
        api.get<QuizLike[]>('/api/lms/quizzes'),
        api.get<Assignment[]>('/api/lms/assignments'),
      ])
      setCourses(c)
      setEnrolled(e)
      setQuizzes(q)
      setAssignments(a)
    } catch {
      setCourses([])
      setEnrolled([])
      setQuizzes([])
      setAssignments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function toggleEnroll(courseId: number) {
    const already = enrolled.some((e) => e.courseId === courseId)
    try {
      if (already) {
        await api.del(`/api/lms/enroll/${courseId}`)
        setEnrolled((prev) => prev.filter((e) => e.courseId !== courseId))
      } else {
        const created = await api.post<Enrollment>('/api/lms/enroll', { courseId })
        setEnrolled((prev) => [...prev, created])
      }
    } catch {
      /* keep state unchanged on failure */
    }
  }

  if (authLoading) {
    return <p className="py-10 text-center text-sm text-muted">Loading…</p>
  }

  return (
    <div className="rise-grid mx-auto max-w-[1560px] space-y-6">
      <PageHeader
        title={isStaff ? 'Faculty Dashboard' : 'Learning Dashboard'}
        description={
          isStaff
            ? 'Manage attendance and internal assessment marks'
            : 'Courses, attendance, and grades'
        }
      />

      {!isStaff && (
        <>
          <TabNav tabs={lmsTabs} tab={tab} setTab={setTab} />
          {loading ? (
            <p className="py-10 text-center text-sm text-muted">Loading…</p>
          ) : (
            <>
              {tab === 'dashboard' && (
                <StudentDashboard
                  courses={courses}
                  enrolled={enrolled}
                  assignments={assignments}
                  onOpenAssignments={() => setTab('assignments')}
                />
              )}
              {tab === 'assignments' && (
                <StudentAssignmentsTab
                  assignments={assignments}
                  onChanged={(updated) =>
                    setAssignments((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
                  }
                />
              )}
              {tab === 'courses' && <StudentCourses courses={courses} enrolled={enrolled} toggleEnroll={toggleEnroll} />}
              {tab === 'grades' && <StudentGrades enrolled={enrolled} />}
            </>
          )}
        </>
      )}

      {isStaff && (
        <FacultyView
          courses={courses}
          assignments={assignments}
          onRefresh={loadAll}
          userRole={userRole}
          userId={userId}
          staff={staff}
        />
      )}
    </div>
  )
}

function TabNav<T extends string>({
  tabs,
  tab,
  setTab,
}: {
  tabs: { id: T; label: string; icon: typeof BookOpen }[]
  tab: T
  setTab: (t: T) => void
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition',
              tab === t.id ? 'border-ice text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            <Icon size={15} />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/* ─── Assignments tab ─── */
function StudentAssignmentsTab({
  assignments,
  onChanged,
}: {
  assignments: Assignment[]
  onChanged: (a: Assignment) => void
}) {
  const pending = assignments.filter((a) => !a.submitted).length
  const withPdf = assignments.filter((a) => a.hasPdf).length

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-5">
        <div>
          <p className="text-xs text-muted">Assignments</p>
          <p className="font-display text-2xl font-bold text-ink">{assignments.length}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Awaiting submission</p>
          <p className="font-display text-2xl font-bold text-amber-gentle">{pending}</p>
        </div>
        <div>
          <p className="text-xs text-muted">With PDF brief</p>
          <p className="font-display text-2xl font-bold text-ice">{withPdf}</p>
        </div>
      </div>

      <StudentAssignments assignments={assignments} onChanged={onChanged} />
    </div>
  )
}

/* ─── Dashboard ─── */
function StudentDashboard({
  courses,
  enrolled,
  assignments,
  onOpenAssignments,
}: {
  courses: Course[]
  enrolled: Enrollment[]
  assignments: Assignment[]
  onOpenAssignments: () => void
}) {
  // Show what needs action first, not raw API order.
  const topAssignments = sortAssignments(assignments)
  const cgpa = cgpa10(enrolled)
  const attendance = avgAttendance(enrolled)
  const myCourses = enrolled.map((e) => ({ rec: e, course: courses.find((c) => c.id === e.courseId) })).filter((x) => x.course)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Courses Enrolled', value: enrolled.length, icon: BookOpen, color: 'text-ice' },
          { label: 'Attendance', value: `${attendance}%`, icon: UserCheck, color: 'text-emerald-soft' },
          { label: 'CGPA (out of 10)', value: cgpa.toFixed(2), icon: GraduationCap, color: 'text-amber-gentle' },
        ].map((stat) => (
          <div key={stat.label} className="glass-ice rounded-lg p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">{stat.label}</p>
              <stat.icon size={15} className={stat.color} />
            </div>
            <p className="mt-2 font-display text-3xl font-bold text-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-ink">My Courses</h2>
          <div className="space-y-3">
            {enrolled.length === 0 && (
              <p className="rounded-lg border border-line p-4 text-sm text-muted">
                No courses yet — go to the Courses tab to enroll.
              </p>
            )}
            {myCourses.map(({ rec, course }) => (
              <div key={rec.id} className="glass-ice relative overflow-hidden rounded-lg p-4">
                <div className="absolute inset-y-0 left-0 w-1" style={{ background: course!.color ?? '#8b5cf6' }} />
                <div className="flex items-start justify-between pl-3">
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{course!.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {course!.code} · {course!.instructor ?? 'Faculty'}
                    </p>
                  </div>
                  <div className="ml-3 text-right">
                    <p className="text-sm font-semibold tabular-nums text-ice">{coursePct(rec)}%</p>
                    <p className="text-xs text-muted">{letterGrade(coursePct(rec))}</p>
                  </div>
                </div>
                <div className="mt-3 pl-3">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="text-muted">Attendance</span>
                    <span className="font-medium tabular-nums text-ink">
                      {rec.classesTaken ? `${rec.classesAttended ?? 0}/${rec.classesTaken} classes` : `${rec.attendance ?? 0}%`}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-ice/10">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        (rec.attendance ?? 0) >= 85
                          ? 'bg-emerald-soft'
                          : (rec.attendance ?? 0) >= 75
                            ? 'bg-amber-gentle'
                            : 'bg-rose-400',
                      )}
                      style={{ width: `${rec.attendance ?? 0}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex gap-5 pl-3 text-xs text-muted">
                  <span>
                    IA-1 <strong className="font-semibold text-ink">{rec.ia1 ?? '—'}</strong>
                  </span>
                  <span>
                    IA-2 <strong className="font-semibold text-ink">{rec.ia2 ?? '—'}</strong>
                  </span>
                  <span>
                    Credits <strong className="font-semibold text-ink">{course!.credits}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardList size={14} className="text-amber-gentle" />
                <h2 className="text-sm font-semibold text-ink">Assignments</h2>
              </div>
              {assignments.length > 0 && (
                <button
                  type="button"
                  onClick={onOpenAssignments}
                  className="font-mono text-[10px] tracking-wider text-ice uppercase transition hover:text-ice-bright"
                >
                  View all
                </button>
              )}
            </div>
            <div className="space-y-2">
              {assignments.length === 0 && (
                <p className="rounded-lg border border-line p-3 text-sm text-muted">No assignments yet.</p>
              )}
              {topAssignments.slice(0, 4).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={onOpenAssignments}
                  className="glass-ice flex w-full items-center justify-between gap-2 rounded-lg p-3 text-left text-sm transition hover:border-ice/25"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-ice">{a.course?.code ?? 'Course'}</p>
                    <p className="truncate text-sm font-medium text-ink">{a.title}</p>
                    <p className="text-xs text-muted">{a.due ? `Due ${a.due}` : 'No due date'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {a.hasPdf && (
                      <span className="rounded border border-ice/20 bg-ice/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-ice uppercase">
                        PDF
                      </span>
                    )}
                    <span
                      className={clsx(
                        'rounded border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase',
                        a.submitted
                          ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft'
                          : 'border-amber-gentle/40 bg-amber-gentle/10 text-amber-gentle',
                      )}
                    >
                      {a.submitted ? 'submitted' : 'pending'}
                    </span>
                  </div>
                </button>
              ))}
              {assignments.length > 4 && (
                <p className="px-1 text-center font-mono text-[10px] tracking-wider text-muted uppercase">
                  +{assignments.length - 4} more in the Assignments tab
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

/* ─── Courses catalog ─── */
function StudentCourses({
  courses,
  enrolled,
  toggleEnroll,
}: {
  courses: Course[]
  enrolled: Enrollment[]
  toggleEnroll: (courseId: number) => void
}) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-2">
        {courses.map((course) => {
          const isEnrolled = enrolled.some((e) => e.courseId === course.id)
          const rec = enrolled.find((e) => e.courseId === course.id)
          return (
            <div key={course.id} className="glass-ice relative overflow-hidden rounded-lg p-5">
              <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: course.color ?? '#8b5cf6' }} />
              <div className="flex items-start justify-between pl-4">
                <div>
                  <p className="text-base font-bold text-ink">{course.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted">{course.code}</p>
                  <p className="mt-1 text-xs text-muted">{course.instructor ?? 'Faculty'}</p>
                  <p className="mt-0.5 text-xs text-muted">{course.credits} credits</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleEnroll(course.id)}
                  className={clsx(
                    'flex shrink-0 items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-semibold transition',
                    isEnrolled
                      ? 'border-ice/40 bg-ice/10 text-ice'
                      : 'border-line text-muted hover:border-ice/40 hover:text-ink',
                  )}
                >
                  {isEnrolled ? <CheckCircle2 size={13} /> : <PlusCircle size={13} />}
                  {isEnrolled ? 'Enrolled' : 'Enroll'}
                </button>
              </div>
              {isEnrolled && rec && (
                <div className="mt-3 flex gap-4 pl-4 text-xs text-muted">
                  <span>
                    Attendance <strong className="font-semibold text-ink">
                      {rec.classesTaken
                        ? `${rec.classesAttended ?? 0}/${rec.classesTaken}`
                        : `${rec.attendance ?? 0}%`}
                    </strong>
                  </span>
                  <span>
                    IA-1 <strong className="font-semibold text-ink">{rec.ia1 ?? '—'}</strong>
                  </span>
                  <span>
                    IA-2 <strong className="font-semibold text-ink">{rec.ia2 ?? '—'}</strong>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Grades ─── */
function StudentGrades({ enrolled }: { enrolled: Enrollment[] }) {
  const cgpa = cgpa10(enrolled)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="glass-ice flex items-center justify-between rounded-lg p-5">
        <div>
          <p className="text-xs text-muted">CGPA</p>
          <p className="mt-1 font-display text-4xl font-bold text-ice">{cgpa.toFixed(2)}</p>
          <p className="mt-1 text-xs text-muted">out of 10</p>
        </div>
        <GraduationCap size={40} className="text-ice/30" />
      </div>

      <div className="overflow-x-auto border-y border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-3 pr-4 font-medium">Course</th>
              <th className="px-3 py-3 font-medium">IA-1 (out of 100)</th>
              <th className="px-3 py-3 font-medium">IA-2 (out of 100)</th>
              <th className="px-3 py-3 font-medium">Average</th>
              <th className="px-3 py-3 font-medium">Grade</th>
            </tr>
          </thead>
          <tbody>
            {enrolled.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-muted">
                  Enroll in courses to see grades.
                </td>
              </tr>
            )}
            {enrolled
              .filter((e) => e.ia1 != null || e.ia2 != null)
              .map((rec) => {
                const avg = coursePct(rec)
                return (
                  <tr key={rec.id} className="border-b border-line last:border-0">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: rec.course.color ?? '#8b5cf6' }} />
                        <div>
                          <p className="font-medium text-ink">{rec.course.name}</p>
                          <p className="font-mono text-xs text-muted">{rec.course.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-ink">{rec.ia1 ?? '—'}</td>
                    <td className="px-3 py-3 tabular-nums text-ink">{rec.ia2 ?? '—'}</td>
                    <td className="px-3 py-3 font-semibold tabular-nums text-ink">{avg}%</td>
                    <td className="px-3 py-3">
                      <span
                        className={clsx(
                          'inline-block rounded px-2 py-0.5 text-xs font-semibold',
                          avg >= 80
                            ? 'bg-emerald-soft/20 text-emerald-soft'
                            : avg >= 70
                              ? 'bg-amber-gentle/20 text-amber-gentle'
                              : 'bg-rose-400/20 text-rose-400',
                        )}
                      >
                        {letterGrade(avg)}
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ─── Faculty ─── */
function FacultyView({
  courses,
  assignments,
  onRefresh,
  userRole,
  userId,
  staff,
}: {
  courses: Course[]
  assignments: Assignment[]
  onRefresh: () => void
  userRole: string
  userId: number | null
  staff: { id: number; name: string; role: string }[]
}) {
  const [courseId, setCourseId] = useState<number | null>(null)
  const [ftab, setFtab] = useState<FacultyTab>('dashboard')
  const [students, setStudents] = useState<Enrollment[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [marks, setMarks] = useState<Record<number, { ia1: string; ia2: string }>>({})
  const [showAssignmentForm, setShowAssignmentForm] = useState(false)
  const [managing, setManaging] = useState<Assignment | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [showCourseForm, setShowCourseForm] = useState(false)
  const [courseDraft, setCourseDraft] = useState({
    name: '',
    code: '',
    credits: '3',
    instructor: '',
    instructorId: '',
    color: '#8b5cf6',
  })
  const isAdmin = userRole === 'admin'
  const [courseMsg, setCourseMsg] = useState('')
  // Distinct students across every course, for the dashboard's Students card.
  const [stats, setStats] = useState<{ courses: number; students: number } | null>(null)
  const [attendanceData, setAttendanceData] = useState<{ sessions: AttendanceSession[]; enrollments: AttendanceStudent[] } | null>(null)
  const [attDate, setAttDate] = useState(todayStr())
  const [attMap, setAttMap] = useState<Record<number, boolean>>({})
  const [attBusy, setAttBusy] = useState(false)
  const [attSaved, setAttSaved] = useState(false)

  useEffect(() => {
    api
      .get<{ courses: number; students: number }>('/api/lms/stats')
      .then(setStats)
      .catch(() => setStats(null))
  }, [])

  const selected = courses.find((c) => c.id === courseId) ?? null
  const courseAssignments = courseId === null
    ? []
    : assignments.filter((a) => a.courseId === courseId)

  useEffect(() => {
    if (courses.length && courseId === null) {
      setCourseId(courses[0].id)
    }
  }, [courses, courseId])

  useEffect(() => {
    if (courseId === null) return
    setBusy(true)
    api
      .get<Enrollment[]>(`/api/lms/enrollments?courseId=${courseId}`)
      .then((list) => {
        setStudents(list)
        setMarks(
          Object.fromEntries(
            list.map((s) => [
              s.id,
              { ia1: s.ia1 != null ? String(s.ia1) : '', ia2: s.ia2 != null ? String(s.ia2) : '' },
            ]),
          ),
        )
      })
      .catch(() => setStudents([]))
      .finally(() => setBusy(false))
  }, [courseId])

  function updateMark(id: number, field: 'ia1' | 'ia2', raw: string) {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, 3)
    setMarks((prev) => ({ ...prev, [id]: { ...prev[id], [field]: Number(digits) > 100 ? '100' : digits } }))
    setSaved(false)
  }

  async function loadAttendance() {
    if (courseId === null) return
    setAttBusy(true)
    try {
      const data = await api.get<{ sessions: AttendanceSession[]; enrollments: AttendanceStudent[] }>(
        `/api/lms/courses/${courseId}/attendance`,
      )
      setAttendanceData(data)
    } catch {
      setAttendanceData(null)
    } finally {
      setAttBusy(false)
    }
  }

  useEffect(() => {
    // Attendance is the whole point of the Attendance/Marks tab, so it loads
    // as soon as a teacher opens it instead of behind a toggle.
    if (ftab === 'record' && courseId !== null) {
      setAttDate(todayStr())
      loadAttendance()
    }
  }, [ftab, courseId])

  useEffect(() => {
    if (!attendanceData) return
    const session = attendanceData.sessions.find((s) => s.date === attDate)
    setAttMap(
      Object.fromEntries(
        attendanceData.enrollments.map((st) => {
          const rec = session?.records.find((r) => r.userId === st.userId)
          return [st.userId, rec ? rec.present : true]
        }),
      ),
    )
  }, [attDate, attendanceData])

  async function saveAttendance() {
    if (!courseId || !attendanceData) return
    setAttBusy(true)
    try {
      await api.post(`/api/lms/courses/${courseId}/attendance`, {
        date: attDate,
        records: attendanceData.enrollments.map((st) => ({
          userId: st.userId,
          present: attMap[st.userId] ?? true,
        })),
      })
      setAttSaved(true)
      setTimeout(() => setAttSaved(false), 2000)
      await loadAttendance()
      onRefresh()
    } catch {
      /* drop */
    } finally {
      setAttBusy(false)
    }
  }

  async function deleteSession(sessionId: number) {
    if (!courseId) return
    if (!window.confirm(`Delete attendance for this session? This cannot be undone.`)) return
    try {
      await api.del(`/api/lms/courses/${courseId}/attendance/${sessionId}`)
      await loadAttendance()
      onRefresh()
    } catch {
      /* drop */
    }
  }

  async function save() {
    for (const s of students) {
      const m = marks[s.id] ?? {}
      const ia1 = m.ia1 === undefined || m.ia1 === '' ? null : Number(m.ia1)
      const ia2 = m.ia2 === undefined || m.ia2 === '' ? null : Number(m.ia2)
      await api.patch(`/api/lms/enrollment/${s.id}`, { ia1, ia2 }).catch(() => {})
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function deleteAssignment(a: Assignment) {
    if (!window.confirm(`Delete "${a.title}"? This also removes every submission for it.`)) return
    setDeletingId(a.id)
    setPanelError(null)
    try {
      await api.del(`/api/lms/assignments/${a.id}`)
      if (managing?.id === a.id) setManaging(null)
      onRefresh()
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : 'Could not delete the assignment.')
    } finally {
      setDeletingId(null)
    }
  }

  async function createCourse(e: FormEvent) {
    e.preventDefault()
    if (!courseDraft.name.trim() || !courseDraft.code.trim()) return
    setCourseMsg('')
    try {
      await api.post('/api/lms/courses', {
        name: courseDraft.name.trim(),
        code: courseDraft.code.trim(),
        credits: Number(courseDraft.credits) || 3,
        instructor: courseDraft.instructor.trim() || null,
        // A teacher creating a course owns it: without this the course has no
        // instructorId, nobody can see its students in Analytics, and the
        // teacher who just made it cannot act on the risk data. Admins pick the
        // owner explicitly from the staff directory.
        instructorId:
          isAdmin && courseDraft.instructorId ? Number(courseDraft.instructorId) : isAdmin ? null : userId,
        color: courseDraft.color,
      })
      setCourseDraft({ name: '', code: '', credits: '3', instructor: '', instructorId: '', color: '#8b5cf6' })
      setShowCourseForm(false)
      onRefresh()
    } catch (err) {
      setCourseMsg(err instanceof Error ? err.message : 'Unable to create course.')
    }
  }

  async function assignInstructor(id: number, instructorId: string) {
    const picked = staff.find((s) => String(s.id) === instructorId)
    try {
      await api.patch(`/api/lms/courses/${id}/instructor`, {
        instructorId: instructorId === '' ? null : Number(instructorId),
        // Keep the display name aligned with the real owner.
        instructor: instructorId === '' ? null : (picked?.name ?? null),
      })
      onRefresh()
    } catch (err) {
      setCourseMsg(err instanceof Error ? err.message : 'Unable to assign instructor.')
    }
  }

  async function deleteCourse(id: number, code: string) {
    if (!window.confirm(`Delete course ${code}? This removes its quizzes, assignments and enrollments.`)) return
    try {
      await api.del(`/api/lms/courses/${id}`)
      if (courseId === id) setCourseId(null)
      onRefresh()
    } catch {
      /* drop */
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <TabNav tabs={facultyTabs} tab={ftab} setTab={setFtab} />

      {/* ── Dashboard ── */}
      {ftab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Courses', value: courses.length, icon: BookOpen, color: 'text-ice' },
              {
                label: 'Students',
                // Overall students, counted once each — not the sum of course
                // enrolments, which double-counts anyone taking several courses.
                value: stats ? stats.students : '—',
                icon: Users,
                color: 'text-emerald-soft',
              },
              {
                label: 'Assignments',
                value: assignments.length,
                icon: ClipboardList,
                color: 'text-amber-gentle',
              },
              {
                label: 'Classes held',
                value: courses.reduce((sum, c) => sum + (c.classCount ?? 0), 0),
                icon: CalendarCheck,
                color: 'text-violet-soft',
              },
            ].map((stat) => (
              <div key={stat.label} className="glass-ice rounded-lg p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted">{stat.label}</p>
                  <stat.icon size={15} className={stat.color} />
                </div>
                <p className="mt-2 font-display text-3xl font-bold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Take attendance', icon: UserCheck, action: () => setFtab('record') },
              { label: 'Enter marks', icon: ClipboardCheck, action: () => setFtab('record') },
              {
                label: 'New assignment',
                icon: FilePlus2,
                action: () => {
                  setShowAssignmentForm(true)
                  setFtab('assignments')
                },
              },
              {
                label: 'Create course',
                icon: PlusCircle,
                action: () => {
                  setShowCourseForm(true)
                  setFtab('courses')
                },
              },
            ].map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={q.action}
                className="glass-ice flex items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium text-ink transition hover:border-ice/30"
              >
                <q.icon size={15} className="text-ice" />
                {q.label}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <BookOpen size={14} className="text-ice" />
              <h2 className="text-sm font-semibold text-ink">My courses</h2>
            </div>
            {courses.length === 0 ? (
              <p className="rounded-lg border border-line p-4 text-sm text-muted">
                No courses yet — create your first one from the Courses tab.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {courses.map((c) => {
                  const count = assignments.filter((a) => a.courseId === c.id).length
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCourseId(c.id)
                        setFtab('students')
                      }}
                      className="glass-ice relative overflow-hidden rounded-lg p-4 text-left transition hover:border-ice/30"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-1"
                        style={{ background: c.color ?? '#8b5cf6' }}
                      />
                      <div className="pl-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[15px] font-semibold text-ink">{c.name}</p>
                            <p className="mt-0.5 font-mono text-xs text-muted">
                              {c.code} · {c.instructor ?? 'Faculty'}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                            {c.studentCount ?? 0} students
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                          <span>
                            <strong className="font-semibold text-ink">{c.classCount ?? 0}</strong>{' '}
                            classes held
                          </span>
                          <span>
                            <strong className="font-semibold text-ink">{count}</strong> assignments
                          </span>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Courses ── */}
      {ftab === 'courses' && (
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => setShowCourseForm((v) => !v)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
              showCourseForm
                ? 'border-ice/40 bg-ice/15 text-ice'
                : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
            )}
          >
            <PlusCircle size={13} /> {showCourseForm ? 'Close' : 'Create a course'}
          </button>

          {showCourseForm && (
            <div className="glass-ice max-w-md space-y-3 rounded-lg p-4">
              <p className="text-sm font-semibold text-ink">Create a course</p>
              <form onSubmit={createCourse} className="space-y-3">
                <input
                  value={courseDraft.name}
                  onChange={(e) => setCourseDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Course name"
                  className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                />
                <div className="flex gap-2">
                  <input
                    value={courseDraft.code}
                    onChange={(e) => setCourseDraft((d) => ({ ...d, code: e.target.value }))}
                    placeholder="Code (e.g. CS-201)"
                    className="w-40 rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={courseDraft.credits}
                    onChange={(e) => setCourseDraft((d) => ({ ...d, credits: e.target.value }))}
                    placeholder="Credits"
                    className="w-20 rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                </div>
                {isAdmin ? (
                  <select
                    value={courseDraft.instructorId}
                    onChange={(e) => {
                      const picked = staff.find((s) => String(s.id) === e.target.value)
                      setCourseDraft((d) => ({
                        ...d,
                        instructorId: e.target.value,
                        // Keep the display name in step with the real owner so the
                        // course list does not contradict the assignment.
                        instructor: picked ? picked.name : d.instructor,
                      }))
                    }}
                    className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  >
                    <option value="">No instructor assigned (no one can see its students)</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.role}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={courseDraft.instructor}
                    onChange={(e) => setCourseDraft((d) => ({ ...d, instructor: e.target.value }))}
                    placeholder="Instructor"
                    className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                )}
                <div className="flex items-center gap-2">
                  <label className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Color</label>
                  <input
                    type="color"
                    value={courseDraft.color}
                    onChange={(e) => setCourseDraft((d) => ({ ...d, color: e.target.value }))}
                    className="h-7 w-10 rounded border border-ice/10 bg-transparent"
                  />
                </div>
                {courseMsg && (
                  <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-400">
                    {courseMsg}
                  </p>
                )}
                <button type="submit" className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw hover:bg-ice-bright">
                  Create course
                </button>
              </form>
            </div>
          )}

          {/* The catalog is the point of this tab, so it stays visible; the
              create form above is just the optional way to add to it. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">All courses</p>
              <p className="text-xs text-muted">
                {courses.length} course{courses.length === 1 ? '' : 's'} ·{' '}
                {courses.reduce((sum, c) => sum + (c.studentCount ?? 0), 0)} enrolments
              </p>
            </div>
            {courses.length === 0 ? (
              <p className="rounded-lg border border-line p-4 text-sm text-muted">
                No courses yet — create your first one above.
              </p>
            ) : (
              courses.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-ice/10 tint-subtle px-3.5 py-3 text-sm"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color ?? '#8b5cf6' }} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-xs text-ice">{c.code}</span>{' '}
                    <span className="font-medium text-ink">{c.name}</span>{' '}
                    {c.instructorId == null ? (
                      // Unowned courses are invisible to every teacher, so the
                      // gap has to be visible here rather than silently empty.
                      <span className="ml-1 text-xs font-semibold text-amber-400">· unassigned</span>
                    ) : (
                      <span className="ml-1 text-xs text-muted">· {c.instructor ?? 'Faculty'} · {c.credits} cr</span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full border border-ice/15 bg-ice/[0.06] px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-ice/80 uppercase">
                    {c.studentCount ?? 0} students
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted">
                    <strong className="font-semibold text-ink">{c.classCount ?? 0}</strong> classes
                  </span>
                  {isAdmin && (
                    <select
                      value={c.instructorId == null ? '' : String(c.instructorId)}
                      onChange={(e) => assignInstructor(c.id, e.target.value)}
                      aria-label={`Assign instructor for ${c.code}`}
                      className="shrink-0 rounded-md border border-ice/10 bg-thaw px-2 py-1 text-[10px] text-ink outline-none focus:border-ice/30"
                    >
                      <option value="">Unassigned</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteCourse(c.id, c.code)}
                    aria-label={`Delete ${c.code}`}
                    className="shrink-0 rounded-md border border-rose-400/20 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:bg-rose-400/10"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Every tab below works against one course, so the picker stays put. */}
      {(ftab === 'students' || ftab === 'record' || ftab === 'assignments') && (
        <div className="relative max-w-md">
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="glass-ice flex w-full items-center justify-between rounded-lg p-4 text-left transition hover:border-ice/30"
          >
            <div>
              <p className="font-mono text-xs text-ice">{selected?.code ?? '—'}</p>
              <p className="mt-0.5 text-sm font-semibold text-ink">{selected?.name ?? 'Select a course'}</p>
            </div>
            <span className={clsx('text-muted', dropdownOpen && 'rotate-180')}>▾</span>
          </button>
          {dropdownOpen && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface-2 shadow-xl">
              {courses.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCourseId(c.id); setDropdownOpen(false) }}
                  className={clsx(
                    'flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-ice/10',
                    c.id === courseId && 'bg-ice/5',
                  )}
                >
                  <div>
                    <p className="font-medium text-ink">{c.code} — {c.name}</p>
                    <p className="text-xs text-muted">{c.credits} credits</p>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <span className="text-[11px] text-muted">{c.classCount ?? 0} classes</span>
                    {c.id === courseId && <CheckCircle2 size={14} className="text-ice" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Students: the read-only roster ── */}
      {ftab === 'students' && (
        <div className="space-y-4">
          <div className="overflow-x-auto border-y border-line">
            {busy ? (
              <p className="py-8 text-center text-sm text-muted">Loading students…</p>
            ) : (
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-3 pr-4 font-medium">Student</th>
                    <th className="px-3 py-3 font-medium">Attended</th>
                    <th className="px-3 py-3 font-medium">Attendance</th>
                    <th className="px-3 py-3 font-medium">IA-1 (out of 100)</th>
                    <th className="px-3 py-3 font-medium">IA-2 (out of 100)</th>
                    <th className="px-3 py-3 font-medium">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-sm text-muted">
                        No students enrolled in this course yet.
                      </td>
                    </tr>
                  )}
                  {students.map((s) => {
                    const scored = [s.ia1, s.ia2].filter((v): v is number => v != null)
                    const avg = scored.length
                      ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
                      : null
                    return (
                      <tr key={s.id} className="border-b border-line last:border-0 transition hover:bg-ice/5">
                        <td className="py-3 pr-4 font-medium text-ink">{s.user?.name ?? 'Student'}</td>
                        <td className="px-3 py-3 tabular-nums text-muted">
                          <span className="font-semibold text-ice">{s.classesAttended ?? 0}</span>
                          <span className="text-muted"> / </span>
                          <span>{s.classesTaken ?? 0}</span>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-muted">
                          {s.attendance != null ? `${s.attendance}%` : '—'}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-ink">{s.ia1 ?? '—'}</td>
                        <td className="px-3 py-3 tabular-nums text-ink">{s.ia2 ?? '—'}</td>
                        <td className="px-3 py-3 font-semibold tabular-nums text-ink">
                          {avg == null ? '—' : `${avg}%`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-muted">
            Read-only view — record attendance and IA scores in the{' '}
            <span className="text-ink">Attendance/Marks</span> tab.
          </p>
        </div>
      )}

      {/* ── Attendance / Marks: where a teacher records against the class ── */}
      {ftab === 'record' && (
        <>
          <div className="flex max-w-md flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <CalendarCheck size={13} className="text-ice" />
              Classes taken: <strong className="font-semibold tabular-nums text-ink">{selected?.classCount ?? 0}</strong>
            </span>
          </div>

          {selected && (
            <div className="glass-ice max-w-2xl space-y-4 rounded-lg p-4">
              <div>
                <p className="text-sm font-semibold text-ink">Attendance — {selected.code} · {selected.name}</p>
                <p className="mt-0.5 text-xs text-muted">{attendanceData?.sessions.length ?? 0} classes held · every class counts toward the attendance % shown to students</p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={attDate}
                  max={todayStr()}
                  onChange={(e) => e.target.value && setAttDate(e.target.value)}
                  className="rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                />
                <span className="text-xs text-muted">
                  {attendanceData?.sessions.find((s) => s.date === attDate)
                    ? 'Existing session — editing records'
                    : `${attendanceData?.enrollments.length ?? 0} student${(attendanceData?.enrollments.length ?? 1) === 1 ? '' : 's'} · mark below`}
                </span>
              </div>

              {attBusy ? (
                <p className="py-6 text-center text-sm text-muted">Loading…</p>
              ) : attendanceData && attendanceData.enrollments.length === 0 ? (
                <p className="rounded-lg border border-line px-4 py-5 text-center text-sm text-muted">
                  No students enrolled in this course yet.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setAttMap(Object.fromEntries((attendanceData?.enrollments ?? []).map((st) => [st.userId, true])))
                        }
                        className="rounded-md border border-ice/15 px-2 py-1 text-[11px] font-semibold text-ice/80 transition hover:border-ice/30 hover:text-ice"
                      >
                        All present
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAttMap(Object.fromEntries((attendanceData?.enrollments ?? []).map((st) => [st.userId, false])))
                        }
                        className="rounded-md border border-rose-400/15 px-2 py-1 text-[11px] font-semibold text-rose-400/70 transition hover:border-rose-400/30 hover:text-rose-400"
                      >
                        All absent
                      </button>
                    </div>
                    {attSaved && (
                      <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-soft">
                        <CheckCircle2 size={14} /> Attendance saved
                      </span>
                    )}
                  </div>

                  {attendanceData?.enrollments.map((st) => {
                    const present = attMap[st.userId] ?? true
                    return (
                      <div key={st.id} className="flex items-center gap-3 rounded-lg border border-ice/10 px-3 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ice/15 bg-ice/[0.06] text-[10px] font-semibold text-ice/60">
                          {st.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{st.name}</span>
                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAttMap((prev) => ({ ...prev, [st.userId]: true }))}
                            className={clsx(
                              'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                              present
                                ? 'border-emerald-soft/40 bg-emerald-soft/15 text-emerald-soft'
                                : 'border-ice/10 text-muted hover:border-emerald-soft/30 hover:text-emerald-soft',
                            )}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            onClick={() => setAttMap((prev) => ({ ...prev, [st.userId]: false }))}
                            className={clsx(
                              'rounded-md border px-2.5 py-1 text-[11px] font-semibold transition',
                              !present
                                ? 'border-rose-400/40 bg-rose-400/15 text-rose-400'
                                : 'border-ice/10 text-muted hover:border-rose-400/30 hover:text-rose-400',
                            )}
                          >
                            Absent
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  <button
                    type="button"
                    onClick={saveAttendance}
                    disabled={attBusy}
                    className="glow-cta mt-1 rounded-lg bg-ice px-4 py-2 text-sm font-semibold text-thaw hover:bg-ice-bright disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save attendance for {attDate}
                  </button>
                </div>
              )}

              {(attendanceData?.sessions.length ?? 0) > 0 && (
                <div className="space-y-1.5 border-t border-ice/10 pt-3">
                  <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Session history</p>
                  {attendanceData?.sessions.map((s) => {
                    const presentCount = s.records.filter((r) => r.present).length
                    return (
                      <div key={s.id} className="flex items-center gap-2 text-sm">
                        <button
                          type="button"
                          onClick={() => setAttDate(s.date)}
                          className={clsx(
                            'flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition hover:border-ice/30',
                            s.date === attDate ? 'border-ice/40 bg-ice/10' : 'border-ice/5',
                          )}
                        >
                          <span className="font-mono text-xs text-ice">{s.date}</span>
                          <span className="text-xs text-muted">
                            {presentCount}/{s.records.length} present
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSession(s.id)}
                          aria-label={`Delete session ${s.date}`}
                          className="shrink-0 rounded-md border border-rose-400/20 p-1.5 text-rose-400/70 transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-400"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <GraduationCap size={14} className="text-amber-gentle" />
            <h3 className="text-sm font-semibold text-ink">
              Marks{selected ? ` · ${selected.code}` : ''}
            </h3>
          </div>

          <div className="overflow-x-auto border-y border-line">
            {busy ? (
              <p className="py-8 text-center text-sm text-muted">Loading students…</p>
            ) : (
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-3 pr-4 font-medium">Student</th>
                    <th className="px-3 py-3 font-medium">Attended</th>
                    <th className="px-3 py-3 font-medium">IA-1 (out of 100)</th>
                    <th className="px-3 py-3 font-medium">IA-2 (out of 100)</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-muted">
                        No students enrolled in this course yet.
                      </td>
                    </tr>
                  )}
                  {students.map((student) => (
                    <tr key={student.id} className="border-b border-line last:border-0 transition hover:bg-ice/5">
                      <td className="py-3 pr-4 font-medium text-ink">{student.user?.name ?? 'Student'}</td>
                      <td className="px-3 py-3 tabular-nums text-muted">
                        <span className="font-semibold text-ice">{student.classesAttended ?? 0}</span>
                        <span className="text-muted"> / </span>
                        <span>{student.classesTaken ?? 0}</span>
                      </td>
                      {(['ia1', 'ia2'] as const).map((field) => (
                        <td key={field} className="px-3 py-3">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={marks[student.id]?.[field] ?? ''}
                            placeholder="—"
                            onChange={(e) => updateMark(student.id, field, e.target.value)}
                            className="w-16 border-b border-line bg-transparent py-1 text-center text-sm text-ink outline-none placeholder:text-muted/40 focus:border-ice tabular-nums"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="flex items-center justify-end gap-3">
            {saved && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-soft">
                <CheckCircle2 size={14} /> Grades saved
              </span>
            )}
            <button
              type="button"
              onClick={save}
              disabled={students.length === 0}
              className="glow-cta bg-ice px-4 py-2 text-sm font-semibold text-thaw hover:bg-ice-bright disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Grades
            </button>
          </div>
        </>
      )}

      {/* ── Assignments ── */}
      {ftab === 'assignments' && (
        <div className="space-y-6">
          {panelError && (
            <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-400">
              {panelError}
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowAssignmentForm((v) => !v)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
              showAssignmentForm
                ? 'border-ice/40 bg-ice/15 text-ice'
                : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
            )}
          >
            <FilePlus2 size={13} /> {showAssignmentForm ? 'Close' : 'New assignment'}
          </button>

          {showAssignmentForm && courseId !== null && (
            <CreateAssignmentForm
              courseId={courseId}
              onCancel={() => setShowAssignmentForm(false)}
              onCreated={() => {
                setShowAssignmentForm(false)
                void onRefresh()
              }}
            />
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ClipboardList size={14} className="text-amber-gentle" />
              <h3 className="text-sm font-semibold text-ink">
                Assignments{selected ? ` · ${selected.code}` : ''}
              </h3>
            </div>
            <FacultyAssignments
              assignments={courseAssignments}
              onManage={setManaging}
              onDelete={deleteAssignment}
              onError={setPanelError}
              busyId={deletingId}
            />
          </div>

          {managing && (
            <SubmissionsPanel
              assignmentId={managing.id}
              onClose={() => setManaging(null)}
              onError={setPanelError}
            />
          )}
        </div>
      )}
    </div>
  )
}