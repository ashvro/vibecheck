import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import { ArrowLeft, Plus, Search, Send, Trash2, Users, X } from 'lucide-react'
import { CrystalMark } from '../../components/CrystalMark'
import { PageHeader } from '../../components/PageHeader'
import { api, getUser } from '../../lib/api'
import { connectSocket } from '../../lib/socket'

type Club = {
  id: number
  name: string
  description: string
  members: number
  tags: string[]
  accent: string
  banner: string | null
  ownerId: number | null
  createdAt: string
}

type ClubMessage = {
  id: number
  clubId: number
  author: string
  body: string
  createdAt: string
  userId: number | null
}

const categories = ['All', 'Wellness', 'Tech', 'Academic', 'Arts', 'Service', 'Support']

const catStyles: Record<string, string> = {
  Wellness: 'bg-emerald-soft/15 text-emerald-soft border-emerald-soft/25',
  Tech: 'bg-violet/15 text-violet-soft border-violet/30',
  Academic: 'bg-amber-gentle/15 text-amber-gentle border-amber-gentle/30',
  Arts: 'bg-ice/10 text-ice border-ice/20',
  Service: 'bg-sky-400/10 text-sky-400 border-sky-400/30',
  Support: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
}

const categoryAccent: Record<string, string> = {
  Wellness: '#0D9488',
  Tech: '#8b5cf6',
  Academic: '#d97706',
  Arts: '#b8a4e0',
  Service: '#38bdf8',
  Support: '#f43f5e',
}

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function parseClub(raw: Record<string, unknown>): Club {
  const tagsRaw = raw.tags
  let tags: string[] = []
  if (typeof tagsRaw === 'string') {
    try {
      tags = JSON.parse(tagsRaw)
    } catch {
      tags = []
    }
  } else if (Array.isArray(tagsRaw)) {
    tags = tagsRaw.map(String)
  }
  return {
    id: Number(raw.id ?? 0),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    members: Number(raw.members ?? 0),
    tags,
    accent: String(raw.accent ?? '#8b5cf6'),
    banner: raw.banner ? String(raw.banner) : null,
    ownerId: raw.ownerId ? Number(raw.ownerId) : null,
    createdAt: String(raw.createdAt ?? ''),
  }
}

function timeStr(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function ClubsPage() {
  const [clubs, setClubs] = useState<Club[]>([])
  const [joinedIds, setJoinedIds] = useState<number[]>([])
  const [activeClub, setActiveClub] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Record<number, ClubMessage[]>>({})
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [sort, setSort] = useState<'Popular' | 'A–Z'>('Popular')
  const [showCreate, setShowCreate] = useState(false)
  const [draftClub, setDraftClub] = useState({
    name: '',
    banner: '',
    description: '',
    category: 'Wellness' as string,
  })

  const me = getUser()

  const refresh = useCallback(async () => {
    try {
      const [all, joined] = await Promise.all([
        api.get<Record<string, unknown>[]>('/api/clubs'),
        api.get<Record<string, unknown>[]>('/api/clubs/joined'),
      ])
      const parsed = all.map(parseClub)
      if (typeof joined === 'object' && joined !== null && !Array.isArray(joined) && (joined as Record<string, unknown>).error) {
        setClubs(parsed)
        setJoinedIds([])
        return
      }
      setClubs(parsed)
      setJoinedIds(Array.isArray(joined) ? joined.map((j) => Number((j as Record<string, unknown>).id)) : [])
    } catch {
      setClubs([])
      setJoinedIds([])
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (activeClub === null) return
    const socket = connectSocket()
    socket.emit('club:join', activeClub)
    return () => {
      socket.emit('club:leave', activeClub)
    }
  }, [activeClub])

  useEffect(() => {
    const socket = connectSocket()

    const onMessage = (message: ClubMessage) => {
      setMessages((prev) => {
        const list = prev[message.clubId] ?? []
        if (list.some((m) => m.id === message.id)) return prev
        return { ...prev, [message.clubId]: [...list, message] }
      })
    }
    const onClubNew = (raw: Record<string, unknown>) => {
      const club = parseClub(raw)
      setClubs((prev) => (prev.some((c) => c.id === club.id) ? prev : [club, ...prev]))
    }
    const onClubDeleted = (payload: { id: number }) => {
      setClubs((prev) => prev.filter((c) => c.id !== payload.id))
      setJoinedIds((prev) => prev.filter((x) => x !== payload.id))
      setMessages((prev) => {
        const next = { ...prev }
        delete next[payload.id]
        return next
      })
      setActiveClub((prev) => (prev === payload.id ? null : prev))
    }
    const onClubUpdated = (payload: { id: number; members: number }) => {
      setClubs((prev) => prev.map((c) => (c.id === payload.id ? { ...c, members: payload.members } : c)))
    }

    socket.on('message:new', onMessage)
    socket.on('club:new', onClubNew)
    socket.on('club:deleted', onClubDeleted)
    socket.on('club:updated', onClubUpdated)

    return () => {
      socket.off('message:new', onMessage)
      socket.off('club:new', onClubNew)
      socket.off('club:deleted', onClubDeleted)
      socket.off('club:updated', onClubUpdated)
    }
  }, [])

  const allClubs = clubs

  const myClubs = allClubs.filter((c) => joinedIds.includes(c.id))

  const discovered = useMemo(() => {
    let list = allClubs.filter((c) => {
      const matchesCat = catFilter === 'All' || c.tags.some((t) => t === catFilter)
      const q = query.trim().toLowerCase()
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        (c.tags[0] ?? '').toLowerCase().includes(q)
      return matchesCat && matchesQuery
    })
    if (sort === 'Popular') list = [...list].sort((a, b) => b.members - a.members)
    else list = [...list].sort((a, b) => a.name.localeCompare(b.name))
    return list
  }, [allClubs, catFilter, query, sort])

  const active = activeClub !== null ? allClubs.find((c) => c.id === activeClub) ?? null : null
  const activeMsgs = active ? messages[active.id] ?? [] : []

  async function toggleJoin(id: number) {
    const already = joinedIds.includes(id)
    try {
      if (already) {
        await api.del(`/api/clubs/${id}/join`)
        setJoinedIds((prev) => prev.filter((x) => x !== id))
        setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, members: Math.max(0, c.members - 1) } : c)))
      } else {
        const result = await api.post<{ joined: boolean; members: number }>(`/api/clubs/${id}/join`)
        setJoinedIds((prev) => [...prev, id])
        setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, members: result.members } : c)))
      }
    } catch {
      /* unchanged on failure */
    }
  }

  async function openClub(id: number) {
    setActiveClub(id)
    setMessages((prev) => {
      if (prev[id]) return prev
      api
        .get<ClubMessage[]>(`/api/clubs/${id}/messages`)
        .then((msgs) => setMessages((inner) => ({ ...inner, [id]: msgs })))
        .catch(() => {})
      return prev
    })
  }

  async function sendMessage(e: FormEvent) {
    e.preventDefault()
    if (!active || !draft.trim()) return
    const body = draft.trim()
    setDraft('')
    try {
      const created = await api.post<ClubMessage>(`/api/clubs/${active.id}/messages`, { body })
      setMessages((prev) => {
        const list = prev[active.id] ?? []
        if (list.some((m) => m.id === created.id)) return prev
        return { ...prev, [active.id]: [...list, created] }
      })
    } catch {
      /* drop on failure */
    }
  }

  async function createClub() {
    const name = draftClub.name.trim()
    if (!name || !draftClub.description.trim()) return
    try {
      const created = await api.post<Record<string, unknown>>('/api/clubs', {
        name,
        description: draftClub.description.trim(),
        tags: [draftClub.category],
        accent: categoryAccent[draftClub.category] ?? '#8b5cf6',
        banner: draftClub.banner.trim() || null,
      })
      const club = parseClub(created)
      setClubs((prev) => [club, ...prev])
      setJoinedIds((prev) => [...prev, club.id])
      setDraftClub({ name: '', banner: '', description: '', category: 'Wellness' })
      setShowCreate(false)
    } catch {
      /* unchanged on failure */
    }
  }

  const myRole = me?.role
  const canDelete = (club: Club) => myRole === 'admin' || (!!me && club.ownerId === Number(me.id))

  async function deleteClub(id: number, name: string) {
    if (!window.confirm(`Delete the club "${name}"? This removes its members and messages.`)) return
    try {
      await api.del(`/api/clubs/${id}`)
      setClubs((prev) => prev.filter((c) => c.id !== id))
      setJoinedIds((prev) => prev.filter((x) => x !== id))
      setMessages((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      if (activeClub === id) setActiveClub(null)
    } catch {
      /* unchanged on failure */
    }
  }

  /* ---------- Chat room: 70/30 split ---------- */
  if (active) {
    const otherClubs = discovered.filter((c) => c.id !== active.id)
    return (
      <div className="mx-auto max-w-6xl">
        <button
          type="button"
          onClick={() => setActiveClub(null)}
          className="mb-5 flex items-center gap-2 text-sm font-semibold text-muted transition hover:text-ice"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to clubs
        </button>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]">
          <div className="glass-ice overflow-hidden rounded-xl">
            <div className="flex items-center gap-3 border-b border-line/70 p-4">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                style={{ backgroundColor: `${active.accent}2e`, color: active.accent }}
              >
                {initials(active.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{active.name}</p>
                <div className="mt-0.5 flex items-center gap-2.5">
                  <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                    <Users className="h-3 w-3" /> {active.members} members
                  </span>
                </div>
              </div>
            </div>

            <div className="h-[24rem] space-y-3 overflow-y-auto p-4">
              {activeMsgs.length === 0 && (
                <p className="pt-16 text-center text-sm text-muted">
                  No messages yet — say hi 👋
                </p>
              )}
              {activeMsgs.map((m) => {
                const mine = m.userId === (me?.id as number) 
                return mine ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[75%] text-right">
                      <span className="mb-1 block font-mono text-[9px] text-muted">{timeStr(m.createdAt)}</span>
                      <p className="inline-block rounded-2xl rounded-br-sm border border-violet/25 bg-violet/20 px-3.5 py-2 text-sm leading-relaxed text-ink">
                        {m.body}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-end gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                      style={{ backgroundColor: `${active.accent}2e`, color: active.accent }}
                    >
                      {initials(m.author)}
                    </span>
                    <div className="max-w-[75%]">
                      <span className="mb-1 flex items-baseline gap-1.5 font-mono text-[9px] text-muted">
                        {m.author}
                        <span className="text-ice/30">·</span>
                        {timeStr(m.createdAt)}
                      </span>
                      <p className="inline-block rounded-2xl rounded-bl-sm border border-ice/10 bg-surface-2/70 px-3.5 py-2 text-sm leading-relaxed text-ink/90">
                        {m.body}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-line/70 p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${active.name}…`}
                className="flex-1 rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
              />
              <button
                type="submit"
                aria-label="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-deep/25 text-violet-soft transition hover:bg-violet-deep/40"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>

          <aside className="glass-ice overflow-hidden rounded-xl">
            <div className="border-b border-line/70 p-4">
              <div className="flex items-center gap-2.5">
                <CrystalMark size="sm" spinOnView />
                <h2 className="text-sm font-semibold text-ink">Discover</h2>
              </div>
              <div className="relative mt-3">
                <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ice/40" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search clubs…"
                  className="w-full rounded-lg border border-ice/10 bg-thaw py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                />
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCatFilter(cat)}
                    className={clsx(
                      'rounded-full border px-2 py-0.5 text-[11px] font-semibold transition',
                      catFilter === cat
                        ? 'border-ice/25 bg-ice/15 text-ice'
                        : 'border-ice/10 bg-ice/[0.03] text-muted hover:border-ice/20 hover:text-ink',
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[30rem] space-y-3 overflow-y-auto p-4">
              {otherClubs.length === 0 && (
                <p className="pt-10 text-center text-sm text-muted">No other clubs.</p>
              )}
              {otherClubs.map((club) => {
                const isJoined = joinedIds.includes(club.id)
                return (
                  <article
                    key={club.id}
                    className="group overflow-hidden rounded-xl border border-ice/10 bg-surface-2/40 transition hover:border-violet/40 hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]"
                  >
                    <button
                      type="button"
                      onClick={() => openClub(club.id)}
                      className="flex w-full items-center gap-3 p-3 text-left"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                        style={{ backgroundColor: `${club.accent}2e`, color: club.accent }}
                      >
                        {initials(club.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{club.name}</span>
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                            <Users className="h-3 w-3" />
                            {club.members}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted">
                          {club.description}
                        </span>
                        <span
                          className="mt-1.5 inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase"
                          style={{
                            borderColor: `${club.accent}66`,
                            color: club.accent,
                            background: `${club.accent}1f`,
                          }}
                        >
                          {club.tags[0] ?? 'General'}
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center justify-between border-t border-ice/10 px-3 py-2">
                      <span className="truncate font-mono text-[8px] tracking-[0.14em] text-muted uppercase">
                        {club.tags[0] ?? 'General'}
                      </span>
                      <div className="flex items-center gap-2">
                        {canDelete(club) && (
                          <button
                            type="button"
                            onClick={() => deleteClub(club.id, club.name)}
                            className="shrink-0 rounded-lg border border-rose-400/20 px-2 py-1 text-[11px] font-semibold text-rose-400/80 transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-400"
                          >
                            Delete
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleJoin(club.id)}
                          className={clsx(
                            'shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                            isJoined
                              ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft hover:border-emerald-soft/50'
                              : 'border-ice/20 bg-ice/10 text-ice hover:bg-ice/15',
                          )}
                        >
                          {isJoined ? 'Joined ✓' : 'Join'}
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </aside>
        </div>
      </div>
    )
  }

  /* ---------- Hub: my clubs + discover ---------- */
  return (
    <div className="rise-grid mx-auto max-w-6xl space-y-10">
      <PageHeader
        eyebrow="Network"
        title="Clubs & Network"
        description="Find your people on campus"
      />

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]">
        <section>
          <div className="flex items-center gap-2.5">
            <CrystalMark size="sm" spinOnView />
            <h2 className="text-sm font-semibold text-ink">My clubs</h2>
            <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              {myClubs.length} joined
            </span>
          </div>

          {myClubs.length === 0 ? (
            <div className="glass-ice mt-4 rounded-xl px-5 py-6 text-center">
              <p className="text-sm font-medium text-ink">No clubs yet</p>
              <p className="mt-1 text-xs text-muted">Join one below to start chatting with members</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {myClubs.map((club) => (
                <div
                  key={club.id}
                  className="glass-ice group relative rounded-xl transition duration-200 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_0_24px_rgba(139,92,246,0.18)]"
                >
                  <button
                    type="button"
                    onClick={() => openClub(club.id)}
                    className="w-full p-3.5 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                        style={{ backgroundColor: `${club.accent}2e`, color: club.accent }}
                      >
                        {initials(club.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {club.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted">
                          {club.description}
                        </span>
                        <span className="mt-1 flex items-center gap-2.5">
                          <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                            <Users className="h-3 w-3" /> {club.members}
                          </span>
                          <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                            {club.tags[0] ?? 'General'}
                          </span>
                        </span>
                      </span>
                      <ArrowLeft className="h-3.5 w-3.5 shrink-0 -rotate-180 text-ice/30 opacity-0 transition group-hover:opacity-100" />
                    </div>
                  </button>
                  {canDelete(club) && (
                    <button
                      type="button"
                      onClick={() => deleteClub(club.id, club.name)}
                      aria-label={`Delete ${club.name}`}
                      className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg border border-rose-400/25 bg-thaw/60 text-rose-400/70 opacity-0 transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2.5">
            <CrystalMark size="sm" spinOnView />
            <h2 className="text-sm font-semibold text-ink">Discover</h2>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className={clsx(
                'ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition',
                showCreate
                  ? 'border-violet/40 bg-violet/15 text-violet-soft'
                  : 'border-violet/30 bg-violet/10 text-violet-soft hover:border-violet/50 hover:bg-violet/15',
              )}
            >
              <Plus className={clsx('h-3.5 w-3.5 transition-transform', showCreate && 'rotate-45')} />
              {showCreate ? 'Close' : 'Create club'}
            </button>
            <span className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
              {discovered.length} clubs
            </span>
          </div>

          {showCreate && (
            <div className="glass-ice mt-4 rounded-xl p-4">
              <div className="flex items-center gap-2.5">
                <CrystalMark size="sm" spinOnView />
                <p className="text-sm font-semibold text-ink">Create a club</p>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  aria-label="Close"
                  className="ml-auto flex h-6 w-6 items-center justify-center rounded-md border border-ice/10 text-muted transition hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr]">
                <div>
                  <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-ice/10">
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{
                        background:
                          draftClub.banner.trim() ||
                          `radial-gradient(120% 120% at 20% 0%, ${categoryAccent[draftClub.category]}33, transparent 60%), linear-gradient(180deg, ${categoryAccent[draftClub.category]}1f, transparent)`,
                      }}
                    >
                      <span
                        className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold"
                        style={{ backgroundColor: `${categoryAccent[draftClub.category]}2e`, color: categoryAccent[draftClub.category] }}
                      >
                        {initials(draftClub.name || draftClub.category)}
                      </span>
                    </div>
                  </div>
                  <input
                    value={draftClub.banner}
                    onChange={(e) => setDraftClub((d) => ({ ...d, banner: e.target.value }))}
                    placeholder="Banner gradient (e.g. linear-gradient(...))"
                    className="mt-2 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                  <span className="mt-2 block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                    Banner preview
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      Club name
                    </label>
                    <input
                      value={draftClub.name}
                      onChange={(e) => setDraftClub((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Sunrise Hikers"
                      className="mt-1.5 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                    />
                  </div>
                  <div>
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      Category
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {categories.slice(1).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setDraftClub((d) => ({ ...d, category: c }))}
                          className={clsx(
                            'rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                            draftClub.category === c
                              ? catStyles[c]
                              : 'border-ice/10 bg-ice/[0.03] text-muted hover:text-ink',
                          )}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      Description
                    </label>
                    <textarea
                      value={draftClub.description}
                      onChange={(e) => setDraftClub((d) => ({ ...d, description: e.target.value }))}
                      placeholder="What's this club about?"
                      rows={2}
                      className="mt-1.5 w-full resize-none rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2 border-t border-ice/10 pt-3.5">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-3 py-1.5 text-sm font-semibold text-muted transition hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createClub}
                  disabled={!draftClub.name.trim() || !draftClub.description.trim()}
                  className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw transition hover:bg-ice-bright disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                >
                  Create club
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ice/40" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clubs…"
                className="w-56 rounded-lg border border-ice/10 bg-thaw py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCatFilter(cat)}
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                    catFilter === cat
                      ? 'border-ice/25 bg-ice/15 text-ice'
                      : 'border-ice/10 bg-ice/[0.03] text-muted hover:border-ice/20 hover:text-ink',
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-1">
              {(['Popular', 'A–Z'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-xs font-semibold transition',
                    sort === s
                      ? 'border-ice/25 bg-ice/15 text-ice'
                      : 'border-ice/10 bg-ice/[0.03] text-muted hover:border-ice/20 hover:text-ink',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {discovered.length === 0 && (
              <p className="pt-10 text-center text-sm text-muted">No clubs match your search.</p>
            )}
            {discovered.map((club) => {
              const isJoined = joinedIds.includes(club.id)
              return (
                <article
                  key={club.id}
                  className={clsx(
                    'group overflow-hidden rounded-xl border border-ice/10 bg-surface-2/40 transition',
                    isJoined
                      ? 'border-emerald-soft/20'
                      : 'hover:border-violet/40 hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => openClub(club.id)}
                    className="flex w-full items-center gap-3 p-3 text-left"
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                      style={{ backgroundColor: `${club.accent}2e`, color: club.accent }}
                    >
                      {initials(club.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{club.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                          <Users className="h-3 w-3" />
                          {club.members}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">
                        {club.description}
                      </span>
                      <span
                        className="mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase"
                        style={{
                          borderColor: `${club.accent}66`,
                          color: club.accent,
                          background: `${club.accent}1f`,
                        }}
                      >
                        {club.tags[0] ?? 'General'}
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center justify-between border-t border-ice/10 px-3 py-2">
                    <span className="truncate font-mono text-[8px] tracking-[0.14em] text-muted uppercase">
                      {club.tags[0] ?? 'General'}
                    </span>
                    <div className="flex items-center gap-2">
                      {canDelete(club) && (
                        <button
                          type="button"
                          onClick={() => deleteClub(club.id, club.name)}
                          className="shrink-0 rounded-lg border border-rose-400/20 px-2 py-1 text-[11px] font-semibold text-rose-400/80 transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-400"
                        >
                          Delete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleJoin(club.id)}
                        className={clsx(
                          'shrink-0 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                          isJoined
                            ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft hover:border-emerald-soft/50'
                            : 'border-ice/20 bg-ice/10 text-ice hover:bg-ice/15',
                        )}
                      >
                        {isJoined ? 'Joined ✓' : 'Join'}
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}