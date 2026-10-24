import clsx from 'clsx'
import { Loader2, Mic, Play } from 'lucide-react'
import VoiceOrb from '../VoiceOrb'
import type { InstructorVoice } from '../../lib/instructor'
import type { VoicePhase } from '../../lib/voice'

type TranscriptLine = { id: number; role: 'agent' | 'user'; text: string }

type Props = {
  voiceName?: string | null
  voices: InstructorVoice[]
  voiceId: string
  voicesLoading: boolean
  onVoiceChange: (id: string) => void
  onStart: () => void
  ended: boolean
  active?: boolean
  phase?: VoicePhase
  elapsed?: number
  onEnd?: () => void
  getLevel?: () => number
  lines: TranscriptLine[]
  error?: string | null
}

/**
 * The resting face of the Relaxation tab: the same dark orb stage the session
 * uses, with the start control right under it. Nothing else competes with the
 * orb, so pressing start feels like stepping straight into the session.
 */
export function VoiceIntroStage({
  voiceName, voices, voiceId, voicesLoading, onVoiceChange, onStart, ended, lines, error,
  active, phase, elapsed, onEnd, getLevel,
}: Props) {
  const StartIcon = ended ? Play : Mic
  const recent = ended ? lines.slice(-2) : []

  return (
    <section
      className="relative flex min-h-[540px] flex-col overflow-hidden rounded-[28px] border border-white/10 md:min-h-[calc(100dvh-220px)]"
      style={{ background: 'rgba(12,9,24,.97)' }}
      aria-label="Relaxation voice session"
    >
      {/* Same violet pool as the live stage so start -> session is seamless. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 62% 58% at 50% 46%, rgba(109, 90, 208, 0.22), rgba(78, 56, 160, 0.08) 48%, rgba(16, 11, 26, 0) 76%)',
        }}
      />

      <header className="relative flex flex-wrap items-start justify-between gap-4 px-6 py-[17px]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] leading-[15px] tracking-[0.12em] text-vc-ink-2 uppercase">
            Guided relaxation · {voiceName || 'CalmCoach'}
          </p>
          <p className="font-display mt-0.5 text-[15px] leading-[23px] font-medium text-vc-rail-text">
            Calm · Voice Instructor
          </p>
        </div>
        <span className="mt-[5px] flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-vc-ink-2">
          <span className="h-1.5 w-1.5 rounded-full bg-vc-general" />
          Slow · Medium · Fast
        </span>
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 py-6">
        <VoiceOrb phase={active ? (phase ?? "idle") : "idle"} size={260} getLevel={getLevel ?? (() => 0)} />
        <div
          className="pointer-events-none flex flex-col items-center gap-1.5 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                'h-2 w-2 rounded-full',
                ended ? 'bg-vc-ink-3' : 'bg-vc-general',
              )}
            />
            <span className="font-display text-[26px] leading-none font-medium tracking-tight text-vc-ink">
              {active ? (phase === 'speaking' ? 'Speaking' : phase === 'listening' ? 'Listening' : 'Getting ready') : ended ? 'Session complete' : 'Ready'}
            </span>
          </div>
          <p className="text-[13px] leading-[20px] text-vc-ink-2">
            {ended
              ? 'Come back whenever you are stressed or exhausted.'
              : 'Find a quiet spot, then press start.'}
          </p>
        </div>

        {recent.length > 0 && (
          <div className="w-full max-w-xl space-y-1.5 text-center" aria-live="polite">
            {recent.map((row) => (
              <p
                key={row.id}
                className={clsx(
                  'line-clamp-2 text-[13px] leading-5',
                  row.role === 'user' ? 'text-vc-ink-3' : 'text-vc-ink-2',
                )}
              >
                <span className="font-mono mr-2 text-[9px] tracking-[0.12em] uppercase opacity-60">
                  {row.role === 'user' ? 'You' : 'Calm'}
                </span>
                {row.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="relative flex shrink-0 flex-col items-center gap-4 px-6 pb-8">
        {active ? (
          <button
            type="button"
            onClick={onEnd}
            className="inline-flex items-center gap-2 rounded-full bg-vc-ink px-7 py-3.5 text-[14px] font-semibold text-vc-bg shadow-[0_14px_40px_-14px_rgba(139,92,246,0.8)] transition hover:brightness-105"
          >
            End session
          </button>
        ) : (
          <button
            type="button"
            onClick={onStart}
            disabled={voicesLoading || !voiceId}
            className="inline-flex items-center gap-2 rounded-full bg-vc-ink px-7 py-3.5 text-[14px] font-semibold text-vc-bg shadow-[0_14px_40px_-14px_rgba(139,92,246,0.8)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {voicesLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <StartIcon className="h-4 w-4" />
            )}
            {voicesLoading ? 'Loading voices…' : ended ? 'Start again' : 'Start session'}
          </button>
        )}

        <label className="flex items-center gap-2 text-[12px] text-vc-ink-3">
          <span>Voice</span>
          <select
            value={voiceId}
            onChange={(e) => onVoiceChange(e.target.value)}
            disabled={voicesLoading}
            className="max-w-[220px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[12px] text-vc-ink outline-none transition focus:border-white/25 disabled:opacity-50"
          >
            {voicesLoading && <option>Loading voices…</option>}
            {voices.map((v) => (
              <option key={v.voice_id} value={v.voice_id} className="bg-[#17122b] text-white">
                {v.name}{v.labels?.gender ? ` · ${v.labels.gender}` : ''}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="max-w-md text-center text-[12px] leading-[18px] text-rose-300">
            {error}
          </p>
        )}

        {ended && lines.length > 0 && (
          <details className="w-full max-w-md">
            <summary className="mx-auto w-fit cursor-pointer text-[12px] text-vc-ink-3 transition hover:text-vc-ink-2">
              Session transcript
            </summary>
            <div className="mt-3 max-h-36 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left">
              {lines.map((row) => (
                <p
                  key={row.id}
                  className={clsx(
                    'text-[12px] leading-[18px]',
                    row.role === 'user' ? 'text-vc-ink-3' : 'text-vc-ink-2',
                  )}
                >
                  <span className="font-mono mr-2 text-[9px] tracking-[0.12em] uppercase opacity-60">
                    {row.role === 'user' ? 'You' : 'Calm'}
                  </span>
                  {row.text}
                </p>
              ))}
            </div>
          </details>
        )}

        <p className="text-center text-[12px] leading-[18px] text-vc-ink-3">
          Live &amp; adaptive · answer at the pauses · a short guided session
        </p>
      </div>
    </section>
  )
}
