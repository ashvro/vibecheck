/**
 * Emotion → valence table for the well-being sentiment score.
 *
 * The emotion classifier (`HF_EMOTION_MODEL`, default
 * SamLowe/roberta-base-go_emotions) returns a probability distribution over 28
 * emotion labels. We turn that distribution into a single 0–1 sentiment by
 * taking its *expected valence*:
 *
 *     sentiment = Σ_i  P(emotion_i) × valence(emotion_i)
 *
 * Each label's valence is its human-rated score from the NRC Valence, Arousal
 * and Dominance (NRC-VAD) lexicon, which rates English terms on a 0 (most
 * negative) to 1 (most positive) scale.
 *
 * Using published human ratings — rather than numbers chosen by us — is what
 * makes the value defensible: the only thing the model contributes is the
 * emotion distribution; the mapping from emotion to sentiment is fixed, cited
 * and reproducible. The table below is the NRC-VAD valence for the exact
 * GoEmotions label word.
 *
 * Source: Mohammad, S. M. (2018). "Obtaining Reliable Human Ratings of
 * Valence, Arousal, and Dominance for 20,000 English Words." ACL 2018.
 * Lexicon: https://saifmohammad.com/WebPages/nrc-vad.html  (NRC-VAD v1.1)
 */

/** GoEmotions label (lowercase) → NRC-VAD valence, 0 (negative) … 1 (positive). */
export const EMOTION_VALENCE = {
  admiration: 0.969,
  amusement: 0.929,
  anger: 0.167,
  annoyance: 0.167,
  approval: 0.854,
  caring: 0.635,
  confusion: 0.255,
  curiosity: 0.75,
  desire: 0.896,
  disappointment: 0.115,
  disapproval: 0.085,
  disgust: 0.052,
  embarrassment: 0.143,
  excitement: 0.896,
  fear: 0.073,
  gratitude: 0.885,
  grief: 0.07,
  joy: 0.98,
  love: 1.0,
  nervousness: 0.163,
  optimism: 0.949,
  pride: 0.729,
  realization: 0.554,
  relief: 0.844,
  remorse: 0.103,
  sadness: 0.052,
  surprise: 0.875,
  neutral: 0.469,
}

/** Citation recorded alongside every score produced by this mapping. */
export const EMOTION_VALENCE_SOURCE = 'Mohammad (2018), NRC-VAD v1.1'

/** Bumped whenever the formula or table changes, so old scores stay auditable. */
export const SENTIMENT_MODEL_VERSION = 'goemotions-nrcvad-v1'
