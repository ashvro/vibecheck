import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { api } from '../../lib/api'

type SessionRow = {
  id: number
  voiceId: string | null
  creditsUsed: number
  durationSec: number
  createdAt: string
}

export function RelaxationSessionsCard({ refreshKey }: { refreshKey: number }) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .get<{ sessions: SessionRow[] }>('/api/relaxation/sessions')
      .then((data) => {
        if (!alive) return
        setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      })
      .catch(() => {
        if (!alive) return
        setSessions([])
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [refreshKey])

  return (
    <section className="relative flex min-h-[540px] flex-col overflow-hidden rounded-[28px] border border-white/10 md:min-h-[calc(100dvh-220px)]" style={{ background: 'rgba(12,9,24,.97)' }}>
      <header className="relative flex items-start justify-between gap-4 px-6 py-[17px]">
        <div className="min-w-0">
          <p className="font-mono text-[10px] leading-[15px] tracking-[0.12em] text-vc-ink-2 uppercase">
            Session history
          </p>
          <p className="font-display mt-0.5 text-[15px] leading-[23px] font-medium text-vc-rail-text">
            ElevenLabs credits
          </p>
        </div>
      </header>
      <div className="relative flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-[12px] text-vc-ink-3">Loading…</p>}
        {!loading && sessions.length === 0 && (
          <p className="text-[12px] text-vc-ink-3">No sessions yet.</p>
        )}
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-[12px] text-vc-ink-2">
                  {new Date(s.createdAt).toLocaleString()}
                </p>
                <p className="text-[11px] text-vc-ink-3">
                  {s.durationSec ? `${Math.round(s.durationSec)}s` : '—'} · {s.voiceId ? s.voiceId.slice(0, 8) : 'default'}
                </p>
              </div>
              <span className="font-mono text-[12px] text-vc-ink">{s.creditsUsed}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}