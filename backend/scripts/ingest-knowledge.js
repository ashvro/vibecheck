import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PDFParse } from 'pdf-parse'
import { prisma } from '../src/prisma.js'
import { embed } from '../src/utils/llm.js'
import { KNOWLEDGE_COLLECTIONS } from '../src/rag.js'

try {
  process.loadEnvFile?.()
} catch {
  /* .env may not exist — rely on existing env */
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KNOWLEDGE_ROOT = path.resolve(process.env.KNOWLEDGE_ROOT || path.join(__dirname, '..', 'data', 'knowledge'))

const SUPPORTED = new Set(['.pdf', '.txt', '.md'])

async function collectFiles(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)))
    } else if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

async function extractText(file) {
  const ext = path.extname(file).toLowerCase()
  const buf = await readFile(file)
  if (ext === '.pdf') {
    const parser = new PDFParse(new Uint8Array(buf))
    await parser.load()
    try {
      const result = await parser.getText()
      return result.text ?? ''
    } finally {
      await parser.destroy().catch(() => {})
    }
  }
  return buf.toString('utf-8')
}

function chunkText(text, size = 600, overlap = 80) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
  if (!clean) return []

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const chunks = []
  let buffer = ''

  const push = (segment) => {
    if (!segment) return
    if (segment.length <= size) {
      chunks.push(segment)
      return
    }
    let rest = segment
    while (rest.length > size) {
      let cut = rest.lastIndexOf(' ', size)
      if (cut < size * 0.6) cut = size
      chunks.push(rest.slice(0, cut).trim())
      rest = rest.slice(Math.max(0, cut - overlap)).trim()
    }
    if (rest) chunks.push(rest)
  }

  for (const para of paragraphs) {
    if (para.length >= size && buffer) {
      chunks.push(buffer)
      buffer = ''
    }
    if (!buffer) {
      buffer = para
      continue
    }
    if (buffer.length + 1 + para.length <= size) {
      buffer += ` ${para}`
    } else {
      push(buffer)
      buffer = para
    }
  }
  if (buffer) push(buffer)
  return chunks
}

function deriveMeta(root, file) {
  const rel = path.relative(root, file)
  const parts = rel.split(path.sep)
  const name = path.basename(file, path.extname(file)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const collection = parts[0] && KNOWLEDGE_COLLECTIONS.includes(parts[0]) ? parts[0] : null
  const category = parts.length >= 2 ? parts[parts.length - 2] : collection || 'general'
  const title = name || rel
  return { rel, collection, category, title }
}

async function ingestFile(root, file) {
  const { rel, collection, category, title } = deriveMeta(root, file)
  let text = ''
  try {
    text = await extractText(file)
  } catch (err) {
    return { file: rel, ok: false, chunks: 0, error: err.message }
  }

  const chunks = chunkText(text)
  if (!chunks.length) {
    return { file: rel, ok: true, chunks: 0, skipped: 'no extractable text' }
  }

  let vectors = []
  try {
    const BATCH = 60
    for (let i = 0; i < chunks.length; i += BATCH) {
      vectors.push(...(await embed(chunks.slice(i, i + BATCH))))
    }
  } catch (err) {
    return { file: rel, ok: false, chunks: 0, error: `embedding failed: ${err.message}` }
  }
  if (vectors.length !== chunks.length) {
    return { file: rel, ok: false, chunks: 0, error: `embedding count mismatch (${vectors.length} vs ${chunks.length})` }
  }

  const rows = chunks.map((chunk, i) => ({
    source: rel,
    collection: collection || 'mental_health',
    category,
    title,
    text: chunk,
    embedding: JSON.stringify(vectors[i] ?? []),
    tokens: chunk.split(/\s+/).length,
  }))

  await prisma.knowledgeChunk.deleteMany({ where: { source: rel } })
  // Insert in batches: a big textbook yields thousands of chunks, and one
  // createMany would blow past SQLite's bind-parameter limit.
  const INSERT_BATCH = 250
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await prisma.knowledgeChunk.createMany({ data: rows.slice(i, i + INSERT_BATCH) })
  }
  return { file: rel, ok: true, chunks: rows.length, category }
}

async function main() {
  const root = KNOWLEDGE_ROOT
  const files = await collectFiles(root)
  const totalBefore = await prisma.knowledgeChunk.count()
  const results = []
  const failures = []

  const sourceSet = new Set(files.map((f) => path.relative(root, f)))
  const purgeFilter =
    sourceSet.size === 0
      ? {}
      : { NOT: { source: { in: [...sourceSet] } } }
  const shouldPurge = process.env.KNOWLEDGE_PURGE !== '0'
  const purged = shouldPurge
    ? await prisma.knowledgeChunk.findMany({ where: purgeFilter, select: { source: true } })
    : []
  if (purged.length) {
    await prisma.knowledgeChunk.deleteMany({ where: purgeFilter })
  }

  console.log(`Knowledge root : ${root}`)
  console.log(`Files found     : ${files.length}${purged.length ? ` (purged ${purged.length} orphaned chunk source${purged.length === 1 ? '' : 's'})` : ''}`)
  console.log('')

  for (const file of files) {
    const res = await ingestFile(root, file)
    results.push(res)
    const marker = res.ok ? '  imported' : '  FAILED  '
    console.log(`${marker} ${res.file} → ${res.chunks} chunk${res.chunks === 1 ? '' : 's'}${res.error ? ` (${res.error})` : ''}`)
    if (!res.ok) failures.push(res)
  }

  const totalAfter = await prisma.knowledgeChunk.count()
  const importedChunks = results.filter((r) => r.ok).reduce((s, r) => s + r.chunks, 0)
  console.log('')
  console.log(`Imported chunks  : ${importedChunks}`)
  console.log(`Chunks before    : ${totalBefore}`)
  console.log(`Chunks after     : ${totalAfter}`)
  console.log(`Failures         : ${failures.length}`)
  if (failures.length) console.log(failures.map((f) => `  - ${f.file}: ${f.error}`).join('\n'))

  await prisma.$disconnect()
  process.exit(failures.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error('Ingest failed:', err)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})