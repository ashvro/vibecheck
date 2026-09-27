import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const VOICE_ASSET_DIRS = ['/ort', '/vad']

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
}

/**
 * onnxruntime-web loads its WASM runtime through a dynamic import, and Vite
 * rewrites that to `<path>?import`. Files under /public are served as-is and
 * must not go through the transform pipeline, so Vite rejects the request.
 * This serves the voice assets from disk before that pipeline runs.
 */
function voiceAssets(): Plugin {
  return {
    name: 'vibecheck:voice-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()

        const [rawPath] = req.url.split('?')
        const urlPath = decodeURIComponent(rawPath)
        const dir = VOICE_ASSET_DIRS.find((prefix) => urlPath.startsWith(`${prefix}/`))
        if (!dir) return next()

        const publicRoot = resolve(server.config.publicDir)
        const filePath = join(publicRoot, normalize(urlPath))
        if (!filePath.startsWith(publicRoot + '/')) return next()
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return next()

        res.setHeader(
          'Content-Type',
          CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
        )
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), voiceAssets()],
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
      },
    },
  },
})
