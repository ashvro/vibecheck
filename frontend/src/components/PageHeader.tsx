import { CrystalMark } from './CrystalMark'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  /** Rendered opposite the title — a scope badge, count, or action. */
  aside?: React.ReactNode
}

export function PageHeader({ eyebrow, title, description, aside }: PageHeaderProps) {
  return (
    <div className="hairline-grad relative overflow-hidden border-b border-line pb-6">
      {/* Soft aurora bloom lifting the header off the page plane. */}
      <span
        className="pointer-events-none absolute -top-28 -right-20 h-60 w-60 rounded-full bg-violet/15 blur-3xl"
        aria-hidden
      />

      {eyebrow && (
        <div className="relative mb-3 flex items-center gap-3">
          <CrystalMark spinOnView />
          <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">{eyebrow}</p>
        </div>
      )}

      <div className="relative flex flex-wrap items-center gap-3">
        {!eyebrow && <CrystalMark spinOnView className="mt-1" />}
        <h1 className="bg-gradient-to-r from-frost via-ice-bright to-ice bg-clip-text font-display text-2xl font-bold tracking-tight text-transparent drop-shadow-[0_0_24px_rgba(139,92,246,0.25)]">
          {title}
        </h1>
        {aside ? <div className="ml-auto">{aside}</div> : null}
      </div>

      {description && <p className="relative mt-1 text-sm text-muted">{description}</p>}
    </div>
  )
}
