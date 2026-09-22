import { useEffect, useRef, useState, type PointerEvent } from 'react'
import clsx from 'clsx'
import { Send, Plus, MessageSquare, Trash2 } from 'lucide-react'
import { CrystalMark } from '../../components/CrystalMark'
import { api } from '../../lib/api'

type ChatMeta = {
  intent?: string | null
  riskLevel?: string | null
  sentimentScore?: number | null
  emotion?: string | null
}

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
  meta?: ChatMeta
}

type ChatSession = {
  id: number
  title: string
  intent?: string | null
  sentimentScore?: number | null
  updatedAt: string
  messageCount: number
  preview?: string | null
}

const BARS = [40, 65, 100, 55]

const riskStyles: Record<string, string> = {
  low: 'text-emerald-soft bg-emerald-soft/15 border-emerald-soft/25',
  moderate: 'text-amber-gentle bg-amber-gentle/15 border-amber-gentle/25',
  high: 'text-rose-400 bg-rose-500/15 border-rose-400/30',
  critical: 'text-rose-400 bg-rose-500/20 border-rose-400/40',
}

function riskDot(risk?: string | null) {
  if (risk === 'high' || risk === 'critical') return 'bg-rose-400'
  if (risk === 'moderate') return 'bg-amber-gentle'
  if (risk === 'low') return 'bg-emerald-soft'
  return 'bg-ice/30'
}

function MoodBars({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-end gap-1', className)}>
      {BARS.map((h, i) => (
        <span
          key={i}
          className={clsx(
            'chat-bars-in w-1.5 rounded-sm bg-gradient-to-t from-violet-deep to-violet-soft',
            i === 2 && 'ring-1 ring-violet-soft/40',
          )}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}

function MetaChips({ meta }: { meta?: ChatMeta }) {
  if (!meta) return null
  const hasMeta = meta.intent || meta.riskLevel
  const hasSentiment = meta.sentimentScore != null
  if (!hasMeta && !hasSentiment) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {meta.intent && (
        <span className="rounded border border-ice/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-ice/50 uppercase">
          {meta.intent}
        </span>
      )}
      {meta.riskLevel && (
        <span
          className={clsx(
            'rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wider uppercase',
            riskStyles[meta.riskLevel] ?? 'border-ice/10 text-ice/50',
          )}
        >
          {meta.riskLevel} risk
        </span>
      )}
      {hasSentiment && (
        <span className="flex items-center gap-1 rounded border border-ice/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-ice/50 uppercase">
          <span className={clsx('h-1 w-1 rounded-full', meta.sentimentScore! >= 0.6 ? 'bg-emerald-soft' : meta.sentimentScore! >= 0.4 ? 'bg-amber-gentle' : 'bg-rose-400')} />
          {meta.emotion ?? 'sentiment'} · {(meta.sentimentScore! * 100).toFixed(0)}%
        </span>
      )}
    </div>
  )
}

function SentimentIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const tone =
    score >= 0.6
      ? 'bg-emerald-soft'
      : score >= 0.4
        ? 'bg-amber-gentle'
        : 'bg-rose-400'
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <div className="h-1 w-14 overflow-hidden rounded-full bg-ice/10">
        <div className={clsx('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[9px] tracking-wider text-ice/40">
        sentiment {score.toFixed(2)}
      </span>
    </div>
  )
}

const GREETING = "Hey — I'm here when you need clarity. What's on your mind?"

type BackendMessage = {
  id: number
  role: string
  content: string
  intent?: string | null
  riskLevel?: string | null
  label?: string | null
  score?: number | null
}

function mapBackend(m: BackendMessage): Message {
  const meta: ChatMeta = {
    intent: m.intent ?? null,
    riskLevel: m.riskLevel ?? null,
    emotion: m.label ?? null,
    sentimentScore: m.score ?? null,
  }
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.content,
    meta: m.role === 'user' ? meta : undefined,
  }
}

const GREETING_MSG: Message = { id: 1, role: 'assistant', text: GREETING }

function sessionTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function AIAssistantPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [hoveringChat, setHoveringChat] = useState(false)
  const [hoveringHistory, setHoveringHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  async function loadMessagesFor(id: number) {
    setLoadingMessages(true)
    try {
      const backendMsgs = await api.get<BackendMessage[]>(`/api/assistant/messages?sessionId=${id}`)
      const mapped = backendMsgs.map(mapBackend)
      setMessages(mapped.length ? mapped : [GREETING_MSG])
    } catch {
      setMessages([GREETING_MSG])
    } finally {
      setLoadingMessages(false)
    }
  }

  async function refreshSessions() {
    try {
      const list = await api.get<ChatSession[]>('/api/assistant/sessions')
      setSessions(list)
    } catch {
      /* keep current list */
    }
  }

  useEffect(() => {
    let cancelled = false

    api
      .get<ChatSession[]>('/api/assistant/sessions')
      .then(async (list) => {
        if (cancelled) return
        setSessions(list)
        if (list.length) {
          setSessionId(list[0].id)
          await loadMessagesFor(list[0].id)
        } else {
          setMessages([GREETING_MSG])
        }
      })
      .catch(() => {
        if (!cancelled) setMessages([GREETING_MSG])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, loadingMessages])

  function handleChatMove(e: PointerEvent<HTMLDivElement>) {
    const el = chatRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--gx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--gy', `${e.clientY - rect.top}px`)
  }

  function handleHistoryMove(e: PointerEvent<HTMLDivElement>) {
    const el = historyRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--gx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--gy', `${e.clientY - rect.top}px`)
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    const userMsgId = Date.now()
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text }])
    setInput('')
    setSending(true)

    try {
      const res = await api.post<{ reply: string; meta?: ChatMeta; session?: { id: number } }>(
        '/api/assistant/chat',
        { message: text, sessionId },
      )
      if (res.session?.id) setSessionId(res.session.id)
      setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, meta: res.meta } : m)))
      setMessages((prev) => [...prev, { id: userMsgId + 1, role: 'assistant', text: res.reply, meta: res.meta }])
      void refreshSessions()
    } catch {
      const fallbackMsg: Message = { id: userMsgId + 1, role: 'assistant', text: 'Got it. Share more whenever you\'re ready — academics, well-being, campus life, or career.', meta: undefined }
      setMessages((prev) => [...prev, fallbackMsg])
    } finally {
      setSending(false)
    }
  }

  async function newChat() {
    try {
      const res = await api.post<ChatSession>('/api/assistant/sessions')
      const created: ChatSession = {
        id: res.id,
        title: res.title ?? 'New chat',
        updatedAt: res.updatedAt ?? new Date().toISOString(),
        messageCount: 0,
        preview: null,
      }
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== res.id)])
      setSessionId(res.id)
      setMessages([GREETING_MSG])
    } catch {
      setSessionId(null)
      setMessages([GREETING_MSG])
    }
  }

  async function selectSession(id: number) {
    if (id === sessionId) return
    setSessionId(id)
    setMessages([])
    await loadMessagesFor(id)
  }

  async function handleDeleteSession(e: React.MouseEvent, id: number) {
    e.stopPropagation()
    if (confirmingDelete !== id) {
      setConfirmingDelete(id)
      window.setTimeout(() => setConfirmingDelete((c) => (c === id ? null : c)), 4000)
      return
    }
    setConfirmingDelete(null)
    try {
      await api.del(`/api/assistant/sessions/${id}`)
      const remaining = sessions.filter((s) => s.id !== id)
      setSessions(remaining)
      if (sessionId === id) {
        const next = remaining[0]
        if (next) {
          setSessionId(next.id)
          setMessages([])
          await loadMessagesFor(next.id)
        } else {
          setSessionId(null)
          setMessages([GREETING_MSG])
        }
      }
    } catch {
      /* deletion failed — keep list as-is */
    }
  }

  const lastMeta = [...messages].reverse().find((m) => m.role === 'user')?.meta
  const statusLine = lastMeta
    ? lastMeta.riskLevel === 'high' || lastMeta.riskLevel === 'critical'
      ? `Safety mode · ${lastMeta.riskLevel}`
      : `${lastMeta.intent ?? 'assistant'} · ${lastMeta.riskLevel ?? 'low'} risk`
    : 'Intent-aware · safety-first pipeline'

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-bg">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <CrystalMark spinOnView />
          <div>
            <h1 className="font-display text-sm font-bold text-ink">AI Assistant</h1>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
              <span className={clsx('h-1 w-1 rounded-full', riskDot(lastMeta?.riskLevel))} />
              {statusLine}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-4 px-5 pt-5 pb-6 sm:px-6">
        {/* History sidebar */}
        <div
          ref={historyRef}
          onPointerMove={handleHistoryMove}
          onPointerEnter={() => setHoveringHistory(true)}
          onPointerLeave={() => setHoveringHistory(false)}
          className="group relative hidden w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60 md:flex"
        >
          <div
            className={clsx(
              'chat-shine pointer-events-none absolute inset-0 z-0 transition-opacity duration-300',
              hoveringHistory ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden
          />
          <div className="relative z-10 flex flex-1 flex-col">
            <div className="border-b border-ice/10 p-3">
              <button
                type="button"
                onClick={newChat}
                className="flex w-full items-center gap-2 rounded-lg border border-ice/10 bg-thaw px-2.5 py-2 text-[12px] font-medium text-ice/70 transition hover:bg-ice/5 hover:text-ice"
              >
                <Plus className="h-3.5 w-3.5" />
                New chat
              </button>
            </div>
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {!loading && sessions.length === 0 && (
                <p className="px-2 py-6 text-center text-[11px] leading-relaxed text-ice/40">
                  No conversations yet.<br />Start one above.
                </p>
              )}
{sessions.map((s) => (
                <div
                  key={s.id}
                  className={clsx(
                    'group flex items-center rounded-lg transition',
                    s.id === sessionId ? 'bg-ice/15 text-ice' : 'text-ice/60 hover:bg-ice/5 hover:text-ice/85',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectSession(s.id)}
                    className={clsx(
                      'flex min-w-0 flex-1 items-center gap-2.5 rounded-l-lg px-2.5 py-2 text-left',
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[12px] font-medium">{s.title !== 'New chat' ? s.title : (s.preview?.slice(0, 32) ?? 'New chat')}</span>
                        <span className="shrink-0 text-[9px] text-ice/40">{sessionTime(s.updatedAt)}</span>
                      </span>
                      {s.preview && (
                        <span className="mt-0.5 block truncate text-[10px] text-ice/40">{s.preview}</span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteSession(e, s.id)}
                    title={confirmingDelete === s.id ? 'Click again to delete' : 'Delete conversation'}
                    className={clsx(
                      'mr-1.5 inline-flex shrink-0 items-center justify-center rounded-md transition',
                      confirmingDelete === s.id
                        ? 'bg-rose-500/20 px-2 py-1 font-mono text-[9px] font-semibold tracking-wider text-rose-400 uppercase hover:bg-rose-500/30'
                        : 'h-6 w-6 opacity-0 text-ice/40 hover:bg-ice/10 hover:text-rose-400 group-hover:opacity-100',
                    )}
                  >
                    {confirmingDelete === s.id ? 'Delete' : <Trash2 className="h-3 w-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chat box */}
        <div
          ref={chatRef}
          onPointerMove={handleChatMove}
          onPointerEnter={() => setHoveringChat(true)}
          onPointerLeave={() => setHoveringChat(false)}
          className="group relative flex flex-1 flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/60"
        >
          <div
            className={clsx(
              'chat-shine pointer-events-none absolute inset-0 z-0 transition-opacity duration-300',
              hoveringChat ? 'opacity-100' : 'opacity-0',
            )}
            aria-hidden
          />
          <div className="relative z-10 flex flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              {loading && (
                <p className="py-8 text-center text-sm text-ice/40">Loading conversation…</p>
              )}
              {!loading && loadingMessages && messages.length === 0 && (
                <p className="py-8 text-center text-sm text-ice/40">Loading messages…</p>
              )}
              {!loading && !loadingMessages && messages.map((msg) => (
                <div
                  key={msg.id}
                  className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {msg.role === 'assistant' ? (
                    <div className="max-w-[90%]">
                      <div className="chat-bubble-in min-h-[32px] rounded-lg border border-ice/10 bg-thaw px-3.5 py-2.5 text-sm leading-relaxed text-ice/75">
                        {msg.text.includes('\n\n')
                          ? msg.text.split(/\n{2,}/).map((para, i) => (
                              <p key={i} className={i > 0 ? 'mt-2.5' : undefined}>
                                {para}
                              </p>
                            ))
                          : msg.text}
                      </div>
                      {msg.meta?.intent === 'mental_health' && msg.meta.sentimentScore != null && (
                        <SentimentIndicator score={msg.meta.sentimentScore} />
                      )}
                    </div>
                  ) : (
                    <div className="flex max-w-[90%] items-start gap-2.5">
                      <div className="flex-1">
                        <div className="chat-bubble-in min-h-[32px] rounded-lg border border-ice/15 bg-thaw px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap text-ice/85">
                          {msg.text}
                        </div>
                        <MetaChips meta={msg.meta} />
                      </div>
                      <MoodBars className="mt-1 h-8" />
                    </div>
                  )}
                </div>
              ))}

              {sending && (
                <div className="flex items-center gap-2 text-xs text-ice/40">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ice/50" />
                  Routing intent, checking safety, retrieving context…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-ice/10 p-3 sm:p-4">
              <div className="flex items-center gap-2.5 rounded-lg border border-ice/10 bg-thaw px-2 py-1.5 focus-within:border-ice/30 focus-within:ring-2 focus-within:ring-violet/20">
                <textarea
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  disabled={sending}
                  placeholder="What's on your mind?"
                  className="max-h-32 flex-1 resize-none bg-transparent py-0.5 text-[13px] leading-snug text-ice/75 outline-none placeholder:text-ice/35 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={sending || !input.trim()}
                  className="mb-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-deep/25 text-violet-soft transition hover:bg-violet/30 hover:text-violet-soft disabled:opacity-50"
                  aria-label="Send message"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}