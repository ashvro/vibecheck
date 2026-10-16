import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { CrystalMark } from '../CrystalMark'
import {
  mlApi,
  mlRiskStyles,
  type MlModelInfo,
  type MlPrediction,
  type MlRisk,
} from '../../lib/ml'

const RISK_ORDER: MlRisk[] = ['Low', 'Medium', 'High']

function ProbBar({ prediction }: { prediction: MlPrediction }) {
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-ice/10">
      {RISK_ORDER.map((r) => (
        <div
          key={r}
          className={mlRiskStyles[r].bar}
          style={{ width: `${prediction.probabilities[r] ?? 0}%` }}
          title={`${r} ${prediction.probabilities[r] ?? 0}%`}
        />
      ))}
    </div>
  )
}

function PredictForm() {
  const [sentiment, setSentiment] = useState(0.6)
  const [attendance, setAttendance] = useState(75)
  const [cgpa, setCgpa] = useState(7)
  const [out, setOut] = useState<MlPrediction | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      setOut(await mlApi.predict({ sentiment, attendance, cgpa }))
    } catch {
      setOut(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={run} className="mt-4 max-w-lg space-y-3">
      {(
        [
          { label: 'Well-being sentiment', value: sentiment, min: 0, max: 1, step: 0.01, set: setSentiment, suffix: '' },
          { label: 'Attendance', value: attendance, min: 0, max: 100, step: 1, set: setAttendance, suffix: '%' },
          { label: 'CGPA', value: cgpa, min: 0, max: 10, step: 0.1, set: setCgpa, suffix: ' / 10' },
        ] as const
      ).map((f) => (
        <div key={f.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">{f.label}</span>
            <span className="font-mono tabular-nums text-ink">
              {f.value}
              {f.suffix}
            </span>
          </div>
          <input
            type="range"
            min={f.min}
            max={f.max}
            step={f.step}
            value={f.value}
            onChange={(e) => f.set(Number(e.target.value))}
            className="w-full accent-violet"
          />
        </div>
      ))}

      <button
        type="submit"
        disabled={busy}
        className="rounded-lg border border-ice/25 bg-ice/[0.08] px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ice/40 disabled:opacity-50"
      >
        {busy ? 'Predicting…' : 'Run prediction'}
      </button>

      {out && (
        <div className="mt-4 rounded-xl border border-ice/10 bg-white/[0.03] p-3.5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              Predicted risk
            </span>
            <span
              className={clsx(
                'px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                mlRiskStyles[out.risk].chip,
              )}
            >
              {out.risk} · {out.confidence}%
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            Risk score <span className="font-semibold tabular-nums text-ink">{out.score}</span> / 100
          </p>
          <div className="mt-2.5">
            <ProbBar prediction={out} />
            <div className="mt-1.5 flex justify-between font-mono text-[8px] tracking-[0.1em] text-muted uppercase">
              {RISK_ORDER.map((r) => (
                <span key={r}>
                  {r} {out.probabilities[r] ?? 0}%
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </form>
  )
}

/**
 * The model lab: what the classifier is, how it was chosen, and a sandbox to
 * score hypothetical students. The per-student table is not here - it lives in
 * /api/analytics/insights, which is role-scoped, so it can never drift out of
 * step with what a given viewer is allowed to see.
 */
export function MlRiskPanel() {
  const [info, setInfo] = useState<MlModelInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    mlApi
      .modelInfo()
      .then(setInfo)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted">Loading dropout-risk model…</p>
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <CrystalMark size="sm" spinOnView />
          <h2 className="text-sm font-semibold text-ink">ML dropout-risk model</h2>
          {info && (
            <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              {info.primaryModel} · v{info.version} · {info.accuracyTest}% acc
            </span>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Trained on {info?.dataset.rows ?? 0} student records ({info?.dataset.trainRows ?? 0} train /{' '}
          {info?.dataset.testRows ?? 0} test). Features — attendance, well-being sentiment and CGPA — are
          combined by a fitted classifier. This is the only risk model in the product, so the numbers on the
          tables above and the score in the sandbox below come from the same predictor.
        </p>

        {info && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(
                [
                  { label: 'Marks (CGPA)', value: info.labelWeights.marks },
                  { label: 'Attendance', value: info.labelWeights.attendance },
                  { label: 'Well-being Sentiment', value: info.labelWeights.sentiment },
                ] as const
              ).map((f) => (
                <div key={f.label} className="rounded-xl border border-ice/10 bg-white/[0.03] px-3.5 py-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">{f.label}</span>
                    <span className="font-semibold tabular-nums text-ink">
                      {Math.round(f.value * 100)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden bg-ice/10">
                    <div className="h-full bg-violet-soft" style={{ width: `${f.value * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Cut-points are the training-set 33rd/66th percentiles (risk ≤{' '}
              {Math.round(info.thresholds.q1 * 100)} → Low, ≤ {Math.round(info.thresholds.q2 * 100)} → Medium,
              above → High). Missing features are imputed with the training mean and flagged below.
            </p>
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="flex items-center gap-2.5">
            <CrystalMark size="sm" spinOnView />
            <h2 className="text-sm font-semibold text-ink">Test the model</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Move the sliders to score an arbitrary student through the deployed classifier.
          </p>
          <PredictForm />
        </div>

        {info && info.studyResults.length > 0 && (
          <div>
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="text-sm font-semibold text-ink">Model selection study</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              All 8 classifiers benchmarked during training. Logistic Regression was chosen for deployment: it
              tied for best accuracy and ports exactly to the JS runtime.
            </p>
            <ul className="mt-4 space-y-1.5">
              {info.studyResults.map((m) => {
                const deployed = m.model === info.primaryModel
                return (
                  <li key={m.model} className="flex items-center gap-3">
                    <span
                      className={clsx(
                        'w-44 shrink-0 truncate text-[11px]',
                        deployed ? 'font-semibold text-ink' : 'text-muted',
                      )}
                      title={m.model}
                    >
                      {m.model.replace(' (XGBoost substitute)', ' (GB)')}
                    </span>
                    <span className="h-1 flex-1 overflow-hidden bg-ice/10">
                      <span
                        className={clsx('block h-full', deployed ? 'bg-violet-soft' : 'bg-ice/40')}
                        style={{ width: `${m.accuracy}%` }}
                      />
                    </span>
                    <span
                      className={clsx(
                        'w-12 shrink-0 text-right font-mono text-[10px] tabular-nums',
                        deployed ? 'font-semibold text-ink' : 'text-muted',
                      )}
                    >
                      {m.accuracy}%
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
