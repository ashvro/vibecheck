import { pipeline, env } from '@huggingface/transformers'

/**
 * Local ONNX embedding model, so retrieval works without the paid HF Inference
 * API. Same family as the configured `HF_EMBED_MODEL` (BAAI/bge-base-en-v1.5),
 * so vectors stay 768-dim and comparable to the ones already stored.
 *
 * Source: Xiao, S., et al. (2023). "C-Pack: Packed Resources for General Chinese
 * Embeddings" (BGE). Model: BAAI/bge-base-en-v1.5.
 */
const MODEL = process.env.LOCAL_EMBED_MODEL || 'Xenova/bge-base-en-v1.5'
export const LOCAL_EMBED_SOURCE = 'bge-base-en-v1.5-local'

env.cacheDir =
  process.env.TRANSFORMERS_CACHE || new URL('../../.cache/transformers', import.meta.url).pathname

let extractorPromise = null

function extractor() {
  if (!extractorPromise) {
    // Mean pooling + L2 normalisation → one unit vector per input, which is what
    // cosine similarity expects.
    extractorPromise = pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    extractorPromise.catch(() => {
      extractorPromise = null
    })
  }
  return extractorPromise
}

/** Optional boot-time warm-up. */
export async function warmLocalEmbed() {
  await extractor()
}

/** Embed one or many texts; always returns an array of vectors. */
export async function localEmbed(texts) {
  const list = Array.isArray(texts) ? texts : [texts]
  const ex = await extractor()
  const out = await ex(list, { pooling: 'mean', normalize: true })
  // `out.tolist()` → [ [..768..], ... ] for a batch, or [ [..768..] ] for one.
  return out.tolist()
}
