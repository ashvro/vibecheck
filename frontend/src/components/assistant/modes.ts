/**
 * The assistant's three "modes" are a presentation-layer idea, not a backend
 * concept: the pipeline only classifies `intent`, and the mockups label that
 * classification as a mode. Rather than guess at a mode field that does not
 * exist, the UI maps the intent it already receives onto the matching pill.
 */
export type AssistantMode = 'counselor' | 'tutor' | 'general'

export type ModeDef = {
  id: AssistantMode
  /** Pill label. */
  label: string
  /** Mode dot / rule colour (Tailwind token). */
  text: string
  /** Solid fill for the active pill's dot. */
  fill: string
  /** Copy for the inline "Switched to …" divider. */
  divider: string
}

export const MODES: ModeDef[] = [
  { id: 'counselor', label: 'Counselor', text: 'text-vc-counselor', fill: 'bg-vc-counselor', divider: 'you shared a worry' },
  { id: 'tutor', label: 'Tutor', text: 'text-vc-tutor', fill: 'bg-vc-tutor', divider: 'study plan requested' },
  { id: 'general', label: 'General', text: 'text-vc-general', fill: 'bg-vc-general', divider: 'general question' },
]

export const MODE_BY_ID: Record<AssistantMode, ModeDef> = {
  counselor: MODES[0],
  tutor: MODES[1],
  general: MODES[2],
}

/**
 * intent → mode. `academics` is the Tutor, `career` is answered by the same
 * General persona as small talk (see STAGE-SPECIFIC BEHAVIOUR in the backend
 * prompt), and everything else — including a failed classification — reads as
 * General.
 */
export function modeForIntent(intent?: string | null): AssistantMode {
  if (intent === 'mental_health') return 'counselor'
  if (intent === 'academics') return 'tutor'
  return 'general'
}

export function modeFor(intent?: string | null): ModeDef {
  return MODE_BY_ID[modeForIntent(intent)]
}
