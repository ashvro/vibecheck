export const SENTIMENT_LABELS = ['Positive', 'Neutral', 'Negative', 'Concern']

const NEGATIVE_WORDS = [
  'sad',
  'anxious',
  'anxiety',
  'stressed',
  'depressed',
  'hopeless',
  'overwhelmed',
  'lonely',
  'fail',
  'scared',
  'panic',
]

const POSITIVE_WORDS = [
  'happy',
  'grateful',
  'excited',
  'hopeful',
  'better',
  'good',
  'great',
  'proud',
  'calm',
  'motivated',
]

const CONCERN_WORDS = ['hurt myself', 'end it', 'suicidal', 'no reason to live', 'crisis']

export function analyzeSentiment(text = '') {
  const lower = text.toLowerCase()

  if (CONCERN_WORDS.some((w) => lower.includes(w))) {
    return { label: 'Concern', score: -0.95 }
  }

  let score = 0
  NEGATIVE_WORDS.forEach((w) => {
    if (lower.includes(w)) score -= 0.25
  })
  POSITIVE_WORDS.forEach((w) => {
    if (lower.includes(w)) score += 0.25
  })

  score = Math.max(-1, Math.min(1, score || 0.05))

  if (score <= -0.3) return { label: 'Negative', score }
  if (score >= 0.3) return { label: 'Positive', score }
  return { label: 'Neutral', score }
}