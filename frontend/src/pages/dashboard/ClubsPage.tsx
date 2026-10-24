import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import clsx from 'clsx'
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  Code2,
  GraduationCap,
  Handshake,
  LogOut,
  MoreHorizontal,
  Music,
  Plus,
  Search,
  Send,
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
  Tech: '#a78bfa',
  Sports: '#38bdf8',
  'Arts/Music': '#f472b6',
  Academic: '#fbbf24',
  Social: '#34d399',
}

/* The chat rail labels a club "Active now" when its newest message landed
   inside this window. */
const ACTIVE_WINDOW_MS = 60 * 60 * 1000

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

const swatches = ['#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#38bdf8', '#f43f5e']

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

function CategoryGlyph({ category, className }: { category: string; className?: string }) {
  switch (category) {
    case 'Tech':
      return <Code2 className={className} />
    case 'Sports':
      return <Trophy className={className} />
    case 'Arts/Music':
      return <Music className={className} />
    case 'Academic':
      return <GraduationCap className={className} />
    case 'Social':
      return <Handshake className={className} />
    default:
      return null
  }
}

function CategoryDecor({ category }: { category: string }) {
  return (
    <div className="pointer-events-none absolute -right-2 -bottom-2 opacity-25">
      <CategoryGlyph category={category} className="h-20 w-20 rotate-12 text-white" />
    </div>
  )
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

/* --------------------------------------------------------------------------
   Redesigned Clubs board — presentation split into four pieces:
   YourClubsRail / YourClubCard (chat-first) and DiscoverGrid /
   DiscoverClubCard (banner cards). State, sockets and API calls stay in
   ClubsPage below; these components are pure and receive everything as props.
   -------------------------------------------------------------------------- */

type YourClubEntry = {
  club: Club
  unread: number
  lastMsg: ClubMessage | null
  lastAt: number
  activeNow: boolean
  senders: string[]
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function SectionHeading({ label, count, id }: { label: string; count: string; id?: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <h2 id={id} className="text-sm font-semibold" style={{ color: '#ece8ff' }}>
        {label}
      </h2>
      <span
        className="ml-auto font-mono text-[10px] tracking-[0.14em] uppercase"
        style={{ color: '#7d76a3' }}
      >
        {count}
      </span>
    </div>
  )
}

function YourClubCard({
  entry,
  members,
  meId,
  meName,
  onOpen,
}: {
  entry: YourClubEntry
  members?: ClubMember[]
  meId?: number
  meName?: string
  onOpen: (id: number) => void
}) {
  const { club, unread, lastMsg, activeNow } = entry
  const accent = club.accent || categoryAccent[clubCategory(club)] || '#a78bfa'
  const senderName = lastMsg
    ? lastMsg.userId === meId && meName
      ? meName
      : lastMsg.author
    : ''

  const stack = useMemo(() => {
    if (members && members.length > 0) {
      return members.slice(0, 3).map((m) => ({ key: `m-${m.id}`, label: initials(m.name), name: m.name }))
    }
    if (entry.senders.length > 0) {
      return entry.senders.slice(0, 3).map((name, i) => ({ key: `s-${i}-${name}`, label: initials(name), name }))
    }
    return [{ key: 'club', label: clubInitial(club.name), name: club.name }]
  }, [members, entry.senders, club.name])

  function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(club.id)
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open ${club.name} chat`}
      onClick={() => onOpen(club.id)}
      onKeyDown={handleKeyDown}
      className="group relative flex w-full shrink-0 cursor-pointer flex-col overflow-hidden rounded-[18px] border bg-[#120d27] p-[14px] text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-16px_rgba(139,92,246,.45)] focus-visible:ring-2 focus-visible:ring-[#a78bfa]/60 focus-visible:outline-none"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 38%, #120d27), #120d27 62%)`,
      }}
    >
      {/* faint dot texture fading out by the middle */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1.4px)`,
          backgroundSize: '20px 20px',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 45%, transparent 75%)',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 45%, transparent 75%)',
        }}
      />

      {/* watermark icon cropped top-right */}
      <span className="pointer-events-none absolute -top-2 -right-2 opacity-[0.12]">
        <CategoryGlyph category={clubCategory(club)} className="h-[100px] w-[100px] rotate-12 text-white" />
      </span>

      {/* Row 1 — identity + unread / presence */}
      <div className="relative flex items-start gap-3">
        <span
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[15px] border text-[20px] font-bold shadow-[0_6px_18px_rgba(8,6,20,.6)]"
          style={{
            background: `radial-gradient(circle at 50% 30%, ${accent}40, rgba(11,9,16,.98))`,
            borderColor: accent,
            color: accent,
            boxShadow: `0 0 0 3px rgba(18,13,39,1), 0 0 18px ${accent}4d`,
          }}
        >
          {clubInitial(club.name)}
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[17px] leading-snug font-semibold" style={{ color: '#ece8ff' }}>
            {club.name}
          </p>
          <span
            className="mt-0.5 block truncate font-mono text-[9px] tracking-[0.14em] uppercase"
            style={{ color: '#7d76a3' }}
          >
            {clubCategory(club)}
          </span>
        </div>
        {unread > 0 ? (
          <span
            className="ml-auto flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
            style={{ backgroundColor: accent, color: '#160f2b', boxShadow: `0 0 12px ${accent}80` }}
            aria-label={`${unread} unread messages`}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : activeNow ? (
          <span
            className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[9px] tracking-[0.14em] uppercase"
            style={{ color: '#34d399' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: '#34d399', boxShadow: '0 0 8px #34d399' }}
            />
            Active now
          </span>
        ) : null}
      </div>

      {/* Row 2 — last message preview */}
      <div
        className="relative mt-3 flex items-center gap-2.5 rounded-[11px] border border-white/[0.05] px-2.5 py-1.5"
        style={{ backgroundColor: 'rgba(255,255,255,.04)' }}
      >
        {lastMsg ? (
          <>
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold"
              style={{
                backgroundColor: `${accent}24`,
                borderColor: `${accent}40`,
                color: accent,
              }}
            >
              {initials(senderName).charAt(0)}
            </span>
            <p className="min-w-0 flex-1 truncate text-[12px]" style={{ color: '#9a93bd' }}>
              <span className="font-semibold" style={{ color: '#ece8ff' }}>
                {senderName}
              </span>
              <span className="mx-1.5" style={{ color: '#7d76a3' }}>
                ·
              </span>
              {lastMsg.body}
            </p>
            <span className="shrink-0 font-mono text-[9px] tabular-nums" style={{ color: '#7d76a3' }}>
              {relativeTime(lastMsg.createdAt)}
            </span>
          </>
        ) : (
          <p className="min-w-0 flex-1 truncate text-[12px] italic" style={{ color: '#7d76a3' }}>
            No messages yet — say hi and start the conversation.
          </p>
        )}
      </div>

      {/* Row 3 — members + open chat */}
      <div className="relative mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="truncate font-mono text-[9px] tracking-[0.12em] uppercase"
            style={{ color: '#7d76a3' }}
          >
            {club.members} {club.members === 1 ? 'member' : 'members'}
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(club.id)
          }}
          className="flex shrink-0 items-center gap-1 rounded-[10px] border px-2.5 py-1.5 text-[11px] font-semibold transition hover:bg-white/[0.13]"
          style={{
            backgroundColor: 'rgba(255,255,255,.08)',
            borderColor: 'rgba(255,255,255,.14)',
            color: '#ece8ff',
          }}
        >
          Open chat <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </article>
  )
}

function YourClubsRail({
  entries,
  membersById,
  meId,
  meName,
  onOpen,
}: {
  entries: YourClubEntry[]
  membersById: Record<number, ClubMember[]>
  meId?: number
  meName?: string
  onOpen: (id: number) => void
}) {
  return (
    <div
      className="rounded-[24px] border p-[18px] max-[1100px]:flex max-[1100px]:flex-col max-[1100px]:gap-3"
      style={{
        borderColor: 'rgba(168,85,247,.22)',
        background: 'linear-gradient(180deg, rgba(124,58,237,.10), rgba(255,255,255,.02))',
      }}
    >
      {entries.length === 0 ? (
        <div
          className="flex min-h-[190px] flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed px-5 py-8 text-center max-[1100px]:min-h-[140px]"
          style={{ borderColor: 'rgba(168,85,247,.3)' }}
        >
          <p className="text-sm font-medium" style={{ color: '#ece8ff' }}>
            You haven&apos;t joined any clubs yet
          </p>
          <p className="text-xs" style={{ color: '#7d76a3' }}>
            Browse clubs on the right{' '}
            <span aria-hidden style={{ color: '#a78bfa' }}>
              →
            </span>
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-[14px] max-[1100px]:flex-row max-[1100px]:overflow-x-auto max-[1100px]:pb-1 max-[1100px]:snap-x max-[1100px]:snap-mandatory">
            {entries.map((entry) => (
              <div key={entry.club.id} className="max-[1100px]:w-[320px] max-[1100px]:shrink-0 max-[1100px]:snap-start">
                <YourClubCard
                  entry={entry}
                  members={membersById[entry.club.id]}
                  meId={meId}
                  meName={meName}
                  onOpen={onOpen}
                />
              </div>
            ))}
          </div>
          <p
            className="rounded-[12px] border border-dashed px-3 py-2.5 text-center text-[11px] max-[1100px]:mt-1"
            style={{ borderColor: 'rgba(168,85,247,.26)', color: '#7d76a3' }}
          >
            Looking for more? Browse clubs on the right{' '}
            <span aria-hidden style={{ color: '#a78bfa' }}>
              →
            </span>
          </p>
        </>
      )}
    </div>
  )
}

function DiscoverClubTile({
  club,
  joined,
  popular,
  menuOpen,
  onToggleMenu,
  onJoin,
  onDelete,
}: {
  club: Club
  joined: boolean
  popular: boolean
  menuOpen: boolean
  onToggleMenu: () => void
  onJoin: () => void
  onDelete: () => void
}) {
  const category = clubCategory(club)
  const accent = club.accent || categoryAccent[category] || '#a78bfa'

  return (
    <article
      className="group relative flex aspect-square w-full flex-col overflow-hidden rounded-[20px] border transition duration-200 hover:-translate-y-[3px] hover:shadow-[0_14px_30px_-12px_var(--c)]"
      style={{
        ['--c' as any]: accent,
        borderColor: `color-mix(in srgb, ${accent} 40%, transparent)`,
        background: `linear-gradient(160deg, color-mix(in srgb, ${accent} 38%, #120d27), #120d27 62%)`,
      }}
    >
      {/* faint dot texture fading out by the middle */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.18) 1px, transparent 1.4px)`,
          backgroundSize: '20px 20px',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 45%, transparent 75%)',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 45%, transparent 75%)',
        }}
      />

      {/* watermark icon cropped top-right */}
      <span className="pointer-events-none absolute -top-2 -right-2 opacity-[0.14]">
        <CategoryGlyph category={category} className="h-[110px] w-[110px] rotate-12 text-white" />
      </span>

      {/* hover menu */}
      <div className="absolute top-2 right-2 z-20">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu()
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/80 opacity-0 backdrop-blur-md transition group-hover:opacity-100 hover:bg-black/50 hover:text-white"
          aria-label={`More options for ${club.name}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute top-8 right-0 z-20 min-w-[120px] rounded-xl border p-1 shadow-lg backdrop-blur-xl"
            style={{ background: 'rgba(26,21,36,0.95)', borderColor: 'rgba(184,164,224,0.2)' }}
          >
            <button
              type="button"
              onClick={onDelete}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-violet/10"
              style={{ color: '#cfc8e6' }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* top row: avatar + status chip */}
      <div className="relative flex items-start justify-between gap-2 p-3">
        <span
          className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] border text-[16px] font-bold"
          style={{
            background: `radial-gradient(circle at 50% 30%, ${accent}40, rgba(11,9,16,.98))`,
            borderColor: accent,
            color: accent,
            boxShadow: `0 0 0 3px rgba(18,13,39,1), 0 0 18px ${accent}4d`,
          }}
        >
          {clubInitial(club.name)}
        </span>

        {joined ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#34d399]/45 bg-[#34d399]/10 px-2 py-0.5 text-[9px] font-semibold text-[#34d399]">
            ✓ Joined
          </span>
        ) : popular ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#fbbf24] to-[#f59e0b] px-2 py-0.5 text-[9px] font-bold text-[#2a1a05]">
            🔥 Popular
          </span>
        ) : null}
      </div>

      {/* bottom block */}
      <div className="relative mt-auto flex flex-col gap-1.5 px-3 pb-3">
        <span
          className="font-mono text-[9px] uppercase tracking-[0.14em]"
          style={{ color: accent }}
        >
          {category}
        </span>
        <p className="truncate text-[16px] font-bold leading-tight" style={{ color: '#ece8ff' }}>
          {club.name}
        </p>
        <p
          className="line-clamp-2 text-[12px] leading-snug"
          style={{ color: '#9a93bd', minHeight: '34px' }}
        >
          {club.description || 'A new club waiting for its people.'}
        </p>

        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: '#7d76a3' }}>
            {club.members} members
          </span>
        </div>

        <button
          type="button"
          onClick={onJoin}
          className="mt-2 h-[36px] w-full rounded-[11px] text-[11px] font-semibold transition"
          style={
            joined
              ? {
                  background: 'transparent',
                  border: '1px solid #34d399',
                  color: '#34d399',
                }
              : {
                  background: accent,
                  border: `1px solid ${accent}`,
                  color: '#160f2b',
                }
          }
        >
          {joined ? '✓ Joined' : 'Join club'}
        </button>
      </div>
    </article>
  )
}

function DiscoverGrid({
  clubs,
  joinedIds,
  menuOpenId,
  onToggleMenu,
  onJoin,
  onDelete,
  onCreate,
}: {
  clubs: Club[]
  joinedIds: number[]
  menuOpenId: number | null
  onToggleMenu: (id: number) => void
  onJoin: (id: number) => void
  onDelete: (id: number, name: string) => void
  onCreate: () => void
}) {
  const maxMembers = clubs.reduce((max, club) => Math.max(max, club.members), 0)

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[14px]">
      {clubs.map((club) => (
        <DiscoverClubTile
          key={club.id}
          club={club}
          joined={joinedIds.includes(club.id)}
          popular={clubs.length > 0 && club.members === maxMembers}
          menuOpen={menuOpenId === club.id}
          onToggleMenu={() => onToggleMenu(club.id)}
          onJoin={() => onJoin(club.id)}
          onDelete={() => onDelete(club.id, club.name)}
        />
      ))}

      <button
        type="button"
        onClick={onCreate}
        className="group flex aspect-square w-full flex-col items-center justify-center rounded-[20px] border border-dashed p-6 text-center transition hover:border-[#a78bfa]/50 hover:bg-[#7c3aed]/5"
        style={{ borderColor: 'rgba(168,85,247,.28)', backgroundColor: 'rgba(255,255,255,.015)' }}
      >
        <div
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-dashed transition group-hover:text-[#a78bfa]"
          style={{ borderColor: 'rgba(168,85,247,.4)', color: '#7d76a3' }}
        >
          <Plus className="h-5 w-5" />
        </div>
        <p className="mt-3 text-sm font-semibold" style={{ color: '#ece8ff' }}>
          Start your own club
        </p>
        <p className="mt-1 text-xs" style={{ color: '#9a93bd' }}>
          Create a space for your people
        </p>
      </button>
    </div>
  )
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
  const [hideJoined, setHideJoined] = useState(false)
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
  const meName = me && typeof me.name === 'string' ? me.name : undefined
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

      // prefetch messages + members for joined clubs (for previews / avatar stacks)
      joinedIdsArr.forEach((id) => {
        api
          .get<ClubMessage[]>(`/api/clubs/${id}/messages`)
          .then((msgs) => setMessages((prev) => ({ ...prev, [id]: msgs })))
          .catch(() => {})
        api
          .get<ClubMember[]>(`/api/clubs/${id}/members`)
          .then((members) => setClubMembers((prev) => ({ ...prev, [id]: members })))
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
  const myClubs = useMemo(() => allClubs.filter((c) => joinedIds.includes(c.id)), [allClubs, joinedIds])

  /* Unread conversations float to the top, then the freshest chat wins. */
  const yourClubs = useMemo<YourClubEntry[]>(() => {
    return myClubs
      .map((club) => {
        const msgs = messages[club.id] ?? []
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null
        const lastAt = lastMsg ? new Date(lastMsg.createdAt).getTime() || 0 : 0
        const senders = Array.from(new Set(msgs.slice(-6).map((m) => m.author))).slice(-3)
        return {
          club,
          unread: newCountFor(club.id, msgs, meId),
          lastMsg,
          lastAt,
          activeNow: !!lastMsg && Date.now() - lastAt < ACTIVE_WINDOW_MS,
          senders,
        }
      })
      .sort(
        (a, b) =>
          b.unread - a.unread ||
          b.lastAt - a.lastAt ||
          a.club.name.localeCompare(b.club.name),
      )
  }, [myClubs, messages, meId])

  const discovered = useMemo(() => {
    let list = allClubs.filter((c) => {
      if (hideJoined && joinedIds.includes(c.id)) return false
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
  }, [allClubs, catFilter, query, sort, hideJoined, joinedIds])

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
      <div className="mx-auto max-w-[1560px]">
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
                    {active.members} members
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
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${active.name}…`}
                className="flex-1 rounded-xl border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
              />
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
    <div className="flex h-full min-h-0 flex-col pb-1 max-[1100px]:h-auto max-[1100px]:min-h-full">
      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: '#7d76a3' }}>
            NETWORK
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight" style={{ color: '#ece8ff' }}>
            Find your people
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#9a93bd' }}>
            Join a club, start a chat, show up on campus.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#5b21b6] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_22px_rgba(139,92,246,0.38)] transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Create club
        </button>
      </header>

      {/* Two-column board */}
      <div className="mt-6 grid min-h-0 flex-1 grid-cols-[520px_1px_minmax(0,1fr)] gap-[26px] max-[1400px]:grid-cols-[420px_1px_minmax(0,1fr)] max-[1100px]:grid-cols-1 max-[1100px]:gap-y-6 max-[1100px]:flex-none max-[1100px]:overflow-visible">
        {/* Left column — Your clubs */}
        <section className="flex min-h-0 flex-col gap-3 max-[1100px]:flex-none">
          <SectionHeading label="Your clubs" count={`${yourClubs.length} JOINED`} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 max-[1100px]:flex-none max-[1100px]:overflow-visible max-[1100px]:pr-0">
            <YourClubsRail
              entries={yourClubs}
              membersById={clubMembers}
              meId={meId}
              meName={meName}
              onOpen={openClub}
            />
          </div>
        </section>

        {/* Vertical divider */}
        <div
          aria-hidden
          className="my-1 h-full w-px bg-gradient-to-b from-[rgba(168,85,247,.25)] via-[rgba(168,85,247,.12)] to-transparent max-[1100px]:hidden"
        />

        {/* Right column — Discover clubs */}
        <section className="flex min-h-0 flex-col gap-3 max-[1100px]:mt-2 max-[1100px]:flex-none">
          <SectionHeading label="Discover clubs" count={`${discovered.length} CLUBS`} />

          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" style={{ color: 'rgba(184,164,224,.4)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clubs…"
                className="w-full rounded-xl border py-2 pr-3 pl-9 text-sm outline-none placeholder:text-[rgba(184,164,224,.35)] focus:border-[#8b5cf6]/50 focus:ring-2 focus:ring-[#8b5cf6]/18"
                style={{
                  borderColor: 'rgba(184,164,224,.12)',
                  backgroundColor: 'rgba(18,15,24,.9)',
                  color: '#ece8ff',
                }}
              />
            </div>
            <div className="flex items-center gap-1">
              {(['Popular', 'A–Z'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={clsx(
                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    sort === s
                      ? 'border-[#8b5cf6]/70 text-[#ece8ff]'
                      : 'border-[rgba(184,164,224,.12)] text-[#9a93bd] hover:text-[#ece8ff]',
                  )}
                  style={sort === s ? { backgroundColor: 'rgba(124,58,237,.35)' } : {}}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setHideJoined((prev) => !prev)}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                hideJoined
                  ? 'border-[#8b5cf6]/70 text-[#ece8ff]'
                  : 'border-[rgba(184,164,224,.12)] text-[#9a93bd] hover:text-[#ece8ff]',
              )}
              style={hideJoined ? { backgroundColor: 'rgba(124,58,237,.35)' } : {}}
            >
              Hide joined
            </button>
          </div>

          {/* Category chips */}
          <div className="flex shrink-0 flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition',
                  catFilter === cat
                    ? 'border-[#8b5cf6] text-[#ece8ff]'
                    : 'border-[rgba(184,164,224,.12)] text-[#9a93bd] hover:text-[#ece8ff]',
                )}
                style={catFilter === cat ? { backgroundColor: 'rgba(124,58,237,.35)' } : {}}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Results */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 max-[1100px]:flex-none max-[1100px]:h-auto max-[1100px]:overflow-visible max-[1100px]:pr-0">
            <DiscoverGrid
              clubs={discovered}
              joinedIds={joinedIds}
              menuOpenId={openClubMenuId}
              onToggleMenu={(id) => setOpenClubMenuId((prev) => (prev === id ? null : id))}
              onJoin={toggleJoin}
              onDelete={deleteClub}
              onCreate={() => setShowCreate(true)}
            />
          </div>
        </section>
      </div>

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
                          className="mt-1 inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.14em] uppercase"
                          style={{
                            borderColor: `${draftClub.accent}66`,
                            color: draftClub.accent,
                            background: `${draftClub.accent}1f`,
                          }}
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