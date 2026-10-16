import { prisma } from './prisma.js'
import { embed } from './utils/llm.js'

export const KNOWLEDGE_COLLECTIONS = ['mental_health', 'career', 'academics']

export const KNOWLEDGE_CATEGORIES = [
  'stress',
  'exam_stress',
  'anxiety',
  'low_mood',
  'loneliness',
  'sleep',
  'emotional_regulation',
  'self_care',
  'relaxation',
  'coping',
  'self_help',
  'professional_support',
  'wellbeing',
  'safety',
]

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'that', 'this', 'with',
  'have', 'has', 'was', 'were', 'from', 'they', 'them', 'their', 'what', 'when',
  'where', 'who', 'how', 'will', 'would', 'can', 'could', 'should', 'about',
  'because', 'just', 'like', 'than', 'into', 'onto', 'more', 'much', 'been', 'had',
])

const CATEGORY_RULES = [
  ['crisis_safety', ['suicide', 'suicidal', 'kill myself', 'hurt myself', 'harm myself', 'self harm', 'self-harm', 'end my life', 'don\'t want to be alive', 'do not want to be alive', 'no reason to live', 'end it all', 'take my own life']],
  ['exam_stress', ['exam', 'exams', 'test week', 'finals', 'assessment', 'exam season', 'board exam']],
  ['stress', ['stress', 'stressed', 'overwhelm', 'overwhelmed', 'pressure', 'burnout', 'can\'t handle', 'panic', 'psyching']],
  ['anxiety', ['anxiety', 'anxious', 'worry', 'worrying', 'nervous', 'panic', 'fear', 'phobia', 'racing thoughts']],
  ['sleep', ['sleep', 'insomnia', 'tired', 'can\'t sleep', 'cannot sleep', 'restless', 'exhausted']],
  ['loneliness', ['lonely', 'alone', 'isolated', 'no friends', 'empty', 'left out']],
  ['low_mood', ['sad', 'depressed', 'hopeless', 'down', 'low', 'unmotivated', 'blue', 'stuck']],
  ['self_care', ['self care', 'self-care', 'take care of myself', 'routine', 'break', 'rest']],
  ['relaxation', ['relax', 'calm', 'breathe', 'breathing', 'meditation', 'mindfulness', 'unwind']],
  ['coping', ['cope', 'coping', 'deal with', 'manage', 'get through', 'cope with']],
  ['professional_support', ['counsellor', 'counseling', 'counselor', 'therapy', 'therapist', 'psychologist', 'psychiatrist', 'doctor', 'professional help']],
  ['emotional_regulation', ['angry', 'frustrated', 'emotions', 'mood swings', 'irritable', 'overreact', 'rage']],
]

export function detectSupportCategory(text = '') {
  const lower = text.toLowerCase()
  for (const [cat, patterns] of CATEGORY_RULES) {
    if (patterns.some((p) => lower.includes(p))) return cat
  }
  return null
}

/**
 * Academic subject hints for the four textbooks ingested under `academics/`.
 * Used to boost chunks from the likely subject, so a "deadlock" question leans
 * on the OS textbook rather than whichever book happens to share a word.
 */
const SUBJECT_RULES = [
  ['dsa', ['data structure', 'algorithm', 'algorithms', 'dsa', 'array', 'arrays', 'linked list', 'binary tree', 'binary search tree', 'graph', 'sorting', 'quicksort', 'mergesort', 'stack', 'queue', 'heap', 'hash', 'recursion', 'dynamic programming', 'big o', 'time complexity', 'space complexity', 'traversal']],
  ['dbms', ['dbms', 'database', 'databases', 'sql', 'normalization', 'normal form', '1nf', '2nf', '3nf', 'bcnf', 'boyce-codd', 'first normal', 'second normal', 'third normal', 'transaction', 'acid', 'relational', 'er diagram', 'entity relationship', 'indexing', 'primary key', 'foreign key', 'sql query', 'relational algebra', 'concurrency control']],
  ['os', ['operating system', 'operating systems', 'process scheduling', 'scheduling', 'deadlock', 'paging', 'virtual memory', 'page replacement', 'thread', 'threads', 'semaphore', 'mutex', 'cpu scheduling', 'context switch', 'file system', 'memory management', 'round robin', 'thrashing']],
  ['cns', ['computer network', 'computer networks', 'networking', 'cns', 'tcp', 'udp', 'ip address', 'osi', 'routing', 'subnet', 'ethernet', 'dns', 'http', 'socket', 'packet', 'router', 'network layer', 'transport layer', 'application layer', 'data link', 'congestion control', 'sliding window']],
]

export function detectSubject(text = '') {
  const lower = text.toLowerCase()
  for (const [subject, patterns] of SUBJECT_RULES) {
    if (patterns.some((p) => lower.includes(p))) return subject
  }
  return null
}

export function cosine(a, b) {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function tokenize(text) {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9][a-z0-9']*/g) || []).filter((t) => t.length > 2 && !STOP_WORDS.has(t)),
  )
}

function lexicalScore(query, text) {
  const q = tokenize(query)
  if (!q.size) return 0
  const t = tokenize(text)
  if (!t.size) return 0
  let hits = 0
  for (const tok of q) if (t.has(tok)) hits += 1
  return hits / Math.sqrt(q.size)
}

function normalizeCategory(cat) {
  return cat === 'crisis_safety' ? 'safety' : cat
}

/**
 * Page markers ("-- 8 of 232 --") and near-empty fragments carry no meaning and
 * otherwise waste a retrieval slot.
 */
function isJunkChunk(text = '') {
  const t = text.trim()
  if (t.length < 25) return true
  return /^[-–—_\s]*\d+\s*(?:of|\/)\s*\d+[-–—_\s]*$/i.test(t)
}

export function loadChunks({ collections, categories } = {}) {
  const where = {}
  if (collections && collections.length) where.collection = { in: collections }
  if (categories && categories.length) where.category = { in: categories }
  return prisma.knowledgeChunk.findMany({ where, orderBy: { id: 'asc' } })
}

export async function retrieve(query, { collections, boosts = null, topK = 4 } = {}) {
  const chunks = await loadChunks({ collections })
  if (!chunks.length) {
    return { results: [], bestScore: 0, total: chunks.length }
  }

  let queryVec
  try {
    const [vec] = await embed(query)
    queryVec = vec
  } catch {
    return { results: [], bestScore: 0, total: chunks.length }
  }
  if (!Array.isArray(queryVec) || !queryVec.length) {
    return { results: [], bestScore: 0, total: chunks.length }
  }

  const boostSet = boosts ? new Set(boosts.map(normalizeCategory)) : null

  const scored = []
  for (const chunk of chunks) {
    if (isJunkChunk(chunk.text)) continue
    let embed = null
    try {
      embed = JSON.parse(chunk.embedding)
    } catch {
      embed = null
    }
    const vec = Array.isArray(embed) ? cosine(queryVec, embed) : 0
    const lex = lexicalScore(query, chunk.text)
    const base = 0.7 * vec + 0.3 * Math.min(1, lex)
    let score = base
    if (boostSet && boostSet.has(normalizeCategory(chunk.category))) score += 0.15
    scored.push({ chunk, vector: vec, lexical: lex, score, boosted: score !== base })
  }

  scored.sort((a, b) => b.score - a.score)
  const results = scored.slice(0, topK).map((r) => ({
    id: r.chunk.id,
    source: r.chunk.source,
    category: r.chunk.category,
    title: r.chunk.title,
    text: r.chunk.text,
    vectorScore: Math.round(r.vector * 100) / 100,
    lexicalScore: Math.round(r.lexical * 100) / 100,
    score: Math.round(r.score * 100) / 100,
  }))

  return { results, bestScore: scored[0]?.score ?? 0, total: chunks.length }
}

/**
 * Widen each hit with its immediate neighbours from the same source, then merge
 * runs of adjacent chunks back into one passage. Small chunks keep retrieval
 * precise, but a definition or a bulleted list (e.g. "Advantages of DBMS")
 * usually spans several of them, so the model needs the surrounding window
 * rather than isolated fragments.
 */
async function expandContext(hits, { radius = 1 } = {}) {
  const byId = new Map()
  for (const hit of hits) {
    const rows = await prisma.knowledgeChunk.findMany({
      where: { source: hit.source, id: { gte: hit.id - radius, lte: hit.id + radius } },
      orderBy: { id: 'asc' },
    })
    for (const row of rows) {
      if (isJunkChunk(row.text) || byId.has(row.id)) continue
      byId.set(row.id, {
        id: row.id,
        source: row.source,
        category: row.category,
        title: row.title,
        text: row.text,
        score: hit.score,
        vectorScore: hit.vectorScore,
        lexicalScore: hit.lexicalScore,
      })
    }
  }

  const ordered = [...byId.values()].sort(
    (a, b) => a.source.localeCompare(b.source) || a.id - b.id,
  )

  const merged = []
  for (const row of ordered) {
    const prev = merged[merged.length - 1]
    if (prev && prev.source === row.source && row.id - prev.lastId <= 1) {
      prev.text += ` ${row.text}`
      prev.lastId = row.id
      prev.score = Math.max(prev.score, row.score)
    } else {
      merged.push({ ...row, lastId: row.id })
    }
  }
  return merged
    .map(({ lastId, ...rest }) => rest)
    .sort((a, b) => b.score - a.score)
}

export const SUFFICIENCY_THRESHOLD = 0.3

export async function resolveEvidence({ intent, message, category }) {
  if (intent === 'general') return { results: [], used: false, attempts: 1 }

  let collections
  let boosts = null
  let subject = null

  if (intent === 'mental_health') {
    collections = ['mental_health']
    const related = ['wellbeing', 'self_help', 'coping', 'safety']
    if (category) {
      const cat = normalizeCategory(category)
      if (KNOWLEDGE_CATEGORIES.includes(cat)) related.push(cat)
    }
    boosts = related
  } else {
    collections = [intent]
    if (intent === 'academics') {
      subject = detectSubject(message)
      if (subject) boosts = [subject]
    }
  }

  // Academic answers benefit from a couple more fragments, since a single
  // textbook topic is often spread across several small chunks.
  const topK = intent === 'academics' ? 5 : 4

  let attempt = await retrieve(message, { collections, boosts, topK })
  const sufficiencyCheck = attempt.results.length > 0 && attempt.bestScore >= SUFFICIENCY_THRESHOLD

  if (!sufficiencyCheck) {
    const reformulated =
      intent === 'mental_health'
        ? `${message} support coping strategies self care wellbeing`
        : `${message}${subject ? ` ${subject}` : ''} ${intent} textbook explanation key concepts definition`
    attempt = await retrieve(reformulated, { collections, boosts, topK })
  }

  const used = attempt.results.length > 0 && attempt.bestScore >= SUFFICIENCY_THRESHOLD
  const results = used
    ? await expandContext(attempt.results, { radius: intent === 'academics' ? 2 : 1 })
    : attempt.results
  return { results, used, attempts: 2, total: attempt.total }
}

export function formatEvidence(results, limit = 4) {
  if (!results || !results.length) return ''
  return results
    .slice(0, limit)
    .map(
      (r, i) =>
        `[Doc ${i + 1}] title: ${r.title} · category: ${r.category} · relevance: ${r.score}\n${r.text.slice(0, 1600)}`,
    )
    .join('\n\n')
}

export async function knowledgeStatus() {
  const groups = await prisma.knowledgeChunk.groupBy({ by: ['category'], _count: { _all: true } })
  const byCategory = Object.fromEntries(groups.map((g) => [g.category, g._count._all]))
  return {
    byCategory,
    total: groups.reduce((sum, g) => sum + g._count._all, 0),
    collections: KNOWLEDGE_COLLECTIONS,
  }
}