const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'

const ELEVENLABS_MODEL = process.env.ELEVENLABS_VOICE_MODEL || 'eleven_flash_v2_5'
const ELEVENLABS_VOICE = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'

/**
 * Resolves the configured neural TTS provider, or null when the deployment
 * should fall back to the browser's built-in SpeechSynthesis.
 */
export function ttsProvider() {
  if (process.env.ELEVENLABS_API_KEY) return 'elevenlabs'
  return null
}

function isAbortError(err) {
  return err?.name === 'AbortError'
}

/**
 * Streams synthesized speech for a single sentence. Returns a Response whose
 * body is the audio payload, so the caller can relay it without buffering.
 */
export async function synthesizeSpeech({ text, signal }) {
  const provider = ttsProvider()
  if (!provider) throw Object.assign(new Error('No TTS provider configured'), { status: 501 })
  if (!text?.trim()) throw Object.assign(new Error('No text to synthesize'), { status: 400 })

  if (provider === 'elevenlabs') {
    const res = await fetch(`${ELEVENLABS_URL}/${ELEVENLABS_VOICE}/stream`, {
      method: 'POST',
      signal,
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    })

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '')
      const err = new Error(`TTS provider error ${res.status}: ${body.slice(0, 200)}`)
      err.status = res.status
      throw err
    }

    return { contentType: res.headers.get('content-type') || 'audio/mpeg', body: res.body }
  }

  throw Object.assign(new Error(`Unsupported TTS provider: ${provider}`), { status: 501 })
}

export { isAbortError }
