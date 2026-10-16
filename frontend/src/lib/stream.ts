import { getToken } from './api'

export type StreamSource = {
  title?: string | null
  label: string
  source: string
  category?: string | null
}

export type StreamMeta = {
  intent?: string | null
  riskLevel?: string | null
  sentimentScore?: number | null
  emotion?: string | null
  sources?: StreamSource[]
}

type DonePayload = {
  reply: string
  meta?: StreamMeta
  session?: { id: number }
}

export type StreamHandlers = {
  onTranscript?: (text: string) => void
  onMeta?: (meta: StreamMeta) => void
  onDelta?: (text: string) => void
  onRevision?: (text: string) => void
  onDone?: (data: DonePayload) => void
}

type StreamOptions = StreamHandlers & {
  signal: AbortSignal
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function decodeChunk(value: Uint8Array, stream: TextDecoder): string {
  return stream.decode(value, { stream: true })
}

async function readEventStream(
  res: Response,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  if (!res.body) throw new Error('Streaming is not supported in this browser.')
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const message = (data as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : `Request failed (${res.status}).`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (event: string, raw: string) => {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return
    }
    const payload = data as Record<string, unknown>

    switch (event) {
      case 'transcript':
        handlers.onTranscript?.(String(payload.text ?? ''))
        break
      case 'meta':
        handlers.onMeta?.(payload.meta as StreamMeta)
        break
      case 'delta':
        handlers.onDelta?.(String(payload.text ?? ''))
        break
      case 'revision':
        handlers.onRevision?.(String(payload.text ?? ''))
        break
      case 'done':
        handlers.onDone?.(payload as unknown as DonePayload)
        break
      case 'error':
        throw new Error(String(payload.message ?? 'The assistant could not complete this turn.'))
      default:
        break
    }
  }

  const flushFrames = (chunk: string, final: boolean) => {
    buffer += chunk
    const frames = buffer.split('\n\n')
    if (!final) buffer = frames.pop() ?? ''
    else buffer = ''

    for (const frame of frames) {
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) dispatch(event, dataLines.join('\n'))
    }
  }

  try {
    while (true) {
      if (signal.aborted) return
      const { done, value } = await reader.read()
      if (done) break
      flushFrames(decodeChunk(value, decoder), false)
    }
    flushFrames(decoder.decode(), true)
  } finally {
    reader.releaseLock()
  }
}

export async function streamChat({ message, sessionId, signal, ...handlers }: StreamOptions & {
  message: string
  sessionId: number | null
}): Promise<void> {
  const res = await fetch('/api/assistant/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message, sessionId }),
    signal,
  })
  await readEventStream(res, handlers, signal)
}

export async function streamVoice({ audio, sessionId, signal, ...handlers }: StreamOptions & {
  audio: Blob
  sessionId: number | null
}): Promise<void> {
  const form = new FormData()
  form.append('audio', audio, 'voice.wav')
  if (sessionId != null) form.append('sessionId', String(sessionId))

  const res = await fetch('/api/assistant/voice/stream', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal,
  })
  await readEventStream(res, handlers, signal)
}
