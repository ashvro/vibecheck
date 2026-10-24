import { useEffect, useRef, useState, Fragment } from 'react'
import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { Menu, X, BotMessageSquare, MessageCircleMore, Waves, Radar, Orbit, GraduationCap, Route, Activity } from 'lucide-react'
import { getUser } from '../../lib/api'

export function DashboardLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { pathname } = useLocation()
  const user = getUser()
  const initial = (user?.name ? String(user.name).charAt(0).toUpperCase() : 'U')

  /** Rendered on the avatar only when there is something unread. */
  const unreadNotifications = 0

  const auraRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      auraRef.current?.style.setProperty('--mx', `${e.clientX}px`)
      auraRef.current?.style.setProperty('--my', `${e.clientY}px`)
    }
    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [])

  const navGroups = [
    [
      { to: '/app/ai', label: 'AI Assistant', Icon: BotMessageSquare },
      { to: '/app/relaxation', label: 'Relaxation', Icon: Waves },
    ],
    [
      { to: '/app/community', label: 'Community', Icon: Orbit },
      { to: '/app/clubs', label: 'Clubs', Icon: MessageCircleMore },
    ],
    [
      { to: '/app', label: 'Overview', Icon: Radar },
    ],
    [
      { to: '/app/lms', label: 'LMS Portal', Icon: GraduationCap },
      { to: '/app/study-planner', label: 'Planner', Icon: Route },
    ],
    [
      { to: '/app/analytics', label: 'Analytics', Icon: Activity },
    ],
  ]

  /** Flat list for the mobile drawer, same order as the dock. */
  const navItems = navGroups.flat()
  return (
    <div className="app-shell grain relative min-h-screen bg-thaw text-ink">
      <img
        src="/hero-bg.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full object-cover z-0"
        style={{ opacity: 0.7 }}
      />
      <div className="aurora" aria-hidden>
        <span className="aurora-orb orb-a" />
        <span className="aurora-orb orb-b" />
        <span className="aurora-orb orb-c" />
      </div>
      <div ref={auraRef} className="aura-follow" aria-hidden />

      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white backdrop-blur-md lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <div
        className={`fixed top-0 left-0 z-50 h-full w-72 transform transition-transform duration-300 lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'linear-gradient(180deg, rgba(26,22,52,.95), rgba(14,10,28,.98))',
          borderRight: '1px solid rgba(150,130,255,.18)',
          backdropFilter: 'blur(30px)',
        }}
      >
        <div className="flex items-center justify-between p-4">
          <span className="text-lg font-semibold text-white">VibeCheck</span>
          <button type="button" onClick={() => setDrawerOpen(false)} className="text-white/60 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => (
            <a
              key={item.to}
              href={item.to}
              onClick={() => setDrawerOpen(false)}
              className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-[#A098C0] transition hover:bg-white/5 hover:text-white"
            >
              <item.Icon className="h-5 w-5" />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </div>

      {/* Main content with content-frame border effect */}
      <div className="relative z-10 mx-auto w-full max-w-[1680px] px-6 pt-6">
        <div className="content-frame" style={{ height: 'calc(100vh - 156px)' }}>
          <span className="content-frame-aurora" aria-hidden />
          <div
            className="content-frame-inner relative px-6 pt-[26px] pb-6"
            style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            <div
              style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
            >
              <div key={pathname} className="page-enter h-full">
                <Outlet />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating dock — primary navigation */}
      <div className="dock-wrap">
        <nav aria-label="Primary" className="dock">
          <span className="dock-floor-glow" aria-hidden />
          {navGroups.map((group, groupIndex) => (
            <Fragment key={groupIndex}>
              {groupIndex > 0 && <span className="dock-divider" aria-hidden />}
              {group.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/app'}
                  className="dock-item"
                >
                  <span className="dock-icon">
                    <Icon strokeWidth={1.7} />
                  </span>
                  <span className="dock-label">{label}</span>
                  <span className="dock-dot" aria-hidden />
                </NavLink>
              ))}
            </Fragment>
          ))}
          <NavLink
            to="/app/profile"
            className="dock-item dock-profile"
          >
            <span className="dock-icon">
              <span className="dock-avatar-letter">{initial}</span>
              {unreadNotifications > 0 && <span className="dock-avatar-dot" aria-hidden />}
            </span>
            <span className="dock-label">Profile</span>
            <span className="dock-dot" aria-hidden />
          </NavLink>
        </nav>
      </div>
    </div>
  )
}