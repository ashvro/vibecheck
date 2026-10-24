import clsx from 'clsx'
import { Loader2, Square } from 'lucide-react'
import VoiceOrb from '../VoiceOrb'
import type { VoicePhase } from '../../lib/voice'

type TranscriptLine = { id: number; role: 'agent' | 'user'; text: string }

type Props = {
  phase: VoicePhase
  elapsed: number
  voiceName?: string | null
  lines: TranscriptLine[]
  disconnecting?: boolean
  /** Optional copy override for the status hint (e.g. "Connecting to Calm…"). */
  hint?: string
  /** Live loudness for the orb, read once per animation frame. */
  getLevel: () => number
  onEnd: () => void
}

/** Copy + dot colour for each phase of the relaxation loop. */
const STATUS: Record<VoicePhase, { label: string; hint: string }> = {
  idle: { label: 'Idle', hint: 'Tap the mic to start' },
  ready: { label: 'Getting ready', hint: 'Warming up the microphone' },
  listening: { label: 'Listening', hint: 'Speak whenever you are ready' },
  processing: { label: 'Closing', hint: 'Ending the session' },
  speaking: { label: 'Speaking', hint: 'Calm is guiding you' },
}

function VoiceStatus({ phase, hint: override }: { phase: VoicePhase; hint?: string }) {
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
      </div>
      <p className="text-[13px] leading-[20px] text-vc-ink-2">{override ?? hint}</p>
    </div>
  )
}

/**
 * Immersive session stage for the Relaxation tab, modelled on the assistant's
 * voice overlay: the orb is the focus, the phase (listening / speaking) sits
 * underneath it, and the last exchange floats beneath that as a caption so the
 * session stays readable without turning the stage into a chat window.
 */
export function VoiceStage({ phase, elapsed, voiceName, lines, disconnecting, hint, getLevel, onEnd }: Props) {
  const recent = lines.slice(-2)
  const format = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Relaxation voice session"
      style={{ background: 'rgba(12,9,24,.97)' }}
    >
      {/* Soft violet pool behind the orb, matching the assistant's stage. */}
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
            Guided relaxation · {voiceName || 'CalmCoach'}
          </p>
          <p className="font-display mt-0.5 text-[15px] leading-[23px] font-medium text-vc-rail-text">
            Calm · Voice Instructor
          </p>
        </div>
        <div className="mt-[7px] flex shrink-0 items-center gap-5">
          <span className="text-[13px] leading-[23px] text-vc-ink-2 tabular-nums" aria-label="Session time">
            {format(elapsed)}
          </span>
          <button
            type="button"
            onClick={onEnd}
            className="text-[15px] leading-[23px] font-medium text-vc-rail-text transition hover:text-vc-ink"
          >
            End session
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-2">
        <VoiceOrb phase={phase} size={300} getLevel={getLevel} />
        <VoiceStatus phase={phase} hint={hint} />

      </div>

      <div className="relative flex shrink-0 flex-col items-center gap-3 pb-[34px]">
        <button
          type="button"
          onClick={onEnd}
          disabled={disconnecting}
          title="End session"
          aria-label="End relaxation session"
          className="inline-flex h-[63px] w-[63px] items-center justify-center rounded-full bg-vc-ink text-vc-bg transition hover:brightness-105 disabled:opacity-70"
        >
          {disconnecting ? (
            <Loader2 className="h-6 w-6 animate-spin" strokeWidth={2} />
          ) : (
            <Square className="h-5 w-5" strokeWidth={2} />
          )}
        </button>
        <p className="text-[12px] leading-[18px] text-vc-ink-3">
          Answer when she pauses, or use the button to end.
        </p>
      </div>
    </div>
  )
}
