import { pipeline, env } from '@huggingface/transformers'

/**
 * Source tag recorded on every score produced by the local model.
 */
export const LOCAL_SENTIMENT_SOURCE = 'twitter-roberta-sentiment-local-v1'

/**
 * CardiffNLP's `twitter-roberta-base-sentiment-latest`, converted to ONNX so it
 * runs directly in Node — no inference API, no account, no credits, fully
 * offline after the first download. ~120 MB quantised, well under a second to
 * load once cached, and deterministic for a given input.
 *
 * Source: Barbieri, F., et al. (2020). "TweetEval: Unified Benchmark and
 * Comparative Evaluation for Tweet Classification." Findings of EMNLP 2020.
 */
const MODEL = process.env.LOCAL_SENTIMENT_MODEL || 'Xenova/twitter-roberta-base-sentiment-latest'

// Keep weights inside the backend (git-ignored) so they survive restarts.
env.cacheDir =
  process.env.TRANSFORMERS_CACHE || new URL('../../.cache/transformers', import.meta.url).pathname

let classifierPromise = null

/** Lazily build the pipeline; a failed load is retried on the next call. */
function classifier() {
  if (!classifierPromise) {
    classifierPromise = pipeline('text-classification', MODEL, { dtype: 'q8' })
    classifierPromise.catch(() => {
      classifierPromise = null
    })
  }
  return classifierPromise
}

/** Optional boot-time warm-up so the first well-being message isn't delayed. */
export async function warmLocalSentiment() {
  await classifier()
}

const round = (value, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits

/**
 * Local neural sentiment. Returns the same shape as `hfEmotionAnalysis` so the
 * pipeline can use either interchangeably.
 *
 * sentiment = P(positive) + 0.5 × P(neutral)   → 0 (negative) … 1 (positive)
 *
 * i.e. the probability mass the classifier puts on positive, counting neutral
 * as half. The full probability breakdown is kept as evidence.
 */
export async function localSentimentAnalysis(text) {
  const clf = await classifier()
  const out = await clf(text, { top_k: null })

  const probs = { positive: 0, neutral: 0, negative: 0 }
  for (const entry of out) {
    const label = String(entry.label).toLowerCase()
    if (label in probs) probs[label] = entry.score
  }

  const sentiment = probs.positive + 0.5 * probs.neutral
  const top = out.reduce((a, b) => (b.score > a.score ? b : a))

  return {
    emotion: String(top.label).toLowerCase(),
    sentiment: round(sentiment, 2),
    confidence: round(top.score, 2),
    detail: {
      version: LOCAL_SENTIMENT_SOURCE,
      model: MODEL,
      method: 'P(positive) + 0.5 * P(neutral)',
      probs: {
        negative: round(probs.negative),
        neutral: round(probs.neutral),
        positive: round(probs.positive),
      },
      sentiment: round(sentiment),
    },
  }
}
