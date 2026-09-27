import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { BrainCircuit, type LucideIcon } from 'lucide-react'
import { mlApi, mlRiskStyles, type MlSummary } from '../../lib/ml'

const LEVELS = ['Low', 'Medium', 'High'] as const

/**
 * Dashboard card for the ML dropout-risk model.
 *
 * Deliberately a separate card from the existing attendance-based "Risk" card,
 * so the current dashboard behaviour is untouched.
 */
export function MlRiskCard() {
  const [summary, setSummary] = useState<MlSummary | null>(null)

  useEffect(() => {
    mlApi
      .summary()
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [])

  const latest = summary?.latest ?? null
  const position = latest ? LEVELS.indexOf(latest.risk) : 0
  const score = latest?.score ?? null

  return (
    <div className="glass-ice rounded-xl px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-ice/15 bg-ice/[0.06] text-ice">
          <BrainCircuit className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">ML Risk</p>
      </div>

      {latest ? (
        <>
          <p className="mt-3 flex items-baseline gap-1.5 text-xl font-semibold tracking-tight text-ink">
            <span className={clsx('font-display tabular-nums', mlRiskStyles[latest.risk].text)}>
              {latest.risk}
            </span>
            {score != null && <span className="text-xs font-normal text-muted">{score} / 100</span>}
          </p>

          <div className="mt-2.5">
            <div className="relative h-1.5 rounded-full bg-gradient-to-r from-emerald-soft/40 via-amber-gentle/40 to-rose-400/40">
              <span
                className={clsx(
                  'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-thaw-deep',
                  position === 2 ? 'left-[98%] bg-rose-400' : position === 1 ? 'left-1/2 bg-amber-gentle' : 'left-[2%] bg-emerald-soft',
                )}
              />
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[8px] tracking-[0.1em] text-muted uppercase">
              {LEVELS.map((lvl) => (
                <span key={lvl}>{lvl}</span>
              ))}
            </div>
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            {summary?.model} · {latest.confidence}% confidence
            {latest.imputed.length > 0 && ` · imputed ${latest.imputed.length} feature(s)`}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">No prediction yet.</p>
      )}
    </div>
  )
}

export const MlRiskIcon: LucideIcon = BrainCircuit
