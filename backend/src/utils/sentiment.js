import { readFileSync } from 'node:fs'

export const SENTIMENT_LABELS = ['Positive', 'Neutral', 'Negative', 'Concern']

/** Recorded alongside a fallback score so its provenance is never guessed. */
export const LEXICON_SENTIMENT_SOURCE = 'vibecheck-vader-v1'

/**
 * VADER sentiment lexicon: token → mean human sentiment rating on a −4
 * (extremely negative) … +4 (extremely positive) scale.
 *
 * The fallback uses a purpose-built *sentiment* lexicon rather than general
 * valence norms, because valence norms rate every word (including "table" and
 * "attendance") and averaging them drowns the signal. VADER only contains
 * sentiment-bearing tokens — "good" 1.9, "great" 3.1, "sad" −2.1, "hopeless"
 * −2.0 — so a message's score is traceable to the exact words that carry it.
 *
 * Source: Hutto, C. J., & Gilbert, E. E. (2014). "VADER: A Parsimonious
 * Rule-based Model for Sentiment Analysis of Social Media Text." ICWSM-14.
 * Lexicon: https://github.com/cjhutto/vaderSentiment (MIT)
 */
const LEXICON = new Map(
  Object.entries(JSON.parse(readFileSync(new URL('./vader.json', import.meta.url), 'utf8'))),
)

/** Crisis phrasing is matched as phrases, before token scoring. */
const CONCERN_PHRASES = ['hurt myself', 'end it', 'suicidal', 'no reason to live', 'crisis']

/** Tokens that flip the polarity of the next sentiment word. */
const NEGATORS = new Set([
  'not',
  'no',
  'never',
  'none',
  'nobody',
  'nothing',
  'neither',
  'nor',
  'nowhere',
  'cannot',
  'without',
  'barely',
  'hardly',
  'scarcely',
])

/** Contracted negators ("don't", "can't", "isn't") tokenise with the n't tail. */
function isNegator(word) {
  return NEGATORS.has(word) || word.endsWith("n't")
}

/** VADER's NEGATE constant: a negated token is scaled to −0.74× its weight. */
const NEGATE = -0.74
const NEGATION_WINDOW = 3
const MAX_WEIGHT = 4

/** Cheap stem lookup so "feeling"/"failed"/"hopelessly" still resolve. */
function lookup(token) {
  if (LEXICON.has(token)) return LEXICON.get(token)
  const candidates = []
  if (token.endsWith('ing')) candidates.push(token.slice(0, -3), `${token.slice(0, -3)}e`)
  if (token.endsWith('ed')) candidates.push(token.slice(0, -2), token.slice(0, -1))
  if (token.endsWith('ly')) candidates.push(token.slice(0, -2))
  if (token.endsWith('s')) candidates.push(token.slice(0, -1))
  for (const c of candidates) {
    if (c && LEXICON.has(c)) return LEXICON.get(c)
  }
  return null
}

/**
 * Lexicon fallback, used only when the hosted emotion model is unavailable.
 *
 * sentiment = mean( VADER weight of each matched sentiment word ), rescaled from
 * −4…+4 to −1…+1, where a word preceded by a negator within three tokens is
 * flipped to −0.74× its weight (VADER's own negation rule). Every contribution
 * is returned in `detail.hits`, so a value can always be traced back to the
 * exact words and human ratings behind it.
 */
export function analyzeSentiment(text = '') {
  const lower = String(text).toLowerCase()

  const concern = CONCERN_PHRASES.find((w) => lower.includes(w))
  if (concern) {
    return {
      label: 'Concern',
      score: -0.95,
      confidence: 0.95,
      source: LEXICON_SENTIMENT_SOURCE,
      detail: { method: 'lexicon', phrase: concern, hits: [] },
    }
  }

  const words = lower.match(/[a-z']+/g) ?? []
  const hits = []
  // A negator flips the *next* sentiment word only (not every word in a window),
  // so "cannot stop crying" negates "stop" but leaves "crying" negative. The
  // window expires after NEGATION_WINDOW ordinary tokens.
  let negateIn = 0
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]
    if (isNegator(word)) {
      negateIn = NEGATION_WINDOW
      continue
    }
    const weight = lookup(word)
    if (weight === null) {
      if (negateIn > 0) negateIn -= 1
      continue
    }
    const negated = negateIn > 0
    negateIn = 0
    const adjusted = negated ? weight * NEGATE : weight
    hits.push({
      term: word,
      weight,
      negated,
      adjusted: Math.round(adjusted * 100) / 100,
    })
  }

  if (!hits.length) {
    return {
      label: 'Neutral',
      score: 0,
      confidence: 0.1,
      source: LEXICON_SENTIMENT_SOURCE,
      detail: { method: 'lexicon', hits: [] },
    }
  }

  const mean = hits.reduce((sum, h) => sum + h.adjusted, 0) / hits.length
  const score = Math.max(-1, Math.min(1, mean / MAX_WEIGHT))

  // Confidence tracks how many sentiment words agreed; one keyword is weak
  // evidence and the value says so rather than hiding behind a default.
  const confidence = Math.min(0.9, 0.35 + 0.15 * hits.length)

  const label = score <= -0.3 ? 'Negative' : score >= 0.3 ? 'Positive' : 'Neutral'
  return {
    label,
    score: Math.round(score * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    source: LEXICON_SENTIMENT_SOURCE,
    detail: { method: 'lexicon', hits },
  }
}
