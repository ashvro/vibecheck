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

// Warm the local embedding model in the background so the first academic
// message isn't delayed by a cold start (a fresh checkout downloads ~120 MB on
// first run). Failures are non-fatal — the pipeline skips retrieval.
if (process.env.EMBED_PREWARM !== 'false') {
  import('./utils/localEmbed.js')
    .then((m) => m.warmLocalEmbed())
    .catch((err) => console.warn('embedding model pre-warm failed:', err?.message || err))
}