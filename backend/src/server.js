import http from 'http'
import { createApp } from './app.js'
import { initSocketIO } from './socket.js'

try {
  process.loadEnvFile?.()
} catch {
  /* .env missing — rely on pre-existing env vars */
}

const PORT = process.env.PORT || 4000
const app = createApp()
const server = http.createServer(app)
initSocketIO(server)

server.listen(PORT, () => {
  console.log(`VibeCheck API listening on http://localhost:${PORT}`)
})

// Warm the local sentiment + embedding models in the background so the first
// well-being or academic message isn't delayed by a cold start (a fresh
// checkout downloads ~120 MB each on first run). Failures are non-fatal — the
// pipeline falls back to the lexicon / skips retrieval.
if (process.env.SENTIMENT_PREWARM !== 'false') {
  import('./utils/localEmotion.js')
    .then((m) => m.warmLocalSentiment())
    .catch((err) => console.warn('sentiment model pre-warm failed:', err?.message || err))
  import('./utils/localEmbed.js')
    .then((m) => m.warmLocalEmbed())
    .catch((err) => console.warn('embedding model pre-warm failed:', err?.message || err))
}