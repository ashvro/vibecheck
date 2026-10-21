import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ArrowUp, Check, ChevronDown, Loader2, Mic, Plus, Square, Volume2 } from 'lucide-react'
import type { VoicePhase } from '../../lib/voice'

type Props = {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  disabled?: boolean
  voicePhase: VoicePhase
  onMicToggle: () => void
  voiceChoices: Array<{ id: string; name: string }>
  voiceId: string | null
  onVoiceChange: (id: string | null) => void
  voiceError: string | null
}

/**
 * The single rounded panel from the mockups: message on top, controls beneath.
 * Voice picking keeps its old home at the bottom-right — the mockup's speaker
 * + name + chevron reads as a menu, so it is one.
 */
export function Composer({
  value,
  onChange,
  onSend,
  sending,
  disabled,
  voicePhase,
  onMicToggle,
  voiceChoices,
  voiceId,
  onVoiceChange,
  voiceError,
}: Props) {
  const [voiceMenu, setVoiceMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const voiceActive = voicePhase !== 'idle'
  const selected = voiceChoices.find((v) => v.id === voiceId) ?? voiceChoices[0]

  useEffect(() => {
    if (!voiceMenu) return
    function onDoc(e: PointerEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setVoiceMenu(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [voiceMenu])

  /* Grow the textarea with its content, up to a ceiling. */
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [value])

  return (
    <div className="vc-glass-plum rounded-[22px] border border-vc-line-strong transition focus-within:border-vc-check">
      <textarea
        ref={taRef}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSend()
          }
        }}
        disabled={disabled || sending}
        placeholder="Message VibeCheck"
        aria-label="Message VibeCheck"
        className="block max-h-40 min-h-[68px] w-full resize-none bg-transparent px-5 pt-4 pb-1.5 text-[15px] leading-[22px] text-vc-ink outline-none placeholder:text-vc-ink-2 disabled:opacity-60"
      />

      <div className="flex h-12 items-center gap-2 px-3 pb-3">
        <button
          type="button"
          title="Attach (coming soon)"
          aria-label="Attach a file"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-vc-ink-2 transition hover:bg-vc-bubble hover:text-vc-ink"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>

        <div className="ml-auto flex items-center gap-1">
          {voiceChoices.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setVoiceMenu((v) => !v)}
                title="Assistant voice"
                aria-haspopup="listbox"
                aria-expanded={voiceMenu}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[12px] text-vc-ink-2 transition hover:bg-vc-bubble hover:text-vc-ink"
              >
                <Volume2 className="h-3.5 w-3.5" />
                <span className="max-w-[92px] truncate">{selected?.name ?? 'Voice'}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {voiceMenu && (
                <ul
                  role="listbox"
                  className="absolute right-0 bottom-9 z-20 max-h-64 w-48 overflow-y-auto rounded-xl border border-vc-line bg-vc-surface-2 p-1 shadow-xl"
                >
                  {voiceChoices.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={v.id === (selected?.id ?? '')}
                        onClick={() => {
                          onVoiceChange(v.id)
                          setVoiceMenu(false)
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-vc-ink transition hover:bg-vc-bubble"
                      >
                        <span className="truncate">{v.name}</span>
                        {v.id === (selected?.id ?? '') && <Check className="h-3 w-3 shrink-0 text-vc-general" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onMicToggle}
            disabled={voicePhase === 'processing'}
            title={voiceActive ? 'Back to text' : 'Start a voice conversation'}
            aria-label={voiceActive ? 'Stop voice conversation' : 'Start a voice conversation'}
            className={clsx(
              'inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-50',
              voiceActive
                ? 'voice-pulse bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'text-vc-ink-2 hover:bg-vc-bubble hover:text-vc-ink',
            )}
          >
            {voicePhase === 'processing' || voicePhase === 'ready' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : voiceActive ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Mic className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>

          <button
            type="button"
            onClick={onSend}
            disabled={sending || !value.trim()}
            aria-label="Send message"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-vc-bubble text-vc-ink transition hover:bg-vc-surface-2 disabled:opacity-45"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {voiceError && (
        <p className="border-t border-vc-line px-5 py-2 text-[11px] text-rose-300">{voiceError}</p>
      )}
    </div>
  )
}

export const DISCLAIMER =
  "VibeCheck is an AI and can make mistakes. It's not a substitute for professional support."
