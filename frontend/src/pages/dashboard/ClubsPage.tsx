import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import clsx from 'clsx'
import {
  ArrowLeft,
  CheckCheck,
  Code2,
  GraduationCap,
  Handshake,
  LogOut,
  MoreHorizontal,
  Music,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Smile,
  Trash2,
  Trophy,
  VolumeX,
  X,
} from 'lucide-react'
import { CrystalMark } from '../../components/CrystalMark'
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

const categories = ['All', 'Tech', 'Sports', 'Arts/Music', 'Academic', 'Social']

const catStyles: Record<string, string> = {
  Tech: 'bg-violet/15 text-violet-soft border-violet/30',
  Sports: 'bg-sky-400/10 text-sky-400 border-sky-400/30',
  'Arts/Music': 'bg-ice/10 text-ice border-ice/20',
  Academic: 'bg-amber-gentle/15 text-amber-gentle border-amber-gentle/30',
  Social: 'bg-rose-400/15 text-rose-400 border-rose-400/30',
}

const categoryAccent: Record<string, string> = {
  Tech: '#8b5cf6',
  Sports: '#38bdf8',
  'Arts/Music': '#b8a4e0',
  Academic: '#d4b896',
  Social: '#f43f5e',
}

const categoryBanner: Record<string, string> = {
  Tech: 'linear-gradient(135deg, #312e81 0%, #5b21b6 40%, #8b5cf6 75%, #c4b5fd 100%)',
  Sports: 'linear-gradient(135deg, #0c4a6e 0%, #0369a1 40%, #38bdf8 75%, #7dd3fc 100%)',
  'Arts/Music': 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 40%, #b8a4e0 75%, #f0abfc 100%)',
  Academic: 'linear-gradient(135deg, #78350f 0%, #92400e 40%, #d4b896 75%, #fde68a 100%)',
  Social: 'linear-gradient(135deg, #881337 0%, #9f1239 40%, #f43f5e 75%, #fda4af 100%)',
}

type ClubMember = {
  id: number
  name: string
  role: string
  avatar: string | null
  ownerId: number | null
}

const swatches = ['#8b5cf6', '#b8a4e0', '#d4b896', '#9db8a8', '#38bdf8', '#f43f5e']

function normalizeCategory(tag: string): string {
  const t = (tag || '').trim()
  const map: Record<string, string> = {
    Wellness: 'Social',
    Arts: 'Arts/Music',
    Service: 'Social',
    Support: 'Social',
    Tech: 'Tech',
    Academic: 'Academic',
    Sports: 'Sports',
    Social: 'Social',
    'Arts/Music': 'Arts/Music',
  }
  return map[t] ?? t
}

function clubCategory(club: Club): string {
  return normalizeCategory(club.tags?.[0] ?? 'Social')
}

function initials(name: string) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function clubInitial(name: string) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

function bannerStyle(category: string, custom?: string | null) {
  const base = custom ?? categoryBanner[category] ?? 'linear-gradient(135deg, #5b21b6, #8b5cf6)'
  const dots = 'radial-gradient(circle, rgba(255,255,255,0.22) 1px, transparent 1.5px)'
  const blob = 'radial-gradient(ellipse 80% 60% at 80% 20%, rgba(255,255,255,0.20), transparent 60%)'
  const stripes = 'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 12px)'
  return {
    backgroundImage: `${dots}, ${stripes}, ${blob}, ${base}`,
    backgroundSize: '24px 24px, 12px 12px, cover, cover',
    backgroundPosition: 'center, center, center, center',
    backgroundRepeat: 'repeat, repeat, no-repeat, no-repeat',
  }
}

function CategoryDecor({ category }: { category: string }) {
  const cls = 'pointer-events-none absolute -bottom-2 -right-2 opacity-25'
  switch (category) {
    case 'Tech':
      return (
        <div className={cls}>
          <Code2 className="h-20 w-20 rotate-12 text-white" />
        </div>
      )
    case 'Sports':
      return (
        <div className={cls}>
          <Trophy className="h-20 w-20 -rotate-12 text-white" />
        </div>
      )
    case 'Arts/Music':
      return (
        <div className={cls}>
          <Music className="h-20 w-20 rotate-6 text-white" />
        </div>
      )
    case 'Academic':
      return (
        <div className={cls}>
          <GraduationCap className="h-20 w-20 -rotate-6 text-white" />
        </div>
      )
    case 'Social':
      return (
        <div className={cls}>
          <Handshake className="h-20 w-20 rotate-6 text-white" />
        </div>
      )
    default:
      return null
  }
}

function accentInk(color: string) {
  return `color-mix(in oklab, ${color} var(--accent-ink-weight, 100%), var(--accent-ink-mix, transparent))`
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
    tags: tags.map(normalizeCategory),
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

function lastSeenKey(id: number) {
  return `club_lastseen_${id}`
}

function newCountFor(clubId: number, msgs: ClubMessage[], meId: number | undefined) {
  const last = Number(localStorage.getItem(lastSeenKey(clubId)) || 0)
  return msgs.filter((m) => {
    const t = new Date(m.createdAt).getTime()
    return t > last && m.userId !== meId
  }).length
}

export function ClubsPage() {
  const [clubs, setClubs] = useState<Club[]>([])
  const [joinedIds, setJoinedIds] = useState<number[]>([])
  const [activeClub, setActiveClub] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Record<number, ClubMessage[]>>({})
  const [clubMembers, setClubMembers] = useState<Record<number, ClubMember[]>>({})
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [sort, setSort] = useState<'Popular' | 'A–Z'>('Popular')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [openClubMenuId, setOpenClubMenuId] = useState<number | null>(null)
  const [draftClub, setDraftClub] = useState({
    name: '',
    category: 'Tech' as string,
    description: '',
    accent: categoryAccent['Tech'],
    whoCanJoin: 'Open' as string,
  })

  const me = getUser()
  const meId = me ? Number(me.id) : undefined
  const nameInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [all, joined] = await Promise.all([
        api.get<Record<string, unknown>[]>('/api/clubs'),
        api.get<Record<string, unknown>[]>('/api/clubs/joined'),
      ])
      const parsed = all.map(parseClub)
      const joinedIdsArr = Array.isArray(joined)
        ? joined.map((j) => Number((j as Record<string, unknown>).id))
        : []
      setClubs(parsed)
      setJoinedIds(joinedIdsArr)

      // prefetch messages for joined clubs (for previews)
      joinedIdsArr.forEach((id) => {
        api
          .get<ClubMessage[]>(`/api/clubs/${id}/messages`)
          .then((msgs) => setMessages((prev) => ({ ...prev, [id]: msgs })))
          .catch(() => {})
      })
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
      const matchesCat = catFilter === 'All' || clubCategory(c) === catFilter
      const q = query.trim().toLowerCase()
      const matchesQuery =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.tags.some((t) => t.toLowerCase().includes(q)) ||
        clubCategory(c).toLowerCase().includes(q)
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
        fetchMembers(id)
      } else {
        const result = await api.post<{ joined: boolean; members: number }>(`/api/clubs/${id}/join`)
        setJoinedIds((prev) => [...prev, id])
        setClubs((prev) => prev.map((c) => (c.id === id ? { ...c, members: result.members } : c)))
        fetchMembers(id)
        // prefetch messages
        api
          .get<ClubMessage[]>(`/api/clubs/${id}/messages`)
          .then((msgs) => setMessages((prev) => ({ ...prev, [id]: msgs })))
          .catch(() => {})
      }
    } catch {
      /* unchanged on failure */
    }
  }

  async function fetchMembers(id: number) {
    try {
      const members = await api.get<ClubMember[]>(`/api/clubs/${id}/members`)
      setClubMembers((prev) => ({ ...prev, [id]: members }))
    } catch {
      /* ignore */
    }
  }

  async function openClub(id: number) {
    localStorage.setItem(lastSeenKey(id), String(Date.now()))
    setActiveClub(id)
    fetchMembers(id)
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
    if (!name || !draftClub.description.trim() || creating) return
    setCreating(true)
    try {
      const created = await api.post<Record<string, unknown>>('/api/clubs', {
        name,
        description: draftClub.description.trim(),
        tags: [draftClub.category],
        accent: draftClub.accent,
        banner: `linear-gradient(135deg, ${draftClub.accent} 0%, ${draftClub.accent}cc 50%, ${draftClub.accent}66 100%)`,
      })
      const club = parseClub(created)
      setClubs((prev) => (prev.some((c) => c.id === club.id) ? prev : [club, ...prev]))
      setJoinedIds((prev) => (prev.includes(club.id) ? prev : [...prev, club.id]))
      setDraftClub({ name: '', category: 'Tech', description: '', accent: categoryAccent['Tech'], whoCanJoin: 'Open' })
      setShowCreate(false)
      fetchMembers(club.id)
      // prefetch messages
      api
        .get<ClubMessage[]>(`/api/clubs/${club.id}/messages`)
        .then((msgs) => setMessages((prev) => ({ ...prev, [club.id]: msgs })))
        .catch(() => {})
    } catch {
      /* unchanged on failure */
    } finally {
      setCreating(false)
    }
  }

  async function leaveClub() {
    if (!active) return
    try {
      await api.del(`/api/clubs/${active.id}/join`)
    } catch {
      /* ignore */
    }
    setJoinedIds((prev) => prev.filter((x) => x !== active.id))
    setClubs((prev) => prev.map((c) => (c.id === active.id ? { ...c, members: Math.max(0, c.members - 1) } : c)))
    setActiveClub(null)
    refresh()
  }

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
      setOpenClubMenuId(null)
    } catch (err) {
      window.alert((err as Error)?.message || 'Failed to delete club.')
    }
  }

  useEffect(() => {
    function handleClick() {
      setOpenClubMenuId(null)
    }
    if (openClubMenuId !== null) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [openClubMenuId])

  useEffect(() => {
    if (showCreate) {
      setTimeout(() => nameInputRef.current?.focus(), 50)
    }
  }, [showCreate])

  /* ---------- Chat room ---------- */
  if (active) {
    return (
      <div className="mx-auto max-w-6xl">
        <button
          type="button"
          onClick={() => setActiveClub(null)}
          className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted transition hover:text-ice"
        >
          <ArrowLeft className="h-4 w-4" />
          Clubs / {active.name}
        </button>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-stretch">
          {/* Chat panel */}
          <div className="glass-ice flex h-[72vh] flex-col overflow-hidden rounded-xl">
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-line/70 p-4">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                style={{ backgroundColor: '#0b0910', borderColor: active.accent, color: active.accent }}
              >
                {clubInitial(active.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{active.name}</p>
                <div className="mt-0.5 flex items-center gap-2.5">
                  <span className="flex items-center gap-1 font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-soft" /> 1 online · {active.members} members
                  </span>
                </div>
              </div>
              <button type="button" aria-label="Search" className="flex h-8 w-8 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ice">
                <Search className="h-4 w-4" />
              </button>
              <button type="button" aria-label="More" className="flex h-8 w-8 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ice">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </div>

            {/* Pinned strip */}
            <div className="flex items-center gap-2 border-b border-line/70 bg-surface-2/40 px-4 py-2">
              <Pin className="h-3.5 w-3.5 text-amber-gentle" />
              <span className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Pinned</span>
              <span className="text-xs text-ink/90">Share your day, be kind, no judgement.</span>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div className="flex justify-center">
                <span className="rounded-full border border-ice/10 bg-surface-2/60 px-3 py-1 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                  Today
                </span>
              </div>

              {activeMsgs.length === 0 && (
                <p className="pt-16 text-center text-sm text-muted">No messages yet — say hi 👋</p>
              )}
              {activeMsgs.map((m) => {
                const mine = m.userId === meId
                return mine ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[75%] text-right">
                      <span className="mb-1 block font-mono text-[9px] text-muted">{timeStr(m.createdAt)}</span>
                      <p className="inline-block rounded-2xl rounded-br-sm bg-gradient-to-br from-violet to-violet-deep px-3.5 py-2 text-sm leading-relaxed text-white shadow-[0_0_18px_rgba(139,92,246,0.25)]">
                        {m.body}
                      </p>
                      <span className="mt-1 flex items-center justify-end gap-1 font-mono text-[9px] text-muted">
                        Seen <CheckCheck className="h-3 w-3 text-violet-soft" />
                      </span>
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex items-end gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                      style={{ backgroundColor: `${active.accent}2e`, color: accentInk(active.accent) }}
                    >
                      {initials(m.author)}
                    </span>
                    <div className="max-w-[75%]">
                      <span className="mb-1 flex items-baseline gap-1.5 font-mono text-[9px] text-emerald-soft">
                        {m.author}
                        <span className="text-ice/30">·</span>
                        <span className="text-muted">{timeStr(m.createdAt)}</span>
                      </span>
                      <p className="inline-block rounded-2xl rounded-bl-sm border border-ice/10 bg-surface-2/70 px-3.5 py-2 text-sm leading-relaxed text-ink/90">
                        {m.body}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Message bar */}
            <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-line/70 p-3">
              <button type="button" aria-label="Attach" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ice">
                <Paperclip className="h-4 w-4" />
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${active.name}…`}
                className="flex-1 rounded-xl border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
              />
              <button type="button" aria-label="Emoji" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ice">
                <Smile className="h-4 w-4" />
              </button>
              <button
                type="submit"
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-violet-deep text-white shadow-[0_0_18px_rgba(139,92,246,0.35)] transition hover:opacity-90"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>

          {/* Side panel */}
          <aside className="flex h-[72vh] flex-col gap-4">
            {/* Club info card */}
            <div className="glass-ice overflow-hidden rounded-xl">
              <div
                className="relative h-24 w-full overflow-visible"
                style={bannerStyle(clubCategory(active), active.banner)}
              >
                <CategoryDecor category={clubCategory(active)} />
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                    style={{ backgroundColor: '#0b0910', borderColor: active.accent, color: active.accent }}
                  >
                    {clubInitial(active.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{active.name}</p>
                    <span
                      className="mt-1 inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase"
                      style={{
                        borderColor: `${active.accent}66`,
                        color: accentInk(active.accent),
                        background: `${active.accent}1f`,
                      }}
                    >
                      {clubCategory(active)}
                    </span>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted">{active.description || 'Share your day to day experience here!'}</p>
              </div>
            </div>

            {/* Members card */}
            <div className="glass-ice overflow-hidden rounded-xl p-4">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Members</p>
              <div className="mt-3 space-y-3">
                {(clubMembers[active.id] ?? []).map((m) => {
                  const isMe = m.id === meId
                  const memberIsOwner = active.ownerId === m.id
                  return (
                    <div key={m.id} className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        style={
                          isMe
                            ? { backgroundColor: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }
                            : { backgroundColor: `${active.accent}2e`, color: accentInk(active.accent) }
                        }
                      >
                        {initials(m.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{isMe ? 'You' : m.name}</p>
                      </div>
                      <span
                        className={clsx(
                          'rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase',
                          memberIsOwner
                            ? 'border-violet/30 bg-violet/15 text-violet-soft'
                            : 'border-ice/15 bg-ice/[0.03] text-muted',
                        )}
                      >
                        {memberIsOwner ? 'Owner' : 'Member'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Bottom card */}
            <div className="glass-ice mt-auto overflow-hidden rounded-xl p-4">
              <div className="space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-ice/20 bg-transparent px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-ice/5"
                >
                  <VolumeX className="h-4 w-4" /> Mute notifications
                </button>
                <button
                  type="button"
                  onClick={leaveClub}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-400/40 bg-transparent px-3 py-2.5 text-sm font-semibold text-rose-400 transition hover:bg-rose-400/10"
                >
                  <LogOut className="h-4 w-4" /> Leave club
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    )
  }

  /* ---------- Dashboard ---------- */
  return (
    <div className="rise-grid mx-auto max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-muted uppercase">Network</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-ink">Find your people</h1>
          <p className="mt-1 text-sm text-muted">Join a club, start a chat, show up on campus.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet to-violet-deep px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Create club
        </button>
      </div>

      {/* Your clubs */}
      <section>
        <div className="flex items-center gap-2.5">
          <CrystalMark size="sm" spinOnView />
          <h2 className="text-sm font-semibold text-ink">Your clubs</h2>
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
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {myClubs.map((club) => {
              const msgs = messages[club.id] ?? []
              const lastMsg = msgs.length ? msgs[msgs.length - 1] : null
              const newCount = newCountFor(club.id, msgs, meId)
              return (
                <div
                  key={club.id}
                  className="glass-ice group relative overflow-hidden rounded-xl transition duration-200 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_0_24px_rgba(139,92,246,0.18)]"
                >
                  {/* banner */}
                  <div className="relative h-24 w-full overflow-visible rounded-t-xl" style={bannerStyle(clubCategory(club), club.banner)}>
                    <CategoryDecor category={clubCategory(club)} />
                    {newCount > 0 && (
                      <span className="absolute top-2 right-2 rounded-full bg-gradient-to-br from-violet to-violet-deep px-2 py-0.5 font-mono text-[8px] font-bold text-white">
                        {newCount} new
                      </span>
                    )}
                    <span
                      className="absolute -bottom-5 left-4 flex h-12 w-12 items-center justify-center rounded-xl border text-sm font-bold shadow-lg"
                      style={{ backgroundColor: '#0b0910', borderColor: club.accent, color: club.accent }}
                    >
                      {clubInitial(club.name)}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col p-4 pt-7">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-ink">{club.name}</p>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={clsx(
                            'inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase',
                            catStyles[clubCategory(club)] ?? 'border-ice/10 bg-ice/[0.03] text-muted',
                          )}
                        >
                          {clubCategory(club)}
                        </span>
                      </div>
                    </div>

                    {/* last message preview box */}
                    <div className="mt-3 rounded-xl border border-ice/10 bg-surface-2/40 px-3 py-2.5">
                      {lastMsg ? (
                        <p className="line-clamp-2 text-xs leading-relaxed text-ink/90">
                          <span className="font-semibold text-muted">{lastMsg.author}: </span>
                          {lastMsg.body}
                        </p>
                      ) : (
                        <p className="text-xs leading-relaxed text-muted">
                          No messages yet. Say hi and start the first hackathon thread.
                        </p>
                      )}
                    </div>

                    {/* member avatars stack */}
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {Array.from({ length: Math.min(Math.max(club.members, 1), 4) }).map((_, i) => (
                          <span
                            key={i}
                            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-thaw text-[9px] font-semibold"
                            style={{ backgroundColor: `${club.accent}${i === 0 ? '44' : '22'}`, color: accentInk(club.accent) }}
                          >
                            {clubInitial(club.name)}
                          </span>
                        ))}
                      </div>
                      {club.members > 4 && (
                        <span className="font-mono text-[9px] text-muted">+{club.members - 4}</span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => openClub(club.id)}
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-soft transition hover:text-ice"
                    >
                      Open chat <ArrowLeft className="h-3 w-3 -rotate-180" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Discover clubs */}
      <section>
        <div className="flex items-center gap-2.5">
          <CrystalMark size="sm" spinOnView />
          <h2 className="text-sm font-semibold text-ink">Discover clubs</h2>
          <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
            {discovered.length} clubs
          </span>
        </div>

        {/* toolbar row */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ice/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clubs…"
              className="w-full rounded-xl border border-ice/10 bg-thaw py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
            />
          </div>
          <div className="flex gap-1">
            {(['Popular', 'A–Z'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={clsx(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
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

        {/* category chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCatFilter(cat)}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-semibold transition',
                catFilter === cat
                  ? cat === 'All'
                    ? 'border-ice/25 bg-ice/15 text-ice'
                    : catStyles[cat]
                  : 'border-ice/10 bg-ice/[0.03] text-muted hover:border-ice/20 hover:text-ink',
              )}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* 3-col grid */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {discovered.map((club) => {
            const isJoined = joinedIds.includes(club.id)
            const isPopular = discovered.length > 0 && club.members === Math.max(...discovered.map((c) => c.members))
            return (
              <article
                key={club.id}
                className="group flex flex-col overflow-hidden rounded-xl border border-ice/10 bg-surface-2/40 transition hover:border-violet/40 hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]"
              >
                {/* banner */}
                <div
                  className="relative h-24 w-full overflow-visible"
                  style={bannerStyle(clubCategory(club), club.banner)}
                >
                  <CategoryDecor category={clubCategory(club)} />
                  {isPopular && (
                    <span className="absolute top-2 right-2 rounded-full bg-gradient-to-br from-amber-gentle to-amber-gentle/80 px-2 py-0.5 font-mono text-[8px] font-bold text-thaw">
                      Popular this week
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                      style={{ backgroundColor: '#0b0910', borderColor: club.accent, color: club.accent }}
                    >
                      {clubInitial(club.name)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleJoin(club.id)}
                      className={clsx(
                        'shrink-0 rounded-lg border px-3 py-1 text-xs font-semibold transition',
                        isJoined
                          ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft hover:border-emerald-soft/50'
                          : 'border-ice/20 bg-ice/10 text-ice hover:bg-ice/15',
                      )}
                    >
                      {isJoined ? 'Joined' : 'Join'}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-ink">{club.name}</p>
                    <span
                      className={clsx(
                        'shrink-0 rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase',
                        catStyles[clubCategory(club)] ?? 'border-ice/10 bg-ice/[0.03] text-muted',
                      )}
                    >
                      {clubCategory(club)}
                    </span>
                  </div>

                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{club.description}</p>

                  {/* member avatars */}
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {Array.from({ length: Math.min(Math.max(club.members, 1), 4) }).map((_, i) => (
                        <span
                          key={i}
                          className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-thaw text-[8px] font-semibold"
                          style={{ backgroundColor: `${club.accent}${i === 0 ? '44' : '22'}`, color: accentInk(club.accent) }}
                        >
                          {clubInitial(club.name)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenClubMenuId((prev) => (prev === club.id ? null : club.id))
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-full border transition hover:bg-violet/10 hover:text-violet-soft"
                        style={{ borderColor: 'rgba(184,164,224,0.25)', color: '#9a8fb0' }}
                        aria-label="More options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {openClubMenuId === club.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-9 left-0 z-20 min-w-[120px] rounded-xl border p-1 shadow-lg backdrop-blur-xl"
                          style={{ background: 'rgba(26,21,36,0.9)', borderColor: 'rgba(184,164,224,0.2)' }}
                        >
                          <button
                            type="button"
                            onClick={() => deleteClub(club.id, club.name)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-violet/10"
                            style={{ color: '#cfc8e6' }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                      {club.members} members
                    </span>
                  </div>
                </div>
              </article>
            )
          })}

          {/* Start your own club card */}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="group flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-ice/25 bg-ice/[0.02] p-6 text-center transition hover:border-violet/40 hover:bg-violet/5"
            style={{ minHeight: '260px' }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-ice/30 text-ice/60 transition group-hover:text-violet-soft">
              <Plus className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-ink">Start your own club</p>
            <p className="mt-1 text-xs text-muted">Create a space for your people</p>
          </button>
        </div>
      </section>

      {/* Create club modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-thaw-deep/70 p-4 backdrop-blur-md">
          <div className="grid w-[880px] max-w-[95vw] grid-cols-1 overflow-hidden rounded-3xl border border-ice/15 bg-surface shadow-[0_0_60px_rgba(0,0,0,0.6)] md:grid-cols-2">
            {/* Form column */}
            <div className="flex flex-col p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-bold text-ink">Create a club</h2>
                  <p className="mt-1 text-xs text-muted">Set up your space in a minute. You can edit everything later.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Club name</label>
                  <input
                    ref={nameInputRef}
                    value={draftClub.name}
                    onChange={(e) => setDraftClub((d) => ({ ...d, name: e.target.value }))}
                    placeholder="Campus Coders"
                    className="mt-1.5 w-full rounded-xl border border-ice/10 bg-thaw px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-violet/40 focus:ring-2 focus:ring-violet/20"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Category</label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {categories.filter((c) => c !== 'All').map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraftClub((d) => ({ ...d, category: c, accent: categoryAccent[c] }))}
                        className={clsx(
                          'rounded-full border px-3 py-1 text-xs font-semibold transition',
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
                  <div className="flex items-center justify-between">
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Description</label>
                    <span className="font-mono text-[9px] text-muted">{draftClub.description.length} / 160</span>
                  </div>
                  <textarea
                    value={draftClub.description}
                    onChange={(e) => {
                      if (e.target.value.length <= 160) setDraftClub((d) => ({ ...d, description: e.target.value }))
                    }}
                    placeholder="What's this club about?"
                    rows={3}
                    className="mt-1.5 w-full resize-none rounded-xl border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-violet/40 focus:ring-2 focus:ring-violet/20"
                  />
                </div>

                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Club colour</label>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {swatches.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDraftClub((d) => ({ ...d, accent: s }))}
                        className={clsx(
                          'h-8 w-8 rounded-full border-2 transition',
                          draftClub.accent === s ? 'border-ice scale-110' : 'border-transparent hover:scale-105',
                        )}
                        style={{ backgroundColor: s }}
                        aria-label={s}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Who can join</label>
                  <div className="mt-1.5 flex gap-2">
                    {['Open', 'Approval needed'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDraftClub((d) => ({ ...d, whoCanJoin: opt }))}
                        className={clsx(
                          'flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition',
                          draftClub.whoCanJoin === opt
                            ? 'border-violet/40 bg-violet/15 text-violet-soft'
                            : 'border-ice/10 bg-ice/[0.03] text-muted hover:text-ink',
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-ice/10 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-xl border border-ice/20 px-4 py-2 text-sm font-semibold text-muted transition hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createClub}
                  disabled={!draftClub.name.trim() || !draftClub.description.trim() || creating}
                  className="glow-cta rounded-xl bg-gradient-to-br from-violet to-violet-deep px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.35)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Create club
                </button>
              </div>
            </div>

            {/* Preview column */}
            <div className="flex flex-col border-l border-ice/10 bg-surface-2/30 p-6">
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Preview</p>
              <div className="mt-4 flex-1">
                <div className="overflow-hidden rounded-xl border border-ice/10 bg-surface-2/40">
                  <div
                    className="relative h-24 w-full overflow-visible"
                    style={bannerStyle(draftClub.category, `linear-gradient(135deg, ${draftClub.accent} 0%, ${draftClub.accent}cc 50%, ${draftClub.accent}66 100%)`)}
                  >
                    <CategoryDecor category={draftClub.category} />
                  </div>
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-bold"
                        style={{ backgroundColor: '#0b0910', borderColor: draftClub.accent, color: draftClub.accent }}
                      >
                        {clubInitial(draftClub.name || draftClub.category)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">{draftClub.name || 'Campus Coders'}</p>
                        <span
                          className={clsx(
                            'mt-1 inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase',
                            catStyles[draftClub.category],
                          )}
                        >
                          {draftClub.category}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">
                      {draftClub.description || 'A short description of your club will appear here.'}
                    </p>
                    <div className="mt-3 flex items-center justify-between font-mono text-[9px] tracking-[0.12em] text-muted uppercase">
                      <span>1 member</span>
                      <span>1 active today</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                You'll be the owner, and a chat opens as soon as you create the club.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}