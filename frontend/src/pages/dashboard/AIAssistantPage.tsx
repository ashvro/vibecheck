import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowDown } from 'lucide-react'
import { api } from '../../lib/api'
import { streamChat } from '../../lib/stream'
import {
  startVoice,
  stopVoice,
  prewarmVoice,
  isVoiceActive,
  type VoicePhase,
} from '../../lib/voice'
import {
  getSelectedVoiceId,
  setSelectedVoiceId,
  listTtsVoices,
  getTtsStatus,
  SpeechStream,
} from '../../lib/tts'
import { ChatHistory } from '../../components/assistant/ChatHistory'
import { ModePills } from '../../components/assistant/ModePills'
import { VoiceOverlay } from '../../components/assistant/VoiceOverlay'
import { UrgentHelpDialog } from '../../components/assistant/UrgentHelpDialog'
import { Composer, DISCLAIMER } from '../../components/assistant/Composer'
import {
  AssistantReply,
  SwitchedDivider,
  UserBubble,
  buildTurns,
  withDividers,
  type Message,
} from '../../components/assistant/MessageList'
import { modeFor } from '../../components/assistant/modes'

type SourceRef = {
  title?: string | null
  label: string
  source: string
  category?: string | null
}

type ChatMeta = {
  intent?: string | null
  riskLevel?: string | null
  sources?: SourceRef[]
}

type ChatSession = {
  id: number
  title: string
  intent?: string | null
  updatedAt: string
  messageCount: number
  preview?: string | null
}

type BackendMessage = {
  id: number
  role: string
  content: string
  intent?: string | null
  riskLevel?: string | null
  sources?: string | null
}

function parseSources(raw?: string | null): SourceRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mapBackend(m: BackendMessage): Message {
  const meta: ChatMeta = {
    intent: m.intent ?? null,
    riskLevel: m.riskLevel ?? null,
    sources: parseSources(m.sources),
  }
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    text: m.content,
    meta,
  }
}

function sessionLabel(s: ChatSession): string {
  if (s.title && s.title !== 'New chat') {
    const cleaned = s.title.replace(/\n/g, ' ').trim()
    return cleaned.length > 48 ? cleaned.slice(0, 45) + '...' : cleaned
  }
  if (s.preview) {
    const cleaned = s.preview.replace(/\n/g, ' ').trim()
    return cleaned.length > 48 ? cleaned.slice(0, 45) + '...' : cleaned
  }
  return 'New chat'
}

export function AIAssistantPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  const [voiceOpen, setVoiceOpen] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceChoices, setVoiceChoices] = useState<Array<{ id: string; name: string }>>([])
  const [voiceId, setVoiceId] = useState<string | null>(getSelectedVoiceId())
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)
  const [urgentOpen, setUrgentOpen] = useState(false)
  const [speakingId, setSpeakingId] = useState<number | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<number | null>(null)
  const sendAbortRef = useRef<AbortController | null>(null)
  const voiceTurnRef = useRef<{ userId: number; replyId: number; text: string } | null>(null)
  const forceBottomRef = useRef(false)
  /** Last id we auto-spoke, so a re-render cannot restart playback. */
  const autoSpokenRef = useRef<number | null>(null)
  /** Ids the user asked to hear; the reply is spoken once it is complete. */
  const speakRequestRef = useRef<number | null>(null)
  const ttsRef = useRef<{ cancel: () => void } | null>(null)

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    prewarmVoice()
    return () => {
      sendAbortRef.current?.abort()
      ttsRef.current?.cancel()
      void stopVoice()
    }
  }, [])

  /* Warm the TTS voices so the composer can offer the real list. */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const status = await getTtsStatus()
        if (!status.provider || !alive) return
        const voices = await listTtsVoices()
        if (!alive) return
        const mapped = voices.filter((v) => v.id).map((v) => ({ id: v.id as string, name: v.name || v.id }))
        setVoiceChoices(mapped)
        const current = getSelectedVoiceId()
        if (!current && status.defaultVoiceId && mapped.some((v) => v.id === status.defaultVoiceId)) {
          setVoiceId(status.defaultVoiceId)
        }
      } catch {
        /* voices are optional */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function changeVoice(next: string | null) {
    setVoiceId(next)
    setSelectedVoiceId(next)
  }

  /* Read one reply aloud through the same pipeline voice mode uses. */
  async function speak(text: string, id: number) {
    if (speakingId === id) {
      ttsRef.current?.cancel()
      ttsRef.current = null
      setSpeakingId(null)
      return
    }
    ttsRef.current?.cancel()
    setSpeakingId(id)
    // Read only the prose. Speaking a code block aloud is unusable — the
    // narrator would recite brackets and indentation.
    const spoken = text
      .split(/```/)
      .filter((_, i) => i % 2 === 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!spoken) {
      setSpeakingId(null)
      return
    }
    try {
      const stream = new SpeechStream()
      ttsRef.current = stream
      stream.push(spoken)
      stream.flush(spoken)
      await stream.onIdle()
    } catch {
      /* playback is best-effort */
    } finally {
      if (ttsRef.current) {
        ttsRef.current = null
        setSpeakingId((current) => (current === id ? null : current))
      }
    }
  }

  const voiceActive = voicePhase !== 'idle'

  async function loadMessagesFor(id: number) {
    setLoadingMessages(true)
    try {
      const backendMsgs = await api.get<BackendMessage[]>(`/api/assistant/messages?sessionId=${id}`)
      setMessages(backendMsgs.map(mapBackend))
    } catch {
      setMessages([])
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
    // Load sessions and messages in parallel for faster initial load
    api
      .get<ChatSession[]>('/api/assistant/sessions')
      .then(async (list) => {
        if (cancelled) return
        setSessions(list)
        if (list.length && sessionId === null) {
          const firstId = list[0].id
          setSessionId(firstId)
          // Load messages in parallel, don't wait
          loadMessagesFor(firstId)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const lastMsg = messages[messages.length - 1]
  const lastText = lastMsg?.text ?? ''

  const scrollToBottom = (smooth: boolean) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    if (!forceBottomRef.current && !atBottom) return
    forceBottomRef.current = false
    setAtBottom(true)
    scrollToBottom(lastMsg?.role === 'user' && lastText.length > 0)
  }, [messages.length, lastText, lastMsg?.role, loadingMessages, voiceActive, atBottom])

  /* Speak a reply once it has finished streaming, if the user asked for it. */
  useEffect(() => {
    if (loadingMessages) return
    const visible = messages.filter((m) => m.role === 'assistant' && m.text.trim())
    if (!visible.length || visible.length <= (autoSpokenRef.current ?? 0)) return
    const newest = visible[visible.length - 1]
    autoSpokenRef.current = visible.length
    if (speakRequestRef.current === newest.id && !sending && newest.text === messages[messages.length - 1]?.text) {
      speakRequestRef.current = null
      void speak(newest.text, newest.id)
    }
  }, [messages, sending, loadingMessages])

  function handleTranscriptScroll() {
    const el = scrollerRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    if (voiceActive) void stopVoice()
    setVoiceError(null)
    const userMsgId = Date.now()
    const replyMsgId = userMsgId + 1
    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', text }])
    setInput('')
    setSending(true)
    forceBottomRef.current = true

    const controller = new AbortController()
    sendAbortRef.current = controller

    try {
      await streamChat({
        message: text,
        sessionId,
        signal: controller.signal,
        onMeta: (meta) => {
          setMessages((prev) => prev.map((m) => (m.id === userMsgId ? { ...m, meta } : m)))
        },
        onDelta: (value) => {
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === replyMsgId)
            if (exists) return prev.map((m) => (m.id === replyMsgId ? { ...m, text: value } : m))
            return [...prev, { id: replyMsgId, role: 'assistant', text: value }]
          })
        },
        onRevision: (value) => {
          setMessages((prev) => prev.map((m) => (m.id === replyMsgId ? { ...m, text: value } : m)))
        },
        onDone: ({ reply, meta, session: updated }) => {
          if (updated?.id) setSessionId(updated.id)
          setMessages((prev) => {
            const withoutReply = prev.filter((m) => m.id !== replyMsgId)
            return [
              ...withoutReply.map((m) => (m.id === userMsgId ? { ...m, meta } : m)),
              { id: replyMsgId, role: 'assistant', text: reply, meta },
            ]
          })
          void refreshSessions()
        },
      })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === replyMsgId)) return prev
          return [
            ...prev,
            {
              id: replyMsgId,
              role: 'assistant',
              text: "Sorry — I lost connection there. Try that again and I'll answer straight away.",
            },
          ]
        })
      }
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null
      setSending(false)
    }
  }

  async function handleMicToggle() {
    setVoiceError(null)
    if (isVoiceActive()) {
      setVoicePhase('idle')
      setVoiceOpen(false)
      voiceTurnRef.current = null
      await stopVoice()
      return
    }
    setVoiceOpen(true)
    try {
      await startVoice({
        getSessionId: () => sessionIdRef.current,
        onPhase: setVoicePhase,
        onTurnStart: ({ transcript, meta }) => {
          // Fires once per event type (transcript, then meta) — the turn must be
          // created only once so both land on the same message ids.
          if (!voiceTurnRef.current) {
            const ts = Date.now()
            voiceTurnRef.current = { userId: ts, replyId: ts + 1, text: '' }
            forceBottomRef.current = true
          }
          const turn = voiceTurnRef.current
          if (transcript) {
            setMessages((prev) =>
              prev.some((m) => m.id === turn.userId)
                ? prev
                : [...prev, { id: turn.userId, role: 'user', text: transcript }],
            )
          }
          if (meta) {
            setMessages((prev) => prev.map((m) => (m.id === turn.userId ? { ...m, meta } : m)))
          }
        },
        onDelta: (value) => {
          const turn = voiceTurnRef.current
          if (!turn) return
          turn.text = value
          setMessages((prev) => {
            const exists = prev.some((m) => m.id === turn.replyId)
            if (exists) return prev.map((m) => (m.id === turn.replyId ? { ...m, text: value } : m))
            return [...prev, { id: turn.replyId, role: 'assistant', text: value }]
          })
        },
        onRevision: (value) => {
          const turn = voiceTurnRef.current
          if (!turn) return
          turn.text = value
          setMessages((prev) => prev.map((m) => (m.id === turn.replyId ? { ...m, text: value } : m)))
        },
        onTurnEnd: ({ reply, meta, sessionId: nextSessionId }) => {
          const turn = voiceTurnRef.current
          voiceTurnRef.current = null
          if (nextSessionId) setSessionId(nextSessionId)
          if (!turn) return
          setMessages((prev) => {
            const withoutReply = prev.filter((m) => m.id !== turn.replyId)
            return [
              ...withoutReply.map((m) => (m.id === turn.userId ? { ...m, meta } : m)),
              { id: turn.replyId, role: 'assistant', text: reply, meta },
            ]
          })
          void refreshSessions()
        },
        onAborted: () => {
          // Barge-in or mic stop cut the turn short. Keep whatever was already
          // shown, drop an empty bubble, and release the turn so the next
          // utterance starts a fresh pair of messages.
          const turn = voiceTurnRef.current
          voiceTurnRef.current = null
          if (!turn) return
          setMessages((prev) => {
            const reply = prev.find((m) => m.id === turn.replyId)
            if (reply && !reply.text.trim()) return prev.filter((m) => m.id !== turn.replyId)
            return prev
          })
        },
        onError: (message) => {
          voiceTurnRef.current = null
          setVoiceError(message)
          setVoicePhase('idle')
          setVoiceOpen(false)
        },
      })
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : 'Could not start voice.')
      setVoiceOpen(false)
    }
  }

  async function newChat() {
    if (isVoiceActive()) void stopVoice()
    setVoiceError(null)
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
      setMessages([])
    } catch {
      setSessionId(null)
      setMessages([])
    }
  }

  async function selectSession(id: number) {
    if (id === sessionId) return
    if (isVoiceActive()) void stopVoice()
    setVoiceError(null)
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
          setMessages([])
        }
      }
    } catch {
      /* deletion failed — keep list as-is */
    }
  }

  /* Mode pills / dividers reflect the latest classified intent in view. */
  const lastIntent = [...messages].reverse().find((m) => m.role === 'user')?.meta?.intent
  const currentMode = modeFor(lastIntent).id
  const firstIntent = messages.find((m) => m.role === 'user')?.meta?.intent
  const turns = withDividers(buildTurns(messages), modeFor(firstIntent).id)
  const isEmpty = !loading && !loadingMessages && messages.length === 0

  function guide(text: string) {
    setInput('Walk me through that slowly, one step at a time.')
    void text
  }

  return (
    <div className="vc-glass relative flex h-[calc(100vh-7.5rem)] min-h-[520px] overflow-hidden rounded-2xl border border-vc-line text-vc-ink shadow-[var(--depth-1)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={clsx(
            'flex h-[58px] shrink-0 items-center justify-between gap-4 px-[19px]',
            !isEmpty && 'border-b border-vc-line',
          )}
        >
          <div className="min-w-0">
            <p className="font-mono text-[10px] leading-[15px] tracking-[0.12em] text-vc-ink-2 uppercase">
              Intent-aware · Safety-first pipeline
            </p>
            <ModePills active={currentMode} className="mt-1" />
          </div>
          <button
            type="button"
            onClick={() => setUrgentOpen(true)}
            className="shrink-0 text-[13px] font-medium text-vc-alert transition hover:brightness-110"
          >
            Need urgent help?
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <ChatHistory
            className="ml-4 w-[280px] shrink-0"
            sessions={sessions.map((s) => ({ id: s.id, title: sessionLabel(s) }))}
            activeId={sessionId}
            loading={loading}
            onNewChat={newChat}
            onSelect={selectSession}
            onDelete={handleDeleteSession}
            confirmingDelete={confirmingDelete}
            search={search}
            onSearchChange={setSearch}
          />

          <div className="ml-5 mr-0 h-full w-px bg-vc-line" />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col pl-6">
            {/* The scroller and the composer are separate flex children so the
                transcript can never scroll underneath the composer panel. */}
            <div className="relative min-h-0 flex-1">
              <div
                ref={scrollerRef}
                onScroll={handleTranscriptScroll}
                className={clsx(
                  'vc-scroll h-full overflow-y-auto overscroll-contain',
                  isEmpty && 'flex flex-col justify-center',
                )}
              >
                <div
                  className={clsx(
                    'mx-auto w-full max-w-[860px]',
                    isEmpty ? 'pb-[54px]' : 'pt-6 pb-16',
                  )}
                >
                {loading && <p className="py-10 text-center text-[13px] text-vc-ink-2">Loading conversations…</p>}
                {!loading && loadingMessages && <p className="py-10 text-center text-[13px] text-vc-ink-2">Loading messages…</p>}

                {isEmpty && (
                  <p className="h-[38px] text-center text-[32px] leading-tight font-semibold text-vc-ink">
                    What's on your mind?
                  </p>
                )}

                {isEmpty && (
                  <div className="pt-[24px]">
                    <Composer
                      value={input}
                      onChange={setInput}
                      onSend={send}
                      sending={sending}
                      voicePhase={voicePhase}
                      onMicToggle={handleMicToggle}
                      voiceChoices={voiceChoices}
                      voiceId={voiceId}
                      onVoiceChange={changeVoice}
                      voiceError={voiceError}
                    />
                  </div>
                )}

                {turns.map((turn) => (
                  <div key={turn.key} className="mb-6">
                    {turn.divider && <SwitchedDivider mode={turn.divider} />}
                    <div className="space-y-5">
                      {turn.user && <UserBubble text={turn.user.text} />}
                      {turn.assistant && turn.assistant.text.trim() && (
                        <AssistantReply
                          message={turn.assistant}
                          onGuide={guide}
                          onSpeak={speak}
                          speaking={speakingId === turn.assistant.id}
                        />
                      )}
                    </div>
                  </div>
                ))}

                {sending && lastMsg?.role !== 'assistant' && (
                  <div className="flex items-center gap-2 text-[13px] text-vc-ink-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-vc-general" />
                    Reading your message…
                  </div>
                )}
                  </div>
              </div>

              {/* Floats above the transcript only — it never crosses the
                  composer, so it cannot sit on top of a message. */}
              {!atBottom && (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      forceBottomRef.current = true
                      scrollToBottom(true)
                    }}
                    className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-vc-line bg-vc-surface px-3 py-1.5 text-[11px] text-vc-ink-2 shadow-lg transition hover:text-vc-ink"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                    Latest
                  </button>
                </div>
              )}
            </div>

        <div className="shrink-0 px-5 pb-4">
          <div className="mx-auto w-full max-w-[860px]">
            {!isEmpty && (
              <Composer
                value={input}
                onChange={setInput}
                onSend={send}
                sending={sending}
                voicePhase={voicePhase}
                onMicToggle={handleMicToggle}
                voiceChoices={voiceChoices}
                voiceId={voiceId}
                onVoiceChange={changeVoice}
                voiceError={voiceError}
              />
            )}
            <p className={clsx('text-center text-[12px] text-vc-ink-2', !isEmpty && 'mt-2.5')}>
              {DISCLAIMER}
            </p>
          </div>
        </div>
          </div>
        </div>
      </div>

      <VoiceOverlay
        open={voiceOpen && voiceActive}
        phase={voicePhase}
        activeMode={currentMode}
        onExit={() => {
          setVoiceOpen(false)
          if (isVoiceActive()) {
            voiceTurnRef.current = null
            void stopVoice()
          }
        }}
        onMicToggle={handleMicToggle}
      />

      <UrgentHelpDialog open={urgentOpen} onClose={() => setUrgentOpen(false)} />
    </div>
  )
}
