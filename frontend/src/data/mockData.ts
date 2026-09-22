export type SentimentLabel = 'Positive' | 'Neutral' | 'Negative' | 'Concern'

export const moodOptions = [
  { id: 'great', label: 'Great', emoji: '😊', color: 'bg-emerald-100 text-emerald-700' },
  { id: 'okay', label: 'Okay', emoji: '😐', color: 'bg-sky-100 text-sky-700' },
  { id: 'low', label: 'Low', emoji: '😔', color: 'bg-amber-100 text-amber-700' },
  { id: 'stressed', label: 'Stressed', emoji: '😰', color: 'bg-rose-100 text-rose-700' },
]

export function analyzeSentiment(text: string): { label: SentimentLabel; score: number } {
  const lower = text.toLowerCase()
  const negative = ['sad', 'anxious', 'anxiety', 'stressed', 'depressed', 'hopeless', 'overwhelmed', 'lonely', 'fail', 'scared', 'panic']
  const positive = ['happy', 'grateful', 'excited', 'hopeful', 'better', 'good', 'great', 'proud', 'calm', 'motivated']
  const concern = ['hurt myself', 'end it', 'suicidal', 'no reason to live', 'crisis']

  if (concern.some((w) => lower.includes(w))) {
    return { label: 'Concern', score: -0.95 }
  }

  let score = 0
  negative.forEach((w) => {
    if (lower.includes(w)) score -= 0.25
  })
  positive.forEach((w) => {
    if (lower.includes(w)) score += 0.25
  })

  score = Math.max(-1, Math.min(1, score || 0.05))

  if (score <= -0.3) return { label: 'Negative', score }
  if (score >= 0.3) return { label: 'Positive', score }
  return { label: 'Neutral', score }
}