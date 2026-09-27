const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_STT_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
const HF_URL = (process.env.HF_BASE_URL || 'https://router.huggingface.co/hf-inference').replace(/\/+$/, '')

export const modelConfig = {
  groqKey: process.env.GROQ_API_KEY || '',
  hfKey: process.env.HF_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  groqFastModel: process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
  groqSttModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  emotionModel: process.env.HF_EMOTION_MODEL || 'SamLowe/roberta-base-go_emotions',
  embedModel: process.env.HF_EMBED_MODEL || 'BAAI/bge-base-en-v1.5',
}

export function hasGroq() {
  return !!modelConfig.groqKey
}

export function hasHf() {
  return !!modelConfig.hfKey
}

function abortError() {
  return Object.assign(new Error('Request aborted'), { name: 'AbortError' })
}

async function fetchWithTimeout(url, options = {}, ms = 30000, externalSignal = null) {
  const RETRYABLE = new Set([429, 500, 502, 503, 504])
  let lastErr = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (externalSignal?.aborted) throw abortError()

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    const onExternalAbort = () => ctrl.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
        err.status = res.status
        if (RETRYABLE.has(res.status) && attempt < 2) {
          await new Promise((r) => setTimeout(r, (attempt + 1) * 1200))
          lastErr = err
          continue
        }
        throw err
      }
      return res
    } catch (err) {
      if (externalSignal?.aborted) throw abortError()
      if (err.name === 'AbortError' && attempt < 2) {
        lastErr = err
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1200))
        continue
      }
      throw err
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }
  throw lastErr ?? new Error('Request failed')
}

function extractJson(content) {
  const cleaned = content.replace(/```(?:json)?/g, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error('Could not parse JSON from model response')
}

function buildMessages({ system, user, history = [] }) {
  const messages = []
  for (const h of history) {
    if (h && h.role && h.content) messages.push({ role: h.role, content: String(h.content) })
  }
  if (system) messages.push({ role: 'system', content: system })
  if (user) messages.push({ role: 'user', content: user })
  return messages
}

export async function groqChat({ system, user, history = [], json = false, temperature = 0.4, maxTokens = 1024, signal, model }) {
  if (!hasGroq()) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 503 })

  const body = {
    model: model || modelConfig.groqModel,
    messages: buildMessages({ system, user, history }),
    temperature,
    max_tokens: maxTokens,
  }
  if (json) body.response_format = { type: 'json_object' }

  const res = await fetchWithTimeout(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${modelConfig.groqKey}`,
    },
    body: JSON.stringify(body),
  }, 45000, signal)

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('GROQ returned no content')
  if (json) return extractJson(content)
  return content
}

export async function groqChatStream({ system, user, history = [], temperature = 0.4, maxTokens = 1024, onDelta, signal }) {
  if (!hasGroq()) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 503 })

  const body = {
    model: modelConfig.groqModel,
    messages: buildMessages({ system, user, history }),
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }

  const res = await fetchWithTimeout(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${modelConfig.groqKey}`,
    },
    body: JSON.stringify(body),
  }, 45000, signal)

  if (!res.body) throw new Error('GROQ returned an empty stream')

  const decoder = new TextDecoder()
  let pending = ''
  let full = ''

  for await (const chunk of res.body) {
    if (signal?.aborted) throw abortError()
    pending += decoder.decode(chunk, { stream: true })

    const lines = pending.split('\n')
    pending = lines.pop() ?? ''

    for (const line of lines) {
      const frame = line.trim()
      if (!frame.startsWith('data:')) continue
      const payload = frame.slice(5).trim()
      if (payload === '[DONE]') return full
      if (!payload) continue

      let delta
      try {
        delta = JSON.parse(payload)?.choices?.[0]?.delta
      } catch {
        continue
      }
      // Reasoning models emit delta.reasoning alongside delta.content — only take content.
      const content = typeof delta?.content === 'string' ? delta.content : ''
      if (!content) continue
      full += content
      onDelta?.(content, full)
    }
  }

  if (pending.startsWith('data:')) {
    const payload = pending.slice(5).trim()
    if (payload && payload !== '[DONE]') {
      try {
        const content = JSON.parse(payload)?.choices?.[0]?.delta?.content
        if (typeof content === 'string' && content) {
          full += content
          onDelta?.(content, full)
        }
      } catch {
        /* trailing partial frame — ignore */
      }
    }
  }

  return full
}

export async function groqTranscribe({ buffer, mimeType = 'audio/wav', filename = 'voice.wav', signal }) {
  if (!hasGroq()) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 503 })

  const form = new FormData()
  form.append('model', modelConfig.groqSttModel)
  form.append('file', new Blob([buffer], { type: mimeType }), filename)

  const res = await fetchWithTimeout(GROQ_STT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${modelConfig.groqKey}` },
    body: form,
  }, 45000, signal)

  const data = await res.json()
  const text = typeof data?.text === 'string' ? data.text.trim() : ''
  if (!text) throw new Error('Groq returned no transcript')
  return text
}

export async function hfRequest(model, payload, params = '', timeoutMs = 45000) {
  if (!hasHf()) throw Object.assign(new Error('HF_API_KEY not configured'), { status: 503 })

  const url = `${HF_URL}/models/${model}${params}`
  let lastErr = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${modelConfig.hfKey}`,
        },
        body: JSON.stringify(payload),
      }, timeoutMs)
      return await res.json()
    } catch (err) {
      lastErr = err
      if (err.status === 503) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1500))
        continue
      }
      throw err
    }
  }
  throw lastErr
}

const EMOTION_VALENCE = {
  admiration: 0.8, amusement: 0.9, anger: 0.2, annoyance: 0.25, approval: 0.8,
  caring: 0.85, confusion: 0.45, curiosity: 0.6, desire: 0.75, disappointment: 0.2,
  disapproval: 0.2, disgust: 0.1, embarrassment: 0.35, excitement: 0.9, fear: 0.15,
  gratitude: 0.85, grief: 0.1, joy: 0.95, love: 0.95, nervousness: 0.25,
  optimism: 0.85, pride: 0.85, realization: 0.65, relief: 0.8, remorse: 0.35,
  sadness: 0.15, surprise: 0.6, neutral: 0.5,
}

export async function hfEmotionAnalysis(text) {
  const data = await hfRequest(modelConfig.emotionModel, { inputs: text })
  if (!Array.isArray(data)) throw new Error('Unexpected HF emotion response')

  const entries = Array.isArray(data[0]) ? data[0] : data
  if (!Array.isArray(entries) || !entries.length) throw new Error('No HF emotion labels returned')

  let top = null
  for (const entry of entries) {
    if (!top || entry.score > top.score) top = { label: entry.label.toLowerCase(), score: entry.score }
  }
  if (!top) throw new Error('No HF emotion label computed')

  const weighted = entries.reduce(
    (sum, e) => sum + (EMOTION_VALENCE[e.label.toLowerCase()] ?? 0.5) * e.score,
    0,
  )
  const sentiment = Math.max(0, Math.min(1, weighted))
  return { emotion: top.label, sentiment: Math.round(sentiment * 100) / 100 }
}

export async function hfEmbed(texts) {
  const list = Array.isArray(texts) ? texts : [texts]
  const data = await hfRequest(modelConfig.embedModel, { inputs: list }, '?wait_for_model=true')
  if (!Array.isArray(data)) throw new Error('Unexpected HF embedding response')

  const vectors = data.length && typeof data[0] === 'number' ? [data] : data
  return Array.isArray(texts) ? vectors : (vectors[0] ?? [])
}