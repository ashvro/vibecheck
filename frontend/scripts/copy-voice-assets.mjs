import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const vadDist = resolve(root, 'node_modules/@ricky0123/vad-web/dist')
const ortDist = resolve(root, 'node_modules/onnxruntime-web/dist')

const assets = [
  [resolve(vadDist, 'silero_vad_v5.onnx'), resolve(root, 'public/vad/silero_vad_v5.onnx')],
  [resolve(vadDist, 'vad.worklet.bundle.min.js'), resolve(root, 'public/vad/vad.worklet.bundle.min.js')],
  // vad-web imports "onnxruntime-web/wasm", which resolves to ort.wasm.min.js
  // and requests the NON-jsep pair. The .jsep files belong to the WebGPU
  // bundle and will 404 here.
  [resolve(ortDist, 'ort-wasm-simd-threaded.mjs'), resolve(root, 'public/ort/ort-wasm-simd-threaded.mjs')],
  [resolve(ortDist, 'ort-wasm-simd-threaded.wasm'), resolve(root, 'public/ort/ort-wasm-simd-threaded.wasm')],
]

for (const [from, to] of assets) {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
  console.log('copied', to.replace(`${root}/`, ''))
}
