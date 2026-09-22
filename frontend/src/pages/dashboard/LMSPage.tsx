import { useEffect, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { BookOpen, GraduationCap, LayoutDashboard, CheckCircle2, PlusCircle, UserCheck, FilePlus2, CalendarPlus, CalendarCheck, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'

type LmsTab = 'dashboard' | 'courses' | 'grades'
type RoleView = 'student' | 'faculty'

type Course = {
  id: number
  name: string
  code: string
  credits: number
  instructor: string | null
  color: string | null
  classCount: number
  quizzes: QuizLike[]
  assignments: { id: number; title: string; due: string | null }[]
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

type Assignment = {
  id: number
  title: string
  due: string | null
  submitted?: boolean
  course: { code: string } | null
}

const lmsTabs: { id: LmsTab; label: string; icon: typeof BookOpen }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'courses', label: 'Courses', icon: BookOpen },
  { id: 'grades', label: 'Grades', icon: GraduationCap },
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
  const [role, setRole] = useState<RoleView>('student')
  const [tab, setTab] = useState<LmsTab>('dashboard')
  const [courses, setCourses] = useState<Course[]>([])
  const [enrolled, setEnrolled] = useState<Enrollment[]>([])
  const [quizzes, setQuizzes] = useState<QuizLike[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  const isStaff = userRole === 'teacher' || userRole === 'admin'

  useEffect(() => {
    api.get<{ role: string }>('/api/auth/me').then((me) => {
      setUserRole(me.role)
      if (me.role === 'teacher' || me.role === 'admin') setRole('faculty')
    }).catch(() => setUserRole('student'))
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <BookOpen size={12} />
            <span className="font-mono tracking-[0.12em] uppercase">LMS Portal</span>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {role === 'student' ? 'Learning Dashboard' : 'Faculty Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {role === 'student'
              ? 'Courses, attendance, and grades'
              : 'Manage attendance and internal assessment marks'}
          </p>
        </div>
        {isStaff && (
        <div className="flex gap-5">
          {(
            [
              { id: 'student', label: 'Student' },
              { id: 'faculty', label: 'Faculty' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setRole(t.id); setTab('dashboard') }}
              className={clsx(
                'relative pb-1 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase transition',
                role === t.id ? 'text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {t.label}
              {role === t.id && <span className="absolute inset-x-0 bottom-0 h-px bg-ice" />}
            </button>
          ))}
        </div>
      )}
      </div>

      {role === 'student' && (
        <>
          <TabNav tab={tab} setTab={setTab} />
          {loading ? (
            <p className="py-10 text-center text-sm text-muted">Loading…</p>
          ) : (
            <>
              {tab === 'dashboard' && (
                <StudentDashboard courses={courses} enrolled={enrolled} quizzes={quizzes} assignments={assignments} />
              )}
              {tab === 'courses' && <StudentCourses courses={courses} enrolled={enrolled} toggleEnroll={toggleEnroll} />}
              {tab === 'grades' && <StudentGrades enrolled={enrolled} />}
            </>
          )}
        </>
      )}

      {role === 'faculty' && <FacultyView courses={courses} onRefresh={loadAll} />}
    </div>
  )
}

function TabNav({ tab, setTab }: { tab: LmsTab; setTab: (t: LmsTab) => void }) {
  return (
    <div className="flex gap-1 border-b border-line">
      {lmsTabs.map((t) => {
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

/* ─── Dashboard ─── */
function StudentDashboard({
  courses,
  enrolled,
  quizzes,
  assignments,
}: {
  courses: Course[]
  enrolled: Enrollment[]
  quizzes: QuizLike[]
  assignments: Assignment[]
}) {
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
            <div className="mb-3 flex items-center gap-2">
              <BookOpen size={14} className="text-amber-gentle" />
              <h2 className="text-sm font-semibold text-ink">Assignments</h2>
            </div>
            <div className="space-y-2">
              {assignments.length === 0 && (
                <p className="rounded-lg border border-line p-3 text-sm text-muted">No assignments yet.</p>
              )}
              {assignments.map((a) => (
                <div key={a.id} className="glass-ice flex items-center justify-between rounded-lg p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] text-ice">{a.course?.code ?? 'Course'}</p>
                    <p className="truncate text-sm font-medium text-ink">{a.title}</p>
                    <p className="text-xs text-muted">{a.due ? `Due ${a.due}` : 'No due date'}</p>
                  </div>
                  <span className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase" style={{
                    background: a.submitted ? 'rgba(157, 184, 168, 0.2)' : 'rgba(217, 119, 6, 0.2)',
                    color: a.submitted ? '#9db8a8' : '#d97706',
                  }}>
                    {a.submitted ? 'submitted' : 'pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-ice" />
              <h2 className="text-sm font-semibold text-ink">Upcoming Quizzes</h2>
            </div>
            <div className="space-y-2">
              {quizzes.length === 0 && (
                <p className="rounded-lg border border-line p-3 text-sm text-muted">No quizzes scheduled.</p>
              )}
              {quizzes.map((q) => (
                <div key={q.id} className="glass-ice flex items-center justify-between rounded-lg p-3 text-sm">
                  <div>
                    <p className="font-mono text-[10px] text-ice">{q.title}</p>
                    <p className="text-sm font-medium text-ink">
                      {courses.find((c) => c.quizzes.some((x) => x.id === q.id))?.code ?? 'Course'}
                    </p>
                  </div>
                  <p className="shrink-0 text-xs text-muted">{q.date}</p>
                </div>
              ))}
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
function FacultyView({ courses, onRefresh }: { courses: Course[]; onRefresh: () => void }) {
  const [courseId, setCourseId] = useState<number | null>(null)
  const [students, setStudents] = useState<Enrollment[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [marks, setMarks] = useState<Record<number, { ia1: string; ia2: string }>>({})
  const [showQuizForm, setShowQuizForm] = useState(false)
  const [showAssignmentForm, setShowAssignmentForm] = useState(false)
  const [quizDraft, setQuizDraft] = useState({ title: '', date: '' })
  const [assignmentDraft, setAssignmentDraft] = useState({ title: '', due: '' })
  const [showCourseForm, setShowCourseForm] = useState(false)
  const [courseDraft, setCourseDraft] = useState({ name: '', code: '', credits: '3', instructor: '', color: '#8b5cf6' })
  const [courseMsg, setCourseMsg] = useState('')
  const [showAttendance, setShowAttendance] = useState(false)
  const [attendanceData, setAttendanceData] = useState<{ sessions: AttendanceSession[]; enrollments: AttendanceStudent[] } | null>(null)
  const [attDate, setAttDate] = useState(todayStr())
  const [attMap, setAttMap] = useState<Record<number, boolean>>({})
  const [attBusy, setAttBusy] = useState(false)
  const [attSaved, setAttSaved] = useState(false)

  const selected = courses.find((c) => c.id === courseId) ?? null

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
    if (showAttendance && courseId !== null) {
      setAttDate(todayStr())
      loadAttendance()
    }
  }, [showAttendance, courseId])

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

  async function createQuiz(e: FormEvent) {
    e.preventDefault()
    if (!courseId || !quizDraft.title.trim()) return
    try {
      await api.post('/api/lms/quizzes', {
        courseId,
        title: quizDraft.title.trim(),
        date: quizDraft.date || null,
      })
      setQuizDraft({ title: '', date: '' })
      setShowQuizForm(false)
      onRefresh()
    } catch {
      /* drop */
    }
  }

  async function createAssignment(e: FormEvent) {
    e.preventDefault()
    if (!courseId || !assignmentDraft.title.trim()) return
    try {
      await api.post('/api/lms/assignments', {
        courseId,
        title: assignmentDraft.title.trim(),
        due: assignmentDraft.due || null,
      })
      setAssignmentDraft({ title: '', due: '' })
      setShowAssignmentForm(false)
      onRefresh()
    } catch {
      /* drop */
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
        color: courseDraft.color,
      })
      setCourseDraft({ name: '', code: '', credits: '3', instructor: '', color: '#8b5cf6' })
      setShowCourseForm(false)
      onRefresh()
    } catch (err) {
      setCourseMsg(err instanceof Error ? err.message : 'Unable to create course.')
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setShowQuizForm((v) => !v); setShowAssignmentForm(false) }}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
            showQuizForm
              ? 'border-ice/40 bg-ice/15 text-ice'
              : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
          )}
        >
          <CalendarPlus size={13} /> New quiz
        </button>
        <button
          type="button"
          onClick={() => { setShowAssignmentForm((v) => !v); setShowQuizForm(false) }}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
            showAssignmentForm
              ? 'border-ice/40 bg-ice/15 text-ice'
              : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
          )}
        >
          <FilePlus2 size={13} /> New assignment
        </button>
        <button
          type="button"
          onClick={() => { setShowCourseForm((v) => !v); setShowQuizForm(false); setShowAssignmentForm(false) }}
          className={clsx(
            'ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
            showCourseForm
              ? 'border-ice/40 bg-ice/15 text-ice'
              : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
          )}
        >
          <PlusCircle size={13} /> Manage courses
        </button>
      </div>

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
            <input
              value={courseDraft.instructor}
              onChange={(e) => setCourseDraft((d) => ({ ...d, instructor: e.target.value }))}
              placeholder="Instructor"
              className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
            />
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

          <div className="space-y-2 border-t border-ice/10 pt-3">
            <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Course catalog</p>
            {courses.map((c) => (
              <div key={c.id} className="flex items-center gap-2 rounded-lg border border-ice/10 px-3 py-2 text-sm">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color ?? '#8b5cf6' }} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-xs text-ice">{c.code}</span>{" "}
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="ml-1 text-xs text-muted">· {c.instructor ?? 'Faculty'} · {c.credits} cr</span>
                </span>
                <button
                  type="button"
                  onClick={() => deleteCourse(c.id, c.code)}
                  aria-label={`Delete ${c.code}`}
                  className="shrink-0 rounded-md border border-rose-400/20 px-2 py-1 text-[10px] font-semibold text-rose-400 transition hover:bg-rose-400/10"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showQuizForm && (
        <form onSubmit={createQuiz} className="glass-ice max-w-md space-y-3 rounded-lg p-4">
          <p className="text-sm font-semibold text-ink">Schedule a quiz</p>
          <input
            value={quizDraft.title}
            onChange={(e) => setQuizDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Quiz title"
            className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
          />
          <input
            type="date"
            value={quizDraft.date}
            onChange={(e) => setQuizDraft((d) => ({ ...d, date: e.target.value }))}
            className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
          />
          <button type="submit" className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw hover:bg-ice-bright">
            Schedule quiz
          </button>
        </form>
      )}

      {showAssignmentForm && (
        <form onSubmit={createAssignment} className="glass-ice max-w-md space-y-3 rounded-lg p-4">
          <p className="text-sm font-semibold text-ink">Add an assignment</p>
          <input
            value={assignmentDraft.title}
            onChange={(e) => setAssignmentDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="Assignment title"
            className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
          />
          <input
            type="date"
            value={assignmentDraft.due}
            onChange={(e) => setAssignmentDraft((d) => ({ ...d, due: e.target.value }))}
            className="w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
          />
          <button type="submit" className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw hover:bg-ice-bright">
            Add assignment
          </button>
        </form>
      )}

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

      <div className="flex max-w-md flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarCheck size={13} className="text-ice" />
          Classes taken: <strong className="font-semibold tabular-nums text-ink">{selected?.classCount ?? 0}</strong>
        </span>
        <button
          type="button"
          onClick={() => setShowAttendance((v) => !v)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
            showAttendance
              ? 'border-ice/40 bg-ice/15 text-ice'
              : 'border-ice/15 bg-ice/[0.05] text-ice/80 hover:border-ice/30',
          )}
        >
          <UserCheck size={13} /> {showAttendance ? 'Close' : 'Take attendance'}
        </button>
      </div>

      {showAttendance && selected && (
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
    </div>
  )
}