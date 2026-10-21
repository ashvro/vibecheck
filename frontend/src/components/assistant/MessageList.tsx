import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react'
import { modeForIntent, MODE_BY_ID, type AssistantMode, type ModeDef } from './modes'
import { parseReplyCard, ReplyCardView, type ReplyCard } from './replyCard'
import { CodeBlock, splitCode } from './CodeBlock'

export type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
  meta?: {
    intent?: string | null
    riskLevel?: string | null
    sources?: Array<{ label?: string; title?: string | null; source?: string }>
  }
}

export type Turn = {
  /** Stable identity for React keys (message ids are timestamps, not stable). */
  key: string
  user?: Message
  assistant?: Message
  /** A mode change landed on this turn, so render the divider above it. */
  divider?: ModeDef
  /** Which message to auto-speak once it finishes streaming. */
  streamId?: number
}

/** Groups the flat message list into user → assistant turns. */
export function buildTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null

  for (const m of messages) {
    if (m.role === 'user') {
      current = { key: `u${m.id}`, user: m }
      turns.push(current)
      continue
    }
    if (current && !current.assistant) {
      current.assistant = m
      current.key = `t${current.user!.id}`
    } else {
      turns.push({ key: `a${m.id}`, assistant: m })
    }
  }
  return turns
}

/** Inserts a "Switched to …" divider wherever the mode changed. */
export function withDividers(turns: Turn[], initialMode: AssistantMode): Turn[] {
  let mode: AssistantMode = initialMode
  return turns.map((turn) => {
    const intent = turn.user?.meta?.intent
    if (!intent) return turn
    const next: AssistantMode = modeForIntent(intent)
    if (next === mode) return turn
    mode = next
    return { ...turn, divider: MODE_BY_ID[next] }
  })
}

export function SwitchedDivider({ mode }: { mode: ModeDef }) {
  return (
    <div className="my-1 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-vc-line" />
      <span className="inline-flex shrink-0 items-center gap-2 text-[12px] text-vc-ink-2">
        <span className={clsx('h-1.5 w-1.5 rounded-full', mode.fill)} />
        Switched to {mode.label}
        <span className="text-vc-ink-3">· {mode.divider}</span>
      </span>
      <span className="h-px flex-1 bg-vc-line" />
    </div>
  )
}

export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="chat-bubble-in max-w-[85%] rounded-2xl border border-white/5 bg-vc-bubble px-[13px] py-[13px] text-[16px] leading-[22px] whitespace-pre-wrap text-vc-ink">
        {text}
      </div>
    </div>
  )
}

function personaLabel(intent?: string | null): string | null {
  if (intent === 'mental_health') return 'Counselor'
  return null
}

function ActionButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition',
        active ? 'text-vc-general' : 'text-vc-ink-2 hover:bg-vc-surface hover:text-vc-ink',
      )}
    >
      {children}
    </button>
  )
}

function ActionRow({
  text,
  messageId,
  onSpeak,
  speaking,
}: {
  text: string
  messageId: number
  onSpeak: (text: string, id: number) => void
  speaking: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const [regenTick, setRegenTick] = useState(0)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }

  function regenerate() {
    // No regenerate endpoint exists on the assistant API, so this is a local
    // affordance: it acknowledges the tap without mutating the transcript.
    setRegenTick((n) => n + 1)
  }

  return (
    <div className="mt-2.5 flex items-center gap-0.5">
      <ActionButton label={copied ? 'Copied' : 'Copy reply'} onClick={copy} active={copied}>
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </ActionButton>
      <ActionButton label={speaking ? 'Stop speaking' : 'Read aloud'} onClick={() => onSpeak(text, messageId)} active={speaking}>
        <Volume2 className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label={regenTick ? 'Regenerated' : 'Regenerate'} onClick={regenerate} active={regenTick > 0}>
        <RotateCcw className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label="Good reply" onClick={() => setVote(vote === 'up' ? null : 'up')} active={vote === 'up'}>
        <ThumbsUp className="h-3.5 w-3.5" />
      </ActionButton>
      <ActionButton label="Bad reply" onClick={() => setVote(vote === 'down' ? null : 'down')} active={vote === 'down'}>
        <ThumbsDown className="h-3.5 w-3.5" />
      </ActionButton>
    </div>
  )
}

function Paragraphs({ text }: { text: string }) {
  const parts = text.includes('\n\n') ? text.split(/\n{2,}/) : text.split(/\n/)
  return (
    <>
      {parts.map((para, i) => (
        <p key={i} className={i > 0 ? 'mt-3.5' : undefined}>
          {para}
        </p>
      ))}
    </>
  )
}

export function AssistantReply({
  message,
  onGuide,
  onSpeak,
  speaking,
}: {
  message: Message
  onGuide: (text: string) => void
  onSpeak: (text: string, id: number) => void
  speaking: boolean
}) {
  const persona = personaLabel(message.meta?.intent)
  // A reply with a code block is rendered as prose + boxed code; card parsing
  // would flatten the snippet into a bullet list, so it is skipped entirely.
  const segments = splitCode(message.text)
  const card: ReplyCard | null = segments.some((s) => s.kind === 'code') ? null : parseReplyCard(message.text)

  return (
    <div className="chat-bubble-in">
      {persona && (
        <p className="mb-2 flex items-center gap-1.5 text-[12px] text-vc-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-vc-counselor" />
          {persona}
        </p>
      )}

      {card ? (
        <ReplyCardView card={card} onGuide={() => onGuide(message.text)} />
      ) : (
        <div className="text-[16px] leading-[27px] text-vc-ink">
          {segments.map((seg, i) =>
            seg.kind === 'code' ? (
              <CodeBlock key={i} lang={seg.lang} code={seg.code} />
            ) : seg.kind === 'list' ? (
              <ul key={i} className="my-3 space-y-2">
                {seg.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-vc-general" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Paragraphs key={i} text={seg.text} />
            ),
          )}
        </div>
      )}

      <ActionRow text={message.text} messageId={message.id} onSpeak={onSpeak} speaking={speaking} />
    </div>
  )
}
