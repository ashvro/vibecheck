import { useEffect, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  FileText,
  Upload,
  Download,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Users,
  Trash2,
  X,
  Eye,
} from 'lucide-react'
import { api } from '../../lib/api'
import { openPdf, savePdf, formatBytes } from '../../lib/files'
import { sortAssignments } from '../../lib/assignments'

type Submission = {
  id: number
  assignmentId: number | null
  hasFile: boolean
  fileName: string | null
  fileSize: number | null
  notes: string | null
  score: number | null
  feedback: string | null
  graded: boolean
  submittedAt: string
  userId?: number
  user?: { id: number; name: string; email: string }
}

export type Assignment = {
  id: number
  courseId: number
  title: string
  due: string | null
  daysLeft?: number | null
  instructions?: string | null
  hasPdf: boolean
  pdfName: string | null
  pdfSize: number | null
  submitted?: boolean
  submission?: Submission | null
  submissionCount?: number
  course: { id: number; code: string; name: string; color: string | null } | null
}

const MAX_PDF_MB = 20

function dueTone(daysLeft: number | null | undefined, due: string | null) {
  if (!due) return { label: 'No due date', className: 'border-ice/15 text-muted' }
  if (daysLeft == null) return { label: due, className: 'border-ice/15 text-muted' }
  if (daysLeft === 0) return { label: 'Due today', className: 'border-amber-gentle/40 bg-amber-gentle/10 text-amber-gentle' }
  if (daysLeft < 0) return { label: 'Past due', className: 'border-rose-400/40 bg-rose-500/10 text-rose-400' }
  if (daysLeft <= 3) return { label: `${daysLeft}d left`, className: 'border-amber-gentle/40 bg-amber-gentle/10 text-amber-gentle' }
  return { label: `${daysLeft}d left`, className: 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft' }
}

function formatStamp(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/* ─────────────────────── shared bits ─────────────────────── */

function PdfButton({
  url,
  name,
  size,
  onError,
}: {
  url: string
  name: string | null
  size?: number | null
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState<'open' | 'save' | null>(null)

  async function run(kind: 'open' | 'save') {
    setBusy(kind)
    try {
      if (kind === 'open') await openPdf(url)
      else await savePdf(url, name ?? 'document.pdf')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not open the file.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => run('open')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-md border border-ice/20 bg-ice/10 px-2.5 py-1.5 text-[12px] font-medium text-ice transition hover:border-ice/40 hover:bg-ice/20 disabled:opacity-50"
      >
        {busy === 'open' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
        Open PDF
      </button>
      <button
        type="button"
        onClick={() => run('save')}
        disabled={busy !== null}
        className="inline-flex items-center gap-1.5 rounded-md border border-ice/15 px-2.5 py-1.5 text-[12px] text-muted transition hover:border-ice/30 hover:text-ice disabled:opacity-50"
      >
        {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
        Download
      </button>
      <span className="min-w-0 truncate font-mono text-[10px] text-muted/80">
        {name ?? 'document.pdf'}
        {size ? ` · ${formatBytes(size)}` : ''}
      </span>
    </div>
  )
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-400">
      <AlertCircle size={12} className="mt-0.5 shrink-0" />
      {message}
    </p>
  )
}

function FilePicker({
  file,
  onPick,
  id,
  label = 'Choose PDF',
  hint,
}: {
  file: File | null
  onPick: (f: File | null) => void
  id: string
  label?: string
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ice/20 bg-ice/10 px-2.5 py-1.5 text-[12px] font-medium text-ice transition hover:border-ice/40 hover:bg-ice/20"
        >
          <Upload size={13} />
          {label}
        </button>
        {file ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[10px] text-muted">
              {file.name} · {formatBytes(file.size)}
            </span>
            <button
              type="button"
              onClick={() => onPick(null)}
              aria-label="Remove selected file"
              className="shrink-0 rounded p-0.5 text-muted transition hover:text-rose-400"
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <span className="truncate font-mono text-[10px] text-muted/60">{hint ?? 'PDF only'}</span>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────── student ─────────────────────── */

export function StudentAssignments({
  assignments,
  onChanged,
}: {
  assignments: Assignment[]
  onChanged: (a: Assignment) => void
}) {
  const [submitting, setSubmitting] = useState<Assignment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sorted = sortAssignments(assignments)

  return (
    <>
      <div className="space-y-3">
        <FieldError message={error} />
        {sorted.length === 0 && (
          <p className="rounded-lg border border-line p-4 text-sm text-muted">
            No assignments yet — your faculty has not posted any.
          </p>
        )}
        {sorted.map((a) => (
          <StudentAssignmentCard
            key={a.id}
            assignment={a}
            onSubmit={() => {
              setError(null)
              setSubmitting(a)
            }}
            onError={setError}
          />
        ))}
      </div>

      {submitting && (
        <SubmitDialog
          assignment={submitting}
          onClose={() => setSubmitting(null)}
          onDone={onChanged}
        />
      )}
    </>
  )
}

function StudentAssignmentCard({
  assignment,
  onSubmit,
  onError,
}: {
  assignment: Assignment
  onSubmit: () => void
  onError: (m: string) => void
}) {
  const due = dueTone(assignment.daysLeft, assignment.due)
  const sub = assignment.submission ?? null

  return (
    <div className="glass-ice rounded-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.12em] text-ice uppercase">
            {assignment.course?.code ?? 'Course'}
          </p>
          <h3 className="mt-0.5 text-[15px] leading-snug font-semibold text-ink">{assignment.title}</h3>
          {assignment.course?.name && (
            <p className="mt-0.5 text-xs text-muted">{assignment.course.name}</p>
          )}
        </div>
        <span
          className={clsx(
            'shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase',
            due.className,
          )}
        >
          {due.label}
        </span>
      </div>

      {assignment.instructions && (
        <p className="mt-3 rounded-md border border-line/70 bg-thaw/40 px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-muted">
          {assignment.instructions}
        </p>
      )}

      <div className="mt-3 rounded-md border border-line/70 bg-thaw/30 p-3">
        <p className="mb-2 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">Assignment brief</p>
        {assignment.hasPdf ? (
          <PdfButton
            url={`/api/lms/assignments/${assignment.id}/pdf`}
            name={assignment.pdfName}
            size={assignment.pdfSize}
            onError={onError}
          />
        ) : (
          <p className="text-[12px] text-muted italic">No PDF attached — ask your faculty for the brief.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-[12px]">
          {sub ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-emerald-soft/30 bg-emerald-soft/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-emerald-soft uppercase">
                <CheckCircle2 size={11} />
                Submitted
              </span>
              <span className="text-muted">{formatStamp(sub.submittedAt)}</span>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded border border-amber-gentle/40 bg-amber-gentle/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-amber-gentle uppercase">
              <Clock size={11} />
              Not submitted
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onSubmit}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet-deep/25 px-3 py-1.5 text-[12px] font-medium text-violet-soft transition hover:bg-violet/30"
        >
          <Send size={13} />
          {sub ? 'Resubmit' : 'Submit assignment'}
        </button>
      </div>

      {sub && (
        <div className="mt-3 space-y-2 rounded-md border border-line/70 bg-thaw/30 p-3">
          <p className="font-mono text-[10px] tracking-[0.12em] text-muted uppercase">Your submission</p>
          {sub.notes && (
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-muted">{sub.notes}</p>
          )}
          {sub.hasFile && (
            <PdfButton
              url={`/api/lms/submissions/${sub.id}/file`}
              name={sub.fileName}
              size={sub.fileSize}
              onError={onError}
            />
          )}
          {sub.graded && (
            <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-2">
              <span className="rounded border border-ice/25 bg-ice/10 px-2 py-0.5 font-mono text-[11px] text-ice">
                Score: {sub.score ?? '—'}
              </span>
              {sub.feedback && <span className="text-[12px] text-muted italic">“{sub.feedback}”</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SubmitDialog({
  assignment,
  onClose,
  onDone,
}: {
  assignment: Assignment
  onClose: () => void
  onDone: (a: Assignment) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState(assignment.submission?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file && !notes.trim()) {
      setError('Attach a PDF or write a note before submitting.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      if (file) form.append('file', file)
      if (notes.trim()) form.append('notes', notes.trim())
      // The server returns the created (or updated) submission. Use it rather
      // than fabricating a row: a made-up id would break every later action
      // that addresses the submission by id, e.g. re-uploading an amendment or
      // the student's own download link.
      const saved = await api.upload<Submission>(`/api/lms/assignments/${assignment.id}/submit`, form)
      onDone({
        ...assignment,
        submitted: true,
        submission: { ...saved, notes: notes.trim() || null },
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-thaw-deep/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Submit ${assignment.title}`}
    >
      <form
        onSubmit={submit}
        className="glass w-full max-w-md space-y-4 rounded-xl border border-ice/15 p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.12em] text-ice uppercase">
              {assignment.course?.code ?? 'Course'}
            </p>
            <h3 className="mt-0.5 text-base font-semibold text-ink">{assignment.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted transition hover:text-ice"
          >
            <X size={16} />
          </button>
        </div>

        {assignment.hasPdf && (
          <p className="rounded-md border border-line/70 bg-thaw/40 px-3 py-2 text-[12px] text-muted">
            Check the brief before you submit:{' '}
            <button
              type="button"
              onClick={() =>
                openPdf(`/api/lms/assignments/${assignment.id}/pdf`).catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : 'Could not open the brief.'),
                )
              }
              className="font-medium text-ice underline underline-offset-2"
            >
              open the assignment PDF
            </button>
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="submit-file" className="text-[12px] font-medium text-ink">
            Your answer (PDF)
          </label>
          <FilePicker
            id="submit-file"
            file={file}
            onPick={(f) => {
              if (f && (!/\.pdf$/i.test(f.name) || f.type !== 'application/pdf')) {
                setError('Only PDF files are allowed.')
                setFile(null)
                return
              }
              setError(null)
              setFile(f)
            }}
            hint={`PDF only, up to ${MAX_PDF_MB} MB`}
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="submit-notes" className="text-[12px] font-medium text-ink">
            Note for your teacher <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id="submit-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to flag before grading…"
            className="w-full resize-none rounded-md border border-ice/15 bg-thaw px-3 py-2 text-[13px] text-ice outline-none transition placeholder:text-muted/60 focus:border-ice/35"
          />
        </div>

        <FieldError message={error} />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-ice/15 px-3 py-1.5 text-[12px] text-muted transition hover:text-ice"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet-deep/30 px-3 py-1.5 text-[12px] font-medium text-violet-soft transition hover:bg-violet/35 disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {assignment.submission ? 'Resubmit' : 'Submit'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ─────────────────────── faculty ─────────────────────── */

export function FacultyAssignments({
  assignments,
  onManage,
  onDelete,
  onError,
  busyId,
}: {
  assignments: Assignment[]
  onManage: (a: Assignment) => void
  onDelete: (a: Assignment) => void
  onError: (m: string) => void
  busyId: number | null
}) {
  if (assignments.length === 0) {
    return (
      <p className="rounded-lg border border-line p-4 text-sm text-muted">
        No assignments for this course yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {assignments.map((a) => {
        const due = dueTone(a.daysLeft, a.due)
        return (
          <div key={a.id} className="glass-ice rounded-lg p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-[14px] leading-snug font-semibold text-ink">{a.title}</h4>
                <p className="mt-0.5 text-[11px] text-muted">
                  {a.due ? `Due ${a.due}` : 'No due date'}
                  {a.hasPdf ? ` · brief: ${a.pdfName}` : ' · no PDF attached'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={clsx(
                    'rounded border px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase',
                    due.className,
                  )}
                >
                  {due.label}
                </span>
                <button
                  type="button"
                  onClick={() => onManage(a)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-ice/20 bg-ice/10 px-2.5 py-1.5 text-[12px] font-medium text-ice transition hover:bg-ice/20"
                >
                  <Users size={13} />
                  Submissions
                  <span className="font-mono text-[10px] opacity-80">({a.submissionCount ?? 0})</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === a.id}
                  onClick={() => onDelete(a)}
                  title="Delete assignment"
                  aria-label={`Delete ${a.title}`}
                  className="rounded-md border border-ice/15 p-1.5 text-muted transition hover:border-rose-400/40 hover:text-rose-400 disabled:opacity-50"
                >
                  {busyId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>

            {a.instructions && (
              <p className="mt-2 text-[12px] leading-relaxed text-muted">{a.instructions}</p>
            )}

            {a.hasPdf && (
              <div className="mt-2">
                <PdfButton
                  url={`/api/lms/assignments/${a.id}/pdf`}
                  name={a.pdfName}
                  size={a.pdfSize}
                  onError={onError}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function CreateAssignmentForm({
  courseId,
  onCreated,
  onCancel,
}: {
  courseId: number
  onCreated: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [instructions, setInstructions] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('Give the assignment a title.')
      return
    }
    if (file && (!/\.pdf$/i.test(file.name) || file.type !== 'application/pdf')) {
      setError('Only PDF files are allowed.')
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('courseId', String(courseId))
      form.append('title', title.trim())
      if (due) form.append('due', due)
      if (instructions.trim()) form.append('instructions', instructions.trim())
      if (file) form.append('file', file)
      await api.upload('/api/lms/assignments', form)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the assignment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="glass-ice max-w-md space-y-3 rounded-lg border border-ice/15 p-4"
    >
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-ice" />
        <h3 className="text-sm font-semibold text-ink">New assignment</h3>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Assignment title"
        className="w-full rounded-md border border-ice/15 bg-thaw px-3 py-2 text-[13px] text-ice outline-none transition placeholder:text-muted/60 focus:border-ice/35"
      />

      <input
        type="date"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        className="w-full rounded-md border border-ice/15 bg-thaw px-3 py-2 text-[13px] text-ice outline-none transition focus:border-ice/35"
      />

      <textarea
        rows={2}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Instructions shown to students (optional)"
        className="w-full resize-none rounded-md border border-ice/15 bg-thaw px-3 py-2 text-[13px] text-ice outline-none transition placeholder:text-muted/60 focus:border-ice/35"
      />

      <FilePicker
        id="create-assignment-file"
        file={file}
        onPick={(f) => {
          if (f && (!/\.pdf$/i.test(f.name) || f.type !== 'application/pdf')) {
            setError('Only PDF files are allowed.')
            setFile(null)
            return
          }
          setError(null)
          setFile(f)
        }}
        label="Attach brief (PDF)"
        hint={`Optional · PDF only, up to ${MAX_PDF_MB} MB`}
      />

      <FieldError message={error} />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-ice/15 px-3 py-1.5 text-[12px] text-muted transition hover:text-ice"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md border border-violet/40 bg-violet-deep/30 px-3 py-1.5 text-[12px] font-medium text-violet-soft transition hover:bg-violet/35 disabled:opacity-50"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          Create assignment
        </button>
      </div>
    </form>
  )
}

export function SubmissionsPanel({
  assignmentId,
  onClose,
  onError,
}: {
  assignmentId: number
  onClose: () => void
  onError: (m: string) => void
}) {
  const [data, setData] = useState<{
    assignment: Assignment
    submissions: Submission[]
    roster: { userId: number; user: { id: number; name: string; email: string }; submitted: boolean }[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<number, { score: string; feedback: string }>>({})
  const [savingId, setSavingId] = useState<number | null>(null)

  function apply(next: typeof data) {
    if (!next) return
    setData(next)
    setDrafts(
      Object.fromEntries(
        next.submissions.map((s) => [
          s.id,
          { score: s.score == null ? '' : String(s.score), feedback: s.feedback ?? '' },
        ]),
      ),
    )
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    api
      .get<{
        assignment: Assignment
        submissions: Submission[]
        roster: { userId: number; user: { id: number; name: string; email: string }; submitted: boolean }[]
      }>(`/api/lms/assignments/${assignmentId}/submissions`)
      .then((next) => {
        if (cancelled) return
        apply(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load submissions.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId])

  async function saveGrade(submission: Submission) {
    const draft = drafts[submission.id]
    if (!draft) return
    setSavingId(submission.id)
    setLoadError(null)
    try {
      const body: { score: number | null; feedback: string } = {
        score: draft.score.trim() === '' ? null : Number(draft.score),
        feedback: draft.feedback,
      }
      const updated = await api.patch<Submission>(`/api/lms/submissions/${submission.id}`, body)
      if (data) {
        apply({
          ...data,
          submissions: data.submissions.map((s) => (s.id === submission.id ? { ...s, ...updated } : s)),
        })
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not save the grade.')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-thaw-deep/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Submissions"
    >
      <div className="glass flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-ice/15">
        <div className="flex items-start justify-between gap-3 border-b border-ice/10 p-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.12em] text-ice uppercase">Submissions</p>
            <h3 className="mt-0.5 truncate text-base font-semibold text-ink">
              {data?.assignment.title ?? 'Loading…'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted transition hover:text-ice"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <FieldError message={loadError} />

          {loading && <p className="py-6 text-center text-sm text-muted">Loading submissions…</p>}

          {!loading && data && data.submissions.length === 0 && (
            <p className="rounded-lg border border-line p-4 text-sm text-muted">
              Nothing submitted yet.
            </p>
          )}

          {data?.submissions.map((s) => (
            <div key={s.id} className="glass-ice rounded-lg p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink">{s.user?.name ?? 'Student'}</p>
                  <p className="truncate text-[11px] text-muted">
                    {s.user?.email} · {formatStamp(s.submittedAt)}
                  </p>
                </div>
                {s.graded && (
                  <span className="shrink-0 rounded border border-emerald-soft/30 bg-emerald-soft/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-emerald-soft uppercase">
                    Graded
                  </span>
                )}
              </div>

              {s.notes && (
                <p className="mt-2 rounded-md border border-line/60 bg-thaw/40 px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-muted">
                  {s.notes}
                </p>
              )}

              {s.hasFile && (
                <div className="mt-2">
                  <PdfButton
                    url={`/api/lms/submissions/${s.id}/file`}
                    name={s.fileName}
                    size={s.fileSize}
                    onError={onError}
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block font-mono text-[10px] tracking-wider text-muted uppercase">
                    Score / 100
                  </span>
                  <input
                    inputMode="numeric"
                    value={drafts[s.id]?.score ?? ''}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], score: e.target.value } }))
                    }
                    placeholder="—"
                    className="w-24 rounded-md border border-ice/15 bg-thaw px-2.5 py-1.5 text-[13px] text-ice outline-none transition placeholder:text-muted/60 focus:border-ice/35"
                  />
                </label>
                <label className="min-w-[12rem] flex-1">
                  <span className="mb-1 block font-mono text-[10px] tracking-wider text-muted uppercase">
                    Feedback
                  </span>
                  <input
                    value={drafts[s.id]?.feedback ?? ''}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], feedback: e.target.value } }))
                    }
                    placeholder="Optional note for the student"
                    className="w-full rounded-md border border-ice/15 bg-thaw px-2.5 py-1.5 text-[13px] text-ice outline-none transition placeholder:text-muted/60 focus:border-ice/35"
                  />
                </label>
                <button
                  type="button"
                  disabled={savingId === s.id}
                  onClick={() => saveGrade(s)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-ice/20 bg-ice/10 px-2.5 py-1.5 text-[12px] font-medium text-ice transition hover:bg-ice/20 disabled:opacity-50"
                >
                  {savingId === s.id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Save
                </button>
              </div>
            </div>
          ))}

          {data && data.roster.length > 0 && (
            <div className="rounded-lg border border-line p-3">
              <p className="mb-2 font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                Enrolled roster
              </p>
              <div className="space-y-1">
                {data.roster.map((r) => (
                  <div key={r.userId} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-muted">{r.user.name}</span>
                    <span
                      className={clsx(
                        'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase',
                        r.submitted
                          ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft'
                          : 'border-amber-gentle/40 bg-amber-gentle/10 text-amber-gentle',
                      )}
                    >
                      {r.submitted ? 'submitted' : 'pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
