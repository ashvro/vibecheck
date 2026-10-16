import {
  EMOTION_VALENCE,
  EMOTION_VALENCE_SOURCE,
  SENTIMENT_MODEL_VERSION,
} from './emotionValence.js'

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

/**
 * Reasoning effort is only accepted by the gpt-oss family on Groq — sending it
 * to other models is a hard 400, so gate on the model id.
 *
 * 'low' cuts the thinking latency noticeably. That matters twice here: the
 * classifier sits on the critical path of every reply, and streaming reply text
 * only begins once reasoning tokens are done, so a long "think" delays the
 * first spoken word.
 */
function reasoningEffortFor(model, effort) {
  if (!effort) return undefined
  return /gpt-oss/i.test(model || modelConfig.groqModel) ? effort : undefined
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
  // System prompt first, then the prior turns in chronological order, then the
  // current message. Previously the system prompt was appended *after* the
  // history, which weakened instruction-following on longer conversations.
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  for (const h of history) {
    if (h && h.role && h.content) messages.push({ role: h.role, content: String(h.content) })
  }
  if (user) messages.push({ role: 'user', content: user })
  return messages
}

export async function groqChat({ system, user, history = [], json = false, temperature = 0.4, maxTokens = 1024, signal, model, reasoningEffort }) {
  if (!hasGroq()) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 503 })

  const targetModel = model || modelConfig.groqModel
  const body = {
    model: targetModel,
    messages: buildMessages({ system, user, history }),
    temperature,
    max_tokens: maxTokens,
  }
  if (json) body.response_format = { type: 'json_object' }
  const effort = reasoningEffortFor(targetModel, reasoningEffort)
  if (effort) body.reasoning_effort = effort

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

export async function groqChatStream({ system, user, history = [], temperature = 0.4, maxTokens = 1024, onDelta, signal, reasoningEffort }) {
  if (!hasGroq()) throw Object.assign(new Error('GROQ_API_KEY not configured'), { status: 503 })

  const body = {
    model: modelConfig.groqModel,
    messages: buildMessages({ system, user, history }),
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }
  const effort = reasoningEffortFor(modelConfig.groqModel, reasoningEffort)
  if (effort) body.reasoning_effort = effort

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

export async function hfEmotionAnalysis(text) {
  const data = await hfRequest(modelConfig.emotionModel, { inputs: text })
  if (!Array.isArray(data)) throw new Error('Unexpected HF emotion response')

  const entries = Array.isArray(data[0]) ? data[0] : data
  if (!Array.isArray(entries) || !entries.length) throw new Error('No HF emotion labels returned')

  const total = entries.reduce((sum, e) => sum + (Number(e.score) || 0), 0) || 1
  const dist = entries
    .map((e) => {
      const label = String(e.label || '').toLowerCase()
      const p = (Number(e.score) || 0) / total
      return { label, p, valence: EMOTION_VALENCE[label] ?? 0.5 }
    })
    .sort((a, b) => b.p - a.p)

  const top = dist[0]
  const valence = Math.max(0, Math.min(1, dist.reduce((sum, e) => sum + e.p * e.valence, 0)))
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d

  return {
    emotion: top.label,
    sentiment: round(valence, 2),
    // Certainty in the dominant emotion: low values mean the score is a blend of
    // several emotions and should be read as softer evidence.
    confidence: round(top.p, 2),
    detail: {
      version: SENTIMENT_MODEL_VERSION,
      model: modelConfig.emotionModel,
      valenceSource: EMOTION_VALENCE_SOURCE,
      method: 'expected_valence',
      valence: round(valence, 3),
      probabilities: dist
        .slice(0, 6)
        .map((e) => ({ label: e.label, p: round(e.p, 3), valence: e.valence })),
    },
  }
}

/**
 * Preferred sentiment entry point.
 *
 * The local ONNX model needs no network or credentials, so it is tried first;
 * the hosted HF model is only used if the local one fails to load. Callers fall
 * back to the lexicon (`analyzeSentiment`) if both are unavailable.
 */
export async function analyzeEmotion(text) {
  try {
    const { localSentimentAnalysis } = await import('./localEmotion.js')
    return await localSentimentAnalysis(text)
  } catch (localErr) {
    if (hasHf()) return hfEmotionAnalysis(text)
    throw localErr
  }
}

export async function hfEmbed(texts) {
  const list = Array.isArray(texts) ? texts : [texts]
  const data = await hfRequest(modelConfig.embedModel, { inputs: list }, '?wait_for_model=true')
  if (!Array.isArray(data)) throw new Error('Unexpected HF embedding response')

  const vectors = data.length && typeof data[0] === 'number' ? [data] : data
  return Array.isArray(texts) ? vectors : (vectors[0] ?? [])
}

/**
 * Preferred embedding entry point.
 *
 * Runs the ONNX embedding model locally (no network, no credits); falls back to
 * the hosted HF model only if the local model can't be loaded.
 */
export async function embed(texts) {
  try {
    const { localEmbed } = await import('./localEmbed.js')
    return await localEmbed(texts)
  } catch (localErr) {
    if (hasHf()) return hfEmbed(texts)
    throw localErr
  }
}