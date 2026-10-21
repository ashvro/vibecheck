/**
 * The assistant replies in plain prose — the backend strips markdown, headings,
 * bullets and numbering before it reaches us (see `normalizeReplyText`), and
 * there is no card or plan field in the API. The mockups, though, show a study
 * plan and a breathing exercise rendered as cards. So the cards are derived
 * client-side from the wording, and are deliberately conservative: a reply that
 * does not clearly read as one falls back to plain paragraphs.
 */

export type PlanRow = {
  /** Leading marker, e.g. "Day 1". */
  marker: string
  /** Bold label, e.g. "Foundations". */
  label: string
  /** Rest of the row, e.g. "ER diagrams, keys, normalization (1NF to BCNF)". */
  detail: string
  /** Trailing duration, when the reply stated one. */
  duration?: string
}

export type PlanCard = {
  kind: 'plan'
  title: string
  meta?: string
  rows: PlanRow[]
  intro: string
}

export type StepsCard = {
  kind: 'steps'
  title: string
  /** Leading sentence, if any. */
  intro: string
  steps: string[]
}

export type ReplyCard = PlanCard | StepsCard

/** A leading sentence that ends in "… plan". */
const PLAN_TITLE =
  /^(?:here'?s|here is|this is)?\s*(?:a|the|your|my)?\s*((?:\d+[\s-]?day|\d+[\s-]?week)?\s*[^.!?]{0,40}?)\s*(?:study\s+)?plan\s*[:,.]?\s*(.*)$/i
const RESET_TITLE =
  /^((?:(?:\d+|[a-z]+)[\s-]?\w*\s+)?(?:reset|breathing|grounding|calming|box)\b[^.!?]{0,32})\s*[:,.]?\s*(.*)$/i

/** "ER diagrams, keys, normalization (1NF to BCNF) 3h" → detail + "3h". */
const DURATION_TAIL = /^(.*?)[\s(]+(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b[^)]*\)?\s*$/i
const DURATION_TOTAL = /((?:about|roughly|around|~)?\s*\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours))\b/i

/** "Day 1 Foundations: topics" / "Day 1 — Foundations — topics". */
const MARKERED = /^((?:day|week|session|step|phase|part)\s*\d+)\b\s*[-–—:.]?\s*(.*)$/i
const NUMBERED = /^(\d{1,2})\s*[.)]\s+(.*)$/

function lines(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => {
      const trimmed = line.trim()
      if (!trimmed) return []
      // A line that already reads as one clause stays whole; a long run-on is
      // broken at sentence ends so a trailing "Day 2 …" still becomes a row.
      if (trimmed.length <= 120) return [trimmed]
      return trimmed
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
    .filter(Boolean)
}

/** Turns "Foundations: ER diagrams, keys" into marker / label / detail. */
function splitLabeled(rest: string, marker: string): PlanRow {
  const colon = rest.indexOf(':')
  if (colon > 0 && colon <= 40) {
    return { marker, label: rest.slice(0, colon).trim(), detail: rest.slice(colon + 1).trim() }
  }
  const dash = rest.match(/^(.{0,40}?)\s+[-–—]\s+(.+)$/)
  if (dash) return { marker, label: dash[1].trim(), detail: dash[2].trim() }

  // No explicit label: the first clause reads as the label when the row is long
  // enough to have both, otherwise the whole thing is the detail.
  const comma = rest.indexOf(',')
  if (comma > 12 && comma <= 28) {
    return { marker, label: rest.slice(0, comma).trim(), detail: rest.slice(comma + 1).trim() }
  }
  return { marker, label: '', detail: rest }
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Reads a "Day N" plan out of a reply. The title may sit on its own line after
 * an opening sentence, so it is searched for rather than assumed to come first.
 * Requires at least two marker rows, so a passing mention of a day cannot turn
 * a normal answer into a card.
 */
export function parsePlanCard(text: string): PlanCard | null {
  const all = lines(text)
  if (all.length < 3) return null

  const titleIndex = all.findIndex((line) => PLAN_TITLE.test(line))
  if (titleIndex === -1) return null
  const titleMatch = all[titleIndex].match(PLAN_TITLE)!

  const rows: PlanRow[] = []
  let meta: string | undefined
  for (let i = titleIndex + 1; i < all.length; i += 1) {
    const line = all[i]
    const m = line.match(MARKERED)
    if (!m) {
      // A short trailing line right after the title carries the total.
      if (!rows.length && DURATION_TOTAL.test(line) && line.length <= 60) {
        meta = sentenceCase(tidy(line))
        continue
      }
      if (rows.length) break
      continue
    }
    let detail = m[2].trim()
    let duration: string | undefined
    const dur = detail.match(DURATION_TAIL)
    if (dur) {
      detail = dur[1].trim()
      duration = `${dur[2]}h`
    }
    rows.push({ ...splitLabeled(detail, tidy(m[1])), duration })
  }
  if (rows.length < 2) return null

  // The total can also appear inline, e.g. "About 10 hours total."
  if (!meta) {
    const total = text.match(DURATION_TOTAL)
    if (total) meta = sentenceCase(tidy(`${total[1]} total`))
  }

  const title = titleMatch[1] ? `${tidy(titleMatch[1])} plan` : 'Study plan'
  const introLines = all.slice(0, titleIndex)
  const intro = tidy(introLines.join(' '))

  return {
    kind: 'plan',
    title: sentenceCase(title),
    meta,
    rows,
    intro,
  }
}

/**
 * Reads a numbered exercise out of a reply ("One-minute reset: Breathe in …
 * Hold … Breathe out …"). The backend strips the digits, so numbering may only
 * survive as separate lines — this accepts either shape.
 */
export function parseStepsCard(text: string): StepsCard | null {
  const all = lines(text)
  if (all.length < 3) return null

  const titleIndex = all.findIndex((line) => RESET_TITLE.test(line))
  if (titleIndex === -1) return null
  const titleMatch = all[titleIndex].match(RESET_TITLE)!

  const steps: string[] = []
  for (let i = titleIndex + 1; i < all.length; i += 1) {
    const line = all[i]
    const m = line.match(NUMBERED)
    steps.push(tidy(m ? m[2] : line))
  }
  if (steps.length < 2) return null

  const inlineTitle = tidy(titleMatch[2] ?? '')
  const introLines = all.slice(0, titleIndex)
  const intro = tidy([...introLines, inlineTitle].filter(Boolean).join(' '))

  return {
    kind: 'steps',
    title: sentenceCase(tidy(titleMatch[1])),
    intro,
    steps,
  }
}

export function parseReplyCard(text: string): ReplyCard | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return parsePlanCard(trimmed) ?? parseStepsCard(trimmed)
}

function PlanRowView({ row }: { row: PlanRow }) {
  return (
    <li className="flex min-h-[60px] items-center gap-[17px] pr-4 pl-[18px]">
      <span
        aria-hidden
        className="inline-flex h-5 w-5 shrink-0 rounded-[5px] border border-vc-check"
      />
      <span className="flex min-w-0 flex-[0_0_83px] flex-col">
        <span className="text-[13px] leading-[18px] text-vc-ink-2">{row.marker}</span>
        {row.label && (
          <span className="text-[13px] leading-[18px] font-semibold text-vc-ink">{row.label}</span>
        )}
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-[20px] text-vc-ink">{row.detail}</span>
      {row.duration && <span className="shrink-0 text-[13px] text-vc-ink">{row.duration}</span>}
    </li>
  )
}

function StepsRowView({ index, text }: { index: number; text: string }) {
  return (
    <li className="flex items-center gap-[10px] pr-[11px] pl-[18px] py-[10px]">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-vc-bubble text-[12px] font-semibold text-vc-ink">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 text-[13px] leading-[20px] text-vc-ink">{text}</span>
    </li>
  )
}

export function ReplyCardView({ card, onGuide }: { card: ReplyCard; onGuide?: () => void }) {
  const isPlan = card.kind === 'plan'
  return (
    <div className="space-y-3">
      {card.intro && <p className="text-[16px] leading-[27px] text-vc-ink">{card.intro}</p>}

      <div className="vc-glass-plum overflow-hidden rounded-xl border border-vc-line shadow-[var(--depth-1)]">
        <div
          className={
            isPlan
              ? 'flex h-10 items-center justify-between gap-3 bg-vc-surface-2 pr-[17px] pl-[18px]'
              : 'flex items-center justify-between gap-3 pt-4 pr-[17px] pl-[19px]'
          }
        >
          <span className="text-[14px] font-semibold text-vc-ink">{card.title}</span>
          {isPlan && card.meta && <span className="text-[12px] text-vc-ink-2">{card.meta}</span>}
        </div>

        <ul className={isPlan ? 'divide-y divide-vc-line' : 'pt-1 pb-2'}>
          {isPlan
            ? card.rows.map((row, i) => <PlanRowView key={i} row={row} />)
            : card.steps.map((step, i) => <StepsRowView key={i} index={i} text={step} />)}
        </ul>

        {card.kind === 'steps' && onGuide && (
          <div className="pr-[11px] pl-[17px] pt-1 pb-4">
            <button
              type="button"
              onClick={onGuide}
              className="inline-flex items-center rounded-full bg-vc-bubble px-[18px] py-[13px] text-[12px] leading-4 font-medium text-vc-ink transition hover:bg-vc-surface-2"
            >
              Guide me through it
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
