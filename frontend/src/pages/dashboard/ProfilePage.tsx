import { useEffect, useState } from 'react'
import clsx from 'clsx'
import {
  AtSign,
  CalendarDays,
  GraduationCap,
  Lock,
  MoonStar,
  Pencil,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { CrystalMark } from '../../components/CrystalMark'
import { api, getUser } from '../../lib/api'

type ProfileStats = {
  enrollments: number
  avgAttendance: number | null
  cgpa: number | null
  posts?: number
  messages?: number
  clubs?: number
}

type ClubSummary = { id: number; name: string; members: number; tags: string[] }
const VIBE_TAG_RE = /^[A-Za-z0-9_]{3,20}$/
type TagStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'
type MeResponse = {
  id: number
  name: string
  email: string
  role: string
  major: string | null
  year: string | null
  avatar: string | null
  createdAt: string
  vibeTag?: string | null
  preferences: { anonymousDefault: boolean; nudges: boolean; nightMode: boolean }
}

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint: string
  on: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink/90">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
      <span
        className={clsx(
          'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
          on ? 'border-violet-soft/40 bg-violet/40' : 'border-ice/15 bg-ice/5',
        )}
      >
        <span
          className={clsx(
            'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all',
            on ? 'left-[calc(100%-1.05rem)] bg-ice-bright' : 'left-0.5 bg-ice/40',
          )}
        />
      </span>
    </button>
  )
}

export function ProfilePage() {
  const [notifications, setNotifications] = useState(true)
  const [nightMode, setNightMode] = useState(true)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [clubs, setClubs] = useState<ClubSummary[]>([])
  const [me, setMe] = useState<MeResponse | null>(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editDraft, setEditDraft] = useState({ name: '', major: '', year: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [vibeTagError, setVibeTagError] = useState('')
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [tagStatus, setTagStatus] = useState<TagStatus>('idle')
  const [savingTag, setSavingTag] = useState(false)

  const storedUser = getUser()
  // Show the tag from the server once loaded, else the one cached at sign-in/sign-up.
  const displayTag = (me ? (me.vibeTag || '') : String(storedUser?.vibeTag || '')).trim()
  const name = me?.name || (storedUser?.name as string) || 'Student'
  const email = me?.email || (storedUser?.email as string) || ''
  const major = me?.major ?? null
  const year = me?.year ?? null
  const createdAt = me?.createdAt ?? null
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)

  useEffect(() => {
    api.get<ProfileStats>('/api/analytics/summary').then(setStats).catch(() => {})
    api.get<Record<string, unknown>[]>('/api/clubs/joined').then((raw) => {
      if (Array.isArray(raw)) {
        setClubs(
          raw.map((r) => ({
            id: Number(r.id ?? 0),
            name: String(r.name ?? ''),
            members: Number(r.members ?? 0),
            tags: Array.isArray(r.tags) ? r.tags.map(String) : (() => { try { return JSON.parse(String(r.tags ?? '[]')) } catch { return [] } })(),
          })),
        )
      }
    }).catch(() => {})
    api.get<MeResponse>('/api/auth/me').then((m) => {
      setMe(m)
      setEditDraft({ name: m.name || '', major: m.major || '', year: m.year || '' })
      // First thing on Profile: claim your VibeTag (required before posting in Community).
      if (!m.vibeTag) {
        setSaved(false)
        setVibeTagError('')
        setTagDraft('')
        setShowTagModal(true)
      }
      if (m.preferences) {
        setNotifications(m.preferences.nudges)
        setNightMode(m.preferences.nightMode)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!me) return
    api.patch('/api/auth/preferences', { nudges: notifications, nightMode }).catch(() => {})
  }, [notifications, nightMode, me])

  // Live availability while editing your tag (your own current tag counts as available).
  useEffect(() => {
    const tag = tagDraft.trim()
    const current = (displayTag || '').trim()
    if (!tag) {
      setTagStatus('idle')
      return
    }
    if (!VIBE_TAG_RE.test(tag)) {
      setTagStatus('invalid')
      return
    }
    if (current && tag === current) {
      setTagStatus('available')
      return
    }
    setTagStatus('checking')
    const timer = setTimeout(() => {
      fetch(`/api/auth/vibetag/check?tag=${encodeURIComponent(tag)}`)
        .then((r) => r.json())
        .then((d: { available?: boolean }) => setTagStatus(d.available ? 'available' : 'taken'))
        .catch(() => setTagStatus('idle'))
    }, 350)
    return () => clearTimeout(timer)
  }, [tagDraft, displayTag])

  function openEditModal() {
    setEditDraft({ name: me?.name || name, major: major || '', year: year || '' })
    setShowEditModal(true)
    setSaved(false)
  }

  /** The dedicated "edit my unique VibeTag" flow. */
  function openVibeTagModal() {
    setTagDraft((displayTag || '').trim())
    setVibeTagError('')
    setSaved(false)
    setShowTagModal(true)
  }

  function generateVibeTag() {
    setTagDraft('vibe' + String(Math.floor(100000 + Math.random() * 900000)))
    setVibeTagError('')
  }

  async function saveProfile() {
    if (!editDraft.name.trim()) return
    setSaving(true)
    try {
      const updated = await api.patch<MeResponse>('/api/auth/me', {
        name: editDraft.name.trim(),
        major: editDraft.major.trim() || null,
        year: editDraft.year.trim() || null,
      })
      setMe(updated)
      localStorage.setItem('vibecheck.user', JSON.stringify({ ...storedUser, name: updated.name, email: updated.email, vibeTag: updated.vibeTag }))
      setSaved(true)
      setShowEditModal(false)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  async function saveVibeTag() {
    const tag = tagDraft.trim()
    if (!VIBE_TAG_RE.test(tag)) {
      setVibeTagError('Use 3–20 characters: letters, numbers, or underscores.')
      return
    }
    if (tagStatus === 'taken') {
      setVibeTagError('That VibeTag is already taken. Try another one.')
      return
    }
    setSavingTag(true)
    try {
      const updated = await api.patch<MeResponse>('/api/auth/me', { vibeTag: tag })
      setMe(updated)
      localStorage.setItem('vibecheck.user', JSON.stringify({ ...storedUser, name: updated.name, email: updated.email, vibeTag: updated.vibeTag }))
      setShowTagModal(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save your VibeTag.'
      setVibeTagError(message)
    } finally {
      setSavingTag(false)
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div className="landing-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="haze-blob pointer-events-none absolute -top-24 -right-24 h-[26rem] w-[26rem] rounded-full bg-violet/10 blur-[120px]"
        aria-hidden
      />
      <div
        className="haze-blob pointer-events-none absolute bottom-0 -left-32 h-[22rem] w-[22rem] rounded-full bg-ice/5 blur-[110px]"
        aria-hidden
      />

      <div className="relative z-10 mx-auto max-w-5xl space-y-8">
        <div className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-3">
              <CrystalMark spinOnView />
              <p className="font-mono text-[11px] tracking-[0.18em] text-muted uppercase">Profile</p>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
              Your space, your signal
            </h1>
            <p className="mt-1 text-sm text-muted">
              Personal details, well-being preferences and club memberships in one place.
            </p>
          </div>
          <span className="inline-flex items-center gap-2 self-start rounded-full border border-ice/12 bg-surface-2/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] text-ice/70 uppercase sm:self-end">
            <Sparkles className="h-3.5 w-3.5 text-ice/50" />
            Student · verified
          </span>
        </div>

        <section className="glass-ice group relative overflow-hidden rounded-xl p-6">
          <div className="chat-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
          <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="relative shrink-0">
              <div className="rounded-full bg-gradient-to-br from-violet via-violet-soft to-ice p-[2.5px]">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-thaw-deep font-display text-2xl font-extrabold text-ice">
                  {initials}
                </div>
              </div>
              <span className="absolute right-0.5 bottom-1 h-3.5 w-3.5 rounded-full border-2 border-thaw-deep bg-emerald-soft" />
            </div>

            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-frost via-ice-bright to-violet-soft">
                {name}
              </h2>
              <p className="mt-1 font-mono text-[11px] tracking-[0.16em] text-muted uppercase">
                {[major, year].filter(Boolean).join(' · ') || 'No academic details set'}
              </p>
              {displayTag ? (
                <button
                  type="button"
                  onClick={openVibeTagModal}
                  title="Change your VibeTag"
                  className="mt-2.5 inline-flex items-center gap-2 rounded-md border border-violet/40 bg-violet/10 px-2.5 py-1 font-mono text-[12px] tracking-[0.18em] text-violet-soft transition hover:border-violet hover:bg-violet/20"
                >
                  <AtSign className="h-3.5 w-3.5" /> {displayTag}
                  <Pencil className="h-3 w-3 opacity-70" />
                  <span className="sr-only">Change your VibeTag</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openVibeTagModal}
                  className="mt-2.5 inline-flex items-center gap-2 rounded-md border border-dashed border-rose-400/50 bg-rose-400/10 px-2.5 py-1 font-mono text-[12px] tracking-[0.18em] text-rose-300 transition hover:border-rose-400 hover:bg-rose-400/20"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Create your VibeTag to post
                </button>
              )}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted">
                {email && (
                  <span className="flex items-center gap-1.5">
                    <AtSign className="h-3.5 w-3.5 text-ice/50" /> {email}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="h-3.5 w-3.5 text-ice/50" /> CGPA {stats?.cgpa != null ? stats.cgpa.toFixed(1) : '—'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-soft/25 bg-emerald-soft/10 px-3 py-1 font-mono text-[9px] tracking-[0.16em] text-emerald-soft uppercase">
                <ShieldCheck className="h-3 w-3" /> {stats?.avgAttendance != null && stats.avgAttendance >= 80 ? 'All clear' : stats?.avgAttendance != null ? 'Monitor' : 'No data'}
              </span>
              {createdAt && (
                <span className="inline-flex items-center gap-2 rounded-full border border-ice/12 bg-ice/[0.05] px-3 py-1 font-mono text-[9px] tracking-[0.16em] text-ice/60 uppercase">
                  <CalendarDays className="h-3 w-3" /> Joined {new Date(createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Posts', value: String(stats?.posts ?? 0), unit: 'total' },
            { label: 'Courses enrolled', value: String(stats?.enrollments ?? 0), unit: 'active' },
            { label: 'Attendance', value: stats?.avgAttendance != null ? `${stats.avgAttendance}%` : '—', unit: 'avg' },
            { label: 'Risk status', value: stats?.avgAttendance != null && stats.avgAttendance >= 80 ? 'Low' : stats?.avgAttendance != null ? 'Moderate' : '—', unit: 'clear' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="glass-ice rounded-xl px-4 py-3.5">
              <p className="font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                {label}
              </p>
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="font-display text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-frost to-violet-soft tabular-nums">
                  {value}
                </span>
                <span className="text-xs font-normal text-muted">{unit}</span>
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className="glass-ice relative overflow-hidden p-6">
            <div className="chat-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
            <div className="relative z-10">
              <div className="flex items-center gap-2.5">
                <CrystalMark size="sm" spinOnView />
                <h2 className="text-sm font-semibold text-ink">Your VibeTag</h2>
                <span className="ml-auto font-mono text-[10px] tracking-[0.14em] text-muted uppercase">
                  Gamertag
                </span>
              </div>

              {displayTag ? (
                <>
                  <p className="mt-5 font-mono text-3xl font-bold tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-frost via-ice-bright to-violet-soft">
                    {displayTag}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    This is how you appear in Community when you post with your identity on.
                  </p>
                  <button
                    type="button"
                    onClick={openVibeTagModal}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-ice/15 bg-ice/[0.05] px-3.5 py-1.5 font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase transition hover:border-ice/30 hover:bg-ice/10 hover:text-ice"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Change VibeTag
                  </button>
                </>
              ) : (
                <div className="mt-5 rounded-xl border border-dashed border-rose-400/40 bg-rose-400/[0.07] p-5">
                  <p className="text-sm font-medium text-rose-300">
                    You haven’t created a VibeTag yet.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Pick a unique tag like a gamertag — you’ll need it before you can post or
                    comment in Community.
                  </p>
                  <button
                    type="button"
                    onClick={openVibeTagModal}
                    className="glow-cta mt-4 inline-flex items-center gap-2 rounded-lg bg-ice px-4 py-2 text-sm font-semibold text-thaw transition hover:bg-ice-bright"
                  >
                    <Sparkles className="h-4 w-4" /> Create VibeTag
                  </button>
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-2">
                {nightMode && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-ice/12 bg-ice/[0.05] px-3.5 py-1.5 text-sm font-medium text-ice">
                    <MoonStar className="h-4 w-4 text-violet-soft" />
                    Night study mode
                  </span>
                )}
              </div>
            </div>
          </section>

          <section className="glass-ice p-6">
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="text-sm font-semibold text-ink">My clubs</h2>
            </div>
            <ul className="mt-3 divide-y divide-line/60 border-y border-line/60">
              {clubs.length === 0 && (
                <li className="py-4 text-center text-sm text-muted">No clubs joined yet.</li>
              )}
              {clubs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ice/15 bg-ice/[0.06] text-ice">
                    <UsersRound className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink/90">
                      {c.name}
                    </span>
                    <span className="font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      {c.tags[0] ?? 'General'} · {c.members} members
                    </span>
                  </span>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-soft" />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="glass-ice p-6">
          <div className="flex items-center gap-2.5">
            <CrystalMark size="sm" spinOnView />
            <h2 className="text-sm font-semibold text-ink">Privacy & preferences</h2>
          </div>
          <div className="mt-3 divide-y divide-line/60">
            <div className="flex w-full items-center justify-between gap-4 py-3 text-left">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink/90">
                  Identity in Community
                </span>
                <span className="block text-xs text-muted">
                  Posts and comments are always shown under your VibeTag — never “Anonymous”
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={clsx(
                    'rounded-md border px-2 py-1 font-mono text-[11px] tracking-[0.14em]',
                    displayTag
                      ? 'border-violet/40 bg-violet/10 text-violet-soft'
                      : 'border-rose-400/40 bg-rose-400/10 text-rose-300',
                  )}
                >
                  {displayTag || 'not set'}
                </span>
                <button
                  type="button"
                  onClick={openVibeTagModal}
                  className="rounded-lg border border-ice/15 bg-ice/[0.05] px-2.5 py-1 font-mono text-[10px] tracking-[0.12em] text-ice/70 uppercase transition hover:border-ice/30 hover:bg-ice/10 hover:text-ice"
                >
                  {displayTag ? 'Change' : 'Create'}
                </button>
              </span>
            </div>
            <Toggle
              label="Daily wellness nudges"
              hint="Gentle reminders and support prompts when risk signals dip"
              on={notifications}
              onChange={setNotifications}
            />
            <Toggle
              label="Night study mode"
              hint="Dimmed, calmer surfaces after 8 PM"
              on={nightMode}
              onChange={setNightMode}
            />
          </div>
        </section>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-muted">
            <Lock className="h-3.5 w-3.5 text-ice/50" />
            Your data stays yours — nothing is shared with faculty without consent.
          </p>
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs font-medium text-emerald-soft">Profile updated</span>
            )}
            <button
              type="button"
              onClick={openEditModal}
              className="inline-flex items-center gap-2 self-start rounded-lg border border-ice/15 bg-ice/[0.05] px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-ice/70 uppercase transition hover:border-ice/30 hover:bg-ice/10 hover:text-ice"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit profile
            </button>
          </div>
        </div>

        {showEditModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="glass-ice mx-4 max-w-md w-full rounded-2xl p-6">
              <div className="flex items-center gap-2.5 mb-4">
                <CrystalMark size="sm" />
                <h2 className="text-sm font-semibold text-ink">Edit profile</h2>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="ml-auto text-muted hover:text-ink"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Name</label>
                  <input
                    value={editDraft.name}
                    onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                    className="mt-1.5 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Major / Programme</label>
                  <input
                    value={editDraft.major}
                    onChange={(e) => setEditDraft((d) => ({ ...d, major: e.target.value }))}
                    placeholder="e.g. B.S. Computer Science"
                    className="mt-1.5 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                </div>
                <div>
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">Year</label>
                  <input
                    value={editDraft.year}
                    onChange={(e) => setEditDraft((d) => ({ ...d, year: e.target.value }))}
                    placeholder="e.g. Year 3"
                    className="mt-1.5 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2 border-t border-ice/10 pt-3.5">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-3 py-1.5 text-sm font-semibold text-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={saving || !editDraft.name.trim()}
                  className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw transition hover:bg-ice-bright disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showTagModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="glass-ice mx-4 max-w-md w-full rounded-2xl p-6">
              <div className="mb-4 flex items-center gap-2.5">
                <CrystalMark size="sm" />
                <h2 className="text-sm font-semibold text-ink">
                  {displayTag ? 'Edit your VibeTag' : 'Create your VibeTag'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowTagModal(false)}
                  className="ml-auto text-muted hover:text-ink"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="rounded-xl border border-violet/30 bg-violet/10 px-4 py-3">
                <p className="font-mono text-[9px] tracking-[0.14em] text-violet-soft uppercase">
                  Your identity
                </p>
                <p className="mt-1 text-xs text-muted">
                  Shown on every post and comment you make in Community — never “Anonymous”.
                </p>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                    VibeTag
                  </label>
                  <button
                    type="button"
                    onClick={generateVibeTag}
                    className="font-mono text-[9px] tracking-[0.14em] text-violet-soft uppercase transition hover:text-ice"
                  >
                    ✦ Generate
                  </button>
                </div>
                <div className="relative mt-1.5">
                  <AtSign className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ice/40" />
                  <input
                    value={tagDraft}
                    onChange={(e) => {
                      setTagDraft(e.target.value)
                      setVibeTagError('')
                    }}
                    placeholder="e.g. pixel_ronin"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    className="w-full rounded-lg border border-ice/10 bg-thaw py-2.5 pr-3 pl-9 font-mono text-sm tracking-wide text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                  />
                </div>
                <p
                  className={
                    'mt-1.5 text-[11px] ' +
                    (vibeTagError ||
                    tagStatus === 'taken' ||
                    tagStatus === 'invalid'
                      ? 'text-rose-400'
                      : tagStatus === 'available'
                        ? 'text-emerald-soft'
                        : 'text-muted')
                  }
                >
                  {vibeTagError ||
                    (!tagDraft.trim()
                      ? '3–20 characters: letters, numbers, or underscores.'
                      : tagStatus === 'checking'
                        ? 'Checking availability…'
                        : tagStatus === 'available'
                          ? '✓ Available — this tag is yours.'
                          : tagStatus === 'taken'
                            ? 'That VibeTag is already taken. Try another.'
                            : 'Use 3–20 characters: letters, numbers, or underscores.')}
                </p>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 border-t border-ice/10 pt-3.5">
                <button
                  type="button"
                  onClick={() => setShowTagModal(false)}
                  className="px-3 py-1.5 text-sm font-semibold text-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveVibeTag}
                  disabled={
                    savingTag ||
                    tagStatus === 'taken' ||
                    tagStatus === 'checking' ||
                    !VIBE_TAG_RE.test(tagDraft.trim())
                  }
                  className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw transition hover:bg-ice-bright disabled:opacity-50"
                >
                  {savingTag ? 'Saving…' : displayTag ? 'Save VibeTag' : 'Create VibeTag'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}