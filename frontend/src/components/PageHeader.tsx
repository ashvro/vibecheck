import { CrystalMark } from './CrystalMark'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="border-b border-line pb-6">
      {eyebrow && (
        <div className="mb-3 flex items-center gap-3">
          <CrystalMark spinOnView />
          <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">{eyebrow}</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        {!eyebrow && <CrystalMark spinOnView className="mt-1" />}
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
      </div>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    </div>
  )
}
