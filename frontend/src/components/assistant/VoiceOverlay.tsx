import clsx from 'clsx'
import { ChevronDown, Mic, Volume2, X } from 'lucide-react'
import { ModePills } from './ModePills'
import VoiceOrb from '../VoiceOrb'
import type { VoicePhase } from '../../lib/voice'

type Props = {
  open: boolean
  phase: VoicePhase
  activeMode: string
  onExit: () => void
  onMicToggle: () => void
  /** Voices the agent can speak with; hidden when the deployment has none. */
  voiceChoices?: Array<{ id: string; name: string }>
  voiceId?: string | null
  onVoiceChange?: (id: string) => void
}

/** Copy + accent for each phase of the voice loop. */
const STATUS: Record<VoicePhase, { label: string; hint: string }> = {
  idle: { label: 'Idle', hint: 'Tap the mic to start' },
  ready: { label: 'Getting ready', hint: 'Warming up the microphone' },
  listening: { label: 'Listening', hint: 'Speak whenever you are ready' },
  processing: { label: 'Thinking', hint: 'Working on your reply' },
  speaking: { label: 'Speaking', hint: 'Tap the mic to interrupt' },
}

/**
 * The live status line under the orb. Shows the phase in a large serif face
 * with a small hint beneath it, plus three pulsing dots while the agent is
 * thinking so a pause in audio never looks like a freeze.
 */
function VoiceStatus({ phase }: { phase: VoicePhase }) {
  const { label, hint } = STATUS[phase]
  return (
    <div
      className="pointer-events-none flex flex-col items-center gap-1.5 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3">
        <span
          className={clsx(
            'vc-status-dot h-2 w-2 rounded-full',
            phase === 'listening' && 'bg-vc-general',
            phase === 'processing' && 'bg-vc-tutor',
            phase === 'speaking' && 'bg-vc-ink',
            (phase === 'idle' || phase === 'ready') && 'bg-vc-ink-3',
          )}
        />
        <span className="vc-status-label font-display text-[26px] leading-none font-medium tracking-tight text-vc-ink">
          {label}
        </span>
        {phase === 'processing' && (
          <span className="flex items-end gap-[3px]" aria-hidden>
            <span className="vc-status-dot h-1 w-1 rounded-full bg-vc-ink-2" />
            <span className="vc-status-dot h-1 w-1 rounded-full bg-vc-ink-2" />
            <span className="vc-status-dot h-1 w-1 rounded-full bg-vc-ink-2" />
          </span>
        )}
      </div>
      <p className="text-[13px] leading-[20px] text-vc-ink-2">{hint}</p>
    </div>
  )
}

/**
 * The voice stage. The mockups drop the rail and the composer entirely while
 * listening/speaking, so this covers the whole app shell: the pipeline label and
 * pills stay top-left with "Back to text" top-right, a large orb sits in the
 * middle, and the mic / close controls sit at the bottom.
 *
 * The mockups were measured at 2x on a 1280x820 viewport: the lit sphere is
 * 300px across while listening and 360px while speaking, its centre sits at
 * y=385 (halfway between the header and the bottom controls), and the controls
 * are a 63.5px mic pill plus a close glyph.
 */
export function VoiceOverlay({
  open,
  phase,
  activeMode,
  onExit,
  onMicToggle,
  voiceChoices = [],
  voiceId,
  onVoiceChange,
}: Props) {
  return (
    <div
      className={clsx(
        'fixed inset-0 z-50 flex flex-col overflow-hidden transition-opacity duration-300',
        open ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{
        background: 'rgba(12,9,24,.97)',
      }}
      aria-hidden={!open}
    >
      {/* Soft violet pool behind the orb — deepens the top and leaves the
          corners near-black so the sphere is the brightest thing on screen. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 58% at 50% 46%, rgba(109, 90, 208, 0.22), rgba(78, 56, 160, 0.08) 48%, rgba(16, 11, 26, 0) 76%)',
        }}
      />

      <header className="relative flex shrink-0 items-start justify-between gap-4 py-[17px] pr-[38px] pl-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] leading-[15px] tracking-[0.12em] text-vc-ink-2 uppercase">
            Intent-aware · Safety-first pipeline
          </p>
          <ModePills active={activeMode} className="mt-0.5" />
        </div>
        <button
          type="button"
          onClick={onExit}
          className="mt-[9px] shrink-0 text-[15px] leading-[23px] font-medium text-vc-rail-text transition hover:text-vc-ink"
        >
          Back to text
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-7 pb-4">
        <VoiceOrb phase={phase} size={300} />
        {/* What the agent is doing right now, so a short pause never reads as
            the app being stuck. */}
        <VoiceStatus phase={phase} />

        {/* The composer lives behind the overlay, so the multi-voice picker is
            repeated here: otherwise the only way to change the agent's voice
            is to leave voice mode first. */}
        {voiceChoices.length > 0 && onVoiceChange && (
          <label
            title="Assistant voice"
            className="flex items-center gap-2 rounded-full border border-vc-line bg-vc-surface/60 px-3.5 py-2 text-[12px] text-vc-ink-2 backdrop-blur-sm transition hover:bg-vc-surface-2/70"
          >
            <Volume2 className="h-3.5 w-3.5 shrink-0" />
            <span className="sr-only">Assistant voice</span>
            <select
              value={voiceId ?? voiceChoices[0]?.id ?? ''}
              onChange={(e) => onVoiceChange(e.target.value)}
              aria-label="Assistant voice"
              className="max-w-[220px] cursor-pointer appearance-none truncate bg-transparent pr-0.5 text-[12px] text-vc-ink outline-none"
            >
              {voiceChoices.map((v) => (
                <option key={v.id} value={v.id} className="bg-vc-surface-2 text-vc-ink">
                  {v.name}
                </option>
              ))}
            </select>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </label>
        )}
      </div>

      <div className="relative flex shrink-0 items-center justify-center gap-10 pb-[42px]">
        <button
          type="button"
          onClick={onMicToggle}
          title="Stop voice"
          aria-label="Stop voice conversation"
          className="inline-flex h-[63px] w-[63px] items-center justify-center rounded-[22px] border border-vc-line-strong bg-vc-surface/70 text-vc-ink backdrop-blur-sm transition hover:bg-vc-surface-2"
        >
          <Mic className="h-6 w-6" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onExit}
          title="Back to text"
          aria-label="Back to text"
          className="inline-flex h-[63px] w-[63px] items-center justify-center rounded-full bg-vc-ink text-vc-bg transition hover:brightness-105"
        >
          <X className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
