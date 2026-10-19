import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  ImagePlus,
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  X,
} from 'lucide-react'
import { PageHeader } from '../../components/PageHeader'
import { generatePlan, type StudyPlan } from '../../lib/studyPlanner'

const MAX_FILES = 10
/** Groq caps vision requests at 4 MB of base64 — keep each photo well under. */
const MAX_IMAGE_BYTES = 700 * 1024

const INPUT =
  'w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20'

type Pick = { id: string; file: File; preview?: string }

function todayISO() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prettyDate(iso?: string) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Re-encodes oversized photos so they fit Groq's vision payload limits. */
async function compressImage(file: File): Promise<File> {
  if (file.size <= MAX_IMAGE_BYTES) return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  let quality = 0.82
  let blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  while (blob && blob.size > MAX_IMAGE_BYTES && quality > 0.45) {
    quality -= 0.12
    blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality))
  }
  if (!blob) return file
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
}

function StatChip({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="glass-ice rounded-xl px-3.5 py-3">
      <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-muted">{unit}</span>}
      </p>
    </div>
  )
}

function PlanEntryCard({ entry, index }: { entry: StudyPlan['entries'][number]; index: number }) {
  const date = prettyDate(entry.date)
  return (
    <article className="glass-ice animate-fade-in rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-ice/20 bg-ice/[0.07] px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.1em] text-ice uppercase">
          {entry.label}
        </span>
        {date && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted">
            <CalendarDays className="h-3 w-3" />
            {date}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-violet/25 bg-violet/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-violet-200">
          <Clock className="h-3 w-3" />
          {entry.hours}h
        </span>
      </div>

      {entry.focus && <p className="mt-2 text-sm font-semibold text-ink">{entry.focus}</p>}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
            <ListChecks className="h-3 w-3" /> Topics
          </p>
          <ul className="mt-1.5 space-y-1">
            {entry.topics.length === 0 && <li className="text-xs text-muted">—</li>}
            {entry.topics.map((t, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink/85">
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ice/50" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
            <Target className="h-3 w-3" /> Important questions
          </p>
          <ol className="mt-1.5 space-y-1.5">
            {entry.importantQuestions.length === 0 && <li className="text-xs text-muted">—</li>}
            {entry.importantQuestions.map((q, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink/85">
                <span className="mt-px font-mono text-[10px] text-ice/60">{String(i + 1).padStart(2, '0')}</span>
                {q}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {entry.tip && (
        <p className="mt-3 flex gap-1.5 border-t border-ice/10 pt-3 text-xs leading-relaxed text-muted">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-200/70" />
          {entry.tip}
        </p>
      )}
      <span className="sr-only">Entry {index + 1}</span>
    </article>
  )
}

export function StudyPlannerPage() {
  const [subject, setSubject] = useState('')
  const [examDate, setExamDate] = useState('')
  const [picks, setPicks] = useState<Pick[]>([])
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const today = useMemo(todayISO, [])

  // Revoke thumbnails only on unmount — add/remove already revoke their own.
  const picksRef = useRef<Pick[]>(picks)
  picksRef.current = picks
  useEffect(() => {
    return () => {
      picksRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
    }
  }, [])

  function addFiles(list: FileList | null) {
    if (!list) return
    setError(null)
    const next: Pick[] = []
    for (const file of Array.from(list)) {
      if (picks.length + next.length >= MAX_FILES) {
        setError(`You can attach at most ${MAX_FILES} files.`)
        break
      }
      const isImage = file.type.startsWith('image/')
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      if (!isImage && !isPdf) {
        setError('Only module images (JPG, PNG, WebP) or PDFs are allowed.')
        continue
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: isImage ? URL.createObjectURL(file) : undefined,
      })
    }
    if (next.length) setPicks((p) => [...p, ...next])
  }

  function removePick(id: string) {
    setPicks((p) => {
      const hit = p.find((x) => x.id === id)
      if (hit?.preview) URL.revokeObjectURL(hit.preview)
      return p.filter((x) => x.id !== id)
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return

    if (!subject.trim()) return setError('Enter the subject you are being examined on.')
    if (!examDate) return setError('Pick your exam date.')
    if (examDate < today) return setError('The exam date is in the past.')
    if (!picks.length) return setError('Attach at least one module image or PDF.')

    setBusy(true)
    setError(null)
    try {
      setPreparing(true)
      const compressed = await Promise.all(picks.map((p) => compressImage(p.file)))
      setPreparing(false)

      const form = new FormData()
      form.append('subject', subject.trim())
      form.append('examDate', examDate)
      compressed.forEach((file) => form.append('modules', file))

      const result = await generatePlan(form)
      setPlan(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the plan. Please try again.')
    } finally {
      setPreparing(false)
      setBusy(false)
    }
  }

  function reset() {
    setPlan(null)
    setError(null)
    setPicks((p) => {
      p.forEach((x) => x.preview && URL.revokeObjectURL(x.preview))
      return []
    })
  }

  const stats = plan
    ? [
        { label: 'Days left', value: String(plan.daysUntilExam) },
        { label: 'Study days', value: String(plan.entries.length) },
        { label: 'Total hours', value: String(plan.totalHours) },
        {
          label: 'Avg / day',
          value: String(Math.round((plan.totalHours / Math.max(1, plan.entries.length)) * 10) / 10),
          unit: 'h',
        },
      ]
    : []

  return (
    <div className="rise-grid mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow="AI generated"
        title="Study Planner"
        description="Drop in your module photos or PDFs — get a day-by-day plan with hours, topics and exam questions up to your exam date."
        aside={
          plan ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ice/15 bg-ice/[0.06] px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] text-ice/80 uppercase transition hover:border-ice/30 hover:text-ice"
            >
              <RefreshCw className="h-3 w-3" /> New plan
            </button>
          ) : null
        }
      />

      {!plan && (
        <form onSubmit={submit} className="glass-ice space-y-4 rounded-xl p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="sp-subject"
                className="mb-1.5 block font-mono text-[10px] tracking-[0.14em] text-muted uppercase"
              >
                Subject
              </label>
              <input
                id="sp-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Database Management Systems"
                maxLength={120}
                className={INPUT}
              />
            </div>
            <div>
              <label
                htmlFor="sp-exam"
                className="mb-1.5 block font-mono text-[10px] tracking-[0.14em] text-muted uppercase"
              >
                Exam date
              </label>
              <input
                id="sp-exam"
                type="date"
                value={examDate}
                min={today}
                onChange={(e) => setExamDate(e.target.value)}
                className={clsx(INPUT, '[color-scheme:dark]')}
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              Module images / PDFs
            </p>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ice/25 bg-thaw px-4 py-5 text-sm text-ice/70 transition hover:border-ice/45 hover:text-ice"
            >
              <ImagePlus className="h-4 w-4" />
              Add photos of your modules or a PDF
              <span className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                up to {MAX_FILES}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />

            {picks.length > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {picks.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2.5 rounded-lg border border-ice/10 bg-surface-2/60 p-2"
                  >
                    {p.preview ? (
                      <img
                        src={p.preview}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md border border-ice/10 object-cover"
                      />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-ice/10 bg-thaw">
                        <FileText className="h-4 w-4 text-ice/60" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{p.file.name}</span>
                      <span className="font-mono text-[10px] tracking-[0.08em] text-muted uppercase">
                        {(p.file.size / (1024 * 1024)).toFixed(1)} mb
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${p.file.name}`}
                      onClick={() => removePick(p.id)}
                      className="rounded-md p-1 text-muted transition hover:bg-ice/10 hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-red-400/25 bg-red-400/[0.07] px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="glow-cta inline-flex items-center gap-2 rounded-lg bg-ice px-4 py-2.5 text-sm font-semibold text-thaw-deep transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {preparing ? 'Preparing images…' : 'Reading modules & building your plan…'}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate study plan
              </>
            )}
          </button>
          {busy && (
            <p className="text-xs leading-relaxed text-muted">
              Photos are read and the timetable is generated in one pass — this can take up to a minute for long
              plans.
            </p>
          )}
        </form>
      )}

      {plan && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map((s) => (
              <StatChip key={s.label} label={s.label} value={s.value} unit={s.unit} />
            ))}
          </div>

          <section className="glass-ice rounded-xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">{plan.subject}</h2>
              <span className="font-mono text-[10px] tracking-[0.1em] text-muted uppercase">
                exam {prettyDate(plan.examDate) ?? plan.examDate}
              </span>
            </div>
            {plan.summary && <p className="mt-1.5 text-sm leading-relaxed text-muted">{plan.summary}</p>}
          </section>

          <div className="space-y-3">
            {plan.entries.map((entry, i) => (
              <PlanEntryCard key={`${entry.label}-${i}`} entry={entry} index={i} />
            ))}
          </div>

          {plan.finalTips.length > 0 && (
            <section className="glass-ice rounded-xl p-4">
              <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                <Lightbulb className="h-3 w-3" /> Exam-week habits
              </p>
              <ul className="mt-2 space-y-1.5">
                {plan.finalTips.map((tip, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink/85">
                    <span className="font-mono text-[10px] text-ice/60">{String(i + 1).padStart(2, '0')}</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
