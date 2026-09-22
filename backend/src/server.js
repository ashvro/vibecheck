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