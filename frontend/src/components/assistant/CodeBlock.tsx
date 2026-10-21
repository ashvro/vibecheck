import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export type ReplySegment =
  | { kind: 'prose'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; lang: string; code: string }

/**
 * Splits a reply into prose, bullet lists and fenced code blocks.
 *
 * The backend preserves fences for tutor answers and keeps "- " markers on
 * key-point lines, so this is the only markdown the renderer has to
 * understand. A fence that is still open (mid-stream) is treated as code too,
 * so the box appears as soon as the opening fence arrives instead of the raw
 * backticks flashing as text.
 */
export function splitCode(text: string): ReplySegment[] {
  const parts = text.split(/```/)
  const out: ReplySegment[] = []

  for (let i = 0; i < parts.length; i += 1) {
    if (i % 2 === 1) {
      const segment = parts[i]
      const nl = segment.indexOf('\n')
      const lang = (nl === -1 ? '' : segment.slice(0, nl)).trim()
      const code = (nl === -1 ? segment : segment.slice(nl + 1)).replace(/\s+$/, '')
      if (code.trim()) out.push({ kind: 'code', lang, code })
      continue
    }
    pushText(out, parts[i])
  }

  return out
}

/**
 * Walks a prose chunk line by line, emitting paragraph segments and grouping
 * consecutive "- " lines into a single list segment. Without the grouping each
 * bullet would become its own list and the spacing between them would break.
 */
function pushText(out: ReplySegment[], block: string) {
  let paragraph: string[] = []
  let items: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim()
    if (text) out.push({ kind: 'prose', text })
    paragraph = []
  }
  const flushItems = () => {
    if (items.length) out.push({ kind: 'list', items })
    items = []
  }

  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (/^[-•*]\s+/.test(line)) {
      flushParagraph()
      items.push(line.replace(/^[-•*]\s+/, '').trim())
      continue
    }
    if (!line) {
      flushParagraph()
      flushItems()
      continue
    }
    flushItems()
    paragraph.push(line)
  }
  flushParagraph()
  flushItems()
}

/** True when the reply contains code, so callers can skip card parsing. */
export function hasCode(text: string): boolean {
  return /```/.test(text)
}

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  go: 'Go',
  rust: 'Rust',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Bash',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
}

/** A boxed, labelled, copyable code block — the ChatGPT-style frame. */
export function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const label = LANG_LABELS[lang.toLowerCase()] ?? (lang ? lang.toUpperCase() : 'Code')

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="my-3.5 overflow-hidden rounded-xl border border-vc-line bg-vc-rail">
      <div className="flex items-center justify-between border-b border-vc-line px-3.5 py-1.5">
        <span className="font-mono text-[11px] tracking-[0.08em] text-vc-ink-2 uppercase">{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied code' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-vc-ink-2 transition hover:bg-vc-surface hover:text-vc-ink"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {/* Horizontal scroll keeps long lines intact instead of wrapping and
          destroying the indentation the code depends on. */}
      <pre className="vc-scroll overflow-x-auto px-3.5 py-3">
        <code className="font-mono text-[13px] leading-[21px] text-vc-ink">{code}</code>
      </pre>
    </div>
  )
}
