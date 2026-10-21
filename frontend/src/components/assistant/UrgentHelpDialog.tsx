import { useEffect } from 'react'
import { Phone, X } from 'lucide-react'

type Props = {
  open: boolean
  onClose: () => void
}

const LINES = [
  {
    name: 'Tele-MANAS',
    number: '14416',
    detail: 'Free, confidential mental-health support, 24/7, across India.',
  },
  {
    name: 'Emergency services',
    number: '112',
    detail: 'If you or someone else is in immediate danger.',
  },
  {
    name: 'Kiran',
    number: '1800-599-0019',
    detail: 'Government helpline, 24/7, in 13 languages.',
  },
]

/**
 * The "Need urgent help?" affordance from the mockups. It is entirely
 * client-side — the backend has no crisis endpoint — so the numbers are
 * printed and tappable rather than routed through the chat.
 */
export function UrgentHelpDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Urgent help"
        className="vc-glass-soft relative w-full max-w-md rounded-2xl border border-vc-line p-5 shadow-[var(--depth-3)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[16px] font-semibold text-vc-ink">If you need help right now</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-vc-ink-2">
              You do not have to handle this alone. These lines are free and answered by people, not machines.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close urgent help"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-vc-ink-2 transition hover:bg-vc-surface-2 hover:text-vc-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {LINES.map((line) => (
            <li
              key={line.number}
              className="flex items-center justify-between gap-3 rounded-xl border border-vc-line bg-vc-bg/40 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-vc-ink">{line.name}</p>
                <p className="text-[12px] leading-snug text-vc-ink-2">{line.detail}</p>
              </div>
              <a
                href={`tel:${line.number.replace(/[^0-9+]/g, '')}`}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-vc-bubble px-3 py-1.5 text-[12px] font-semibold text-vc-ink transition hover:bg-vc-surface-2"
              >
                <Phone className="h-3.5 w-3.5" />
                {line.number}
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[11px] leading-relaxed text-vc-ink-3">
          VibeCheck is not an emergency service and cannot contact anyone for you.
        </p>
      </div>
    </div>
  )
}
