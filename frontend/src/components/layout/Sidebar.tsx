import { useEffect, useState } from 'react'
import { NavLink, Link } from 'react-router-dom'
import clsx from 'clsx'
import { Search } from 'lucide-react'
import { getUser } from '../../lib/api'

const links: { to: string; label: string }[] = [
  { to: '/app', label: 'Overview' },
  { to: '/app/ai', label: 'AI Assistant' },
  { to: '/app/community', label: 'Community' },
  { to: '/app/clubs', label: 'Clubs' },
  { to: '/app/lms', label: 'LMS Portal' },
  { to: '/app/analytics', label: 'Analytics' },
  { to: '/app/study-planner', label: 'Study Planner' },
]

type SidebarProps = {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const [search, setSearch] = useState('')
  const user = getUser()
  const initial = (user?.name ? String(user.name).charAt(0).toUpperCase() : 'U')

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        const el = document.getElementById('sidebar-search')
        if (el) el.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={clsx(
          'sidebar-panel fixed top-4 left-4 z-40 flex flex-col transition-transform duration-300 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
        style={{
          width: 300,
          borderRadius: 30,
          padding: '24px 14px',
          background: 'linear-gradient(180deg, rgba(40,20,75,.92), rgba(18,10,38,.96))',
          border: '1px solid rgba(139,92,246,.35)',
          boxShadow: '0 30px 70px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.14)',
          backdropFilter: 'blur(30px)',
          WebkitBackdropFilter: 'blur(30px)',
          height: 'calc(100vh - 32px)',
        }}
      >
        {/* Brand header */}
        <Link
          to="/"
          className="flex items-center gap-3 px-2 pb-1 no-underline"
          onClick={onClose}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 58" width="58" height="58" style={{ filter: 'drop-shadow(0 0 14px rgba(192,107,255,.5))' }}>
            <defs>
              <linearGradient id="hg" x1="0" y1="0" x2="58" y2="58" gradientUnits="userSpaceOnUse">
                <stop offset="0" stop-color="#ff7ac3"/>
                <stop offset="0.5" stop-color="#c06bff"/>
                <stop offset="1" stop-color="#5b21b6"/>
              </linearGradient>
            </defs>
            <g fill="none" stroke="url(#hg)" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
              <path d="M20 38 L12 26"/>
              <path d="M40 32 L48 14"/>
              <path d="M28 17 L24 28"/>
              <path d="M34 16 L30 28"/>
              <path d="M40 19 L36 29"/>
              <path d="M20 34 C17 41 18 47 23 50 L23 57 L37 57 L37 50 C43 46 45 40 40 32 Q30 25 20 34 Z" fill="url(#hg)" stroke="none"/>
            </g>
            <g fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2" stroke-linecap="round">
              <path d="M22 37 L25 44 L28 37"/>
              <path d="M38 38 A4 4 0 1 0 38 43"/>
            </g>
            <g fill="#ff7ac3">
              <path d="M54 6 L55 8 L57 9 L55 10 L54 12 L53 10 L51 9 L53 8 Z" opacity="0.9"/>
            </g>
          </svg>
          <div className="flex flex-col gap-0.5">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 22" width="130" height="19" style={{ height: 19 }}>
              <defs>
                <linearGradient id="wg" x1="0" y1="0" x2="130" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stop-color="#c06bff"/>
                  <stop offset="1" stop-color="#ff7ac3"/>
                </linearGradient>
              </defs>
              <text x="2" y="17" font-family="'Segoe UI', system-ui, sans-serif" font-size="18" font-weight="700" fill="url(#wg)" letter-spacing="0.5">VibeCheck</text>
            </svg>
            <span style={{ fontSize: 12, color: '#8f86b6', letterSpacing: '.02em' }}>Student wellbeing</span>
          </div>
        </Link>

        {/* Divider */}
        <div
          className="my-0"
          style={{
            height: 1,
            margin: '22px 10px 20px',
            background: 'linear-gradient(90deg, transparent, rgba(196,165,255,.5), rgba(255,122,195,.4), transparent)',
          }}
        />

        {/* Search bar */}
        <div
          className="flex items-center gap-2"
          style={{
            height: 42,
            borderRadius: 21,
            background: 'rgba(255,255,255,.045)',
            border: '1px solid rgba(255,255,255,.10)',
            margin: '0 4px 22px',
            padding: '0 14px',
          }}
        >
          <Search size={15} style={{ color: '#7f77a6', flexShrink: 0 }} />
          <input
            id="sidebar-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search anything"
            className="flex-1 bg-transparent outline-none"
            style={{ fontSize: 14, color: '#a89fcc' }}
          />
          <span
            style={{
              fontFamily: 'IBM Plex Mono, ui-monospace, monospace',
              fontSize: '10.5px',
              borderRadius: 7,
              background: 'rgba(255,255,255,.07)',
              border: '1px solid rgba(255,255,255,.10)',
              padding: '2px 6px',
              color: '#7f77a6',
            }}
          >
            Ctrl K
          </span>
        </div>

        {/* Tabs */}
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/app'}
              onClick={onClose}
              className={({ isActive }) =>
                clsx('sidebar-tab', isActive && 'sidebar-tab--active')
              }
            >
              {({ isActive }) => (
                <>
                  <span className="sidebar-tab-label">{label}</span>
                  {isActive && (
                    <>
                      <span className="sidebar-tab-accent" aria-hidden />
                      <span className="sidebar-tab-dot" aria-hidden />
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Profile card pinned to bottom */}
        <Link
          to="/app/profile"
          onClick={onClose}
          className="sidebar-profile"
        >
          <div
            className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)' }}
          >
            {initial}
          </div>
          <div className="flex flex-1 flex-col justify-center">
            <span style={{ fontSize: '14.5px', fontWeight: 700, color: '#fff' }}>Your profile</span>
            <span style={{ fontSize: 12, color: '#8f86b6' }}>Settings · Log out</span>
          </div>
          <span
            className="shrink-0 rounded-full"
            style={{
              width: 10,
              height: 10,
              background: '#34d399',
              boxShadow: '0 0 0 4px rgba(52,211,153,.16)',
            }}
          />
        </Link>
      </aside>
    </>
  )
}
