import clsx from 'clsx'
import { MODES } from './modes'

/**
 * The mode pills under the pipeline label. They are status indicators for the
 * current conversation's intent, not switches — the backend routes by intent
 * on its own, so there is nothing to toggle here.
 */
export function ModePills({ active, className }: { active: string; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-[18px]', className)}>
      {MODES.map((mode) => {
        const on = mode.id === active
        return (
          <span
            key={mode.id}
            title={
              on
                ? `Current focus: ${mode.label}`
                : `Focus becomes ${mode.label} when that is what your message needs`
            }
            className={clsx(
              'inline-flex h-5 items-center gap-1.5 text-[12px] font-medium',
              on ? 'rounded-full bg-vc-surface-2 px-2.5 text-vc-ink' : 'text-vc-ink-2',
            )}
          >
            <span
              className={clsx(
                'h-2 w-2 shrink-0 rounded-full',
                on ? mode.fill : clsx('border border-current', mode.text),
              )}
            />
            {mode.label}
          </span>
        )
      })}
    </div>
  )
}
