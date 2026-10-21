import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, NavLink } from 'react-router-dom'
import { Menu, X, LayoutDashboard, Bot, Users, UsersRound, Heart, BookOpen, BarChart3, CalendarRange } from 'lucide-react'
import clsx from 'clsx'
import { getUser } from '../../lib/api'

export function DashboardLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { pathname } = useLocation()
  const user = getUser()
  const initial = (user?.name ? String(user.name).charAt(0).toUpperCase() : 'U')

  const auraRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      auraRef.current?.style.setProperty('--mx', `${e.clientX}px`)
      auraRef.current?.style.setProperty('--my', `${e.clientY}px`)
    }
    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [])

  const navItems = [
    { to: '/app', label: 'Overview', Icon: LayoutDashboard },
    { to: '/app/ai', label: 'AI Assistant', Icon: Bot },
    { to: '/app/community', label: 'Community', Icon: Users },
    { to: '/app/clubs', label: 'Clubs', Icon: UsersRound },
    { to: '/app/relaxation', label: 'Relaxation', Icon: Heart },
    { to: '/app/lms', label: 'LMS Portal', Icon: BookOpen },
    { to: '/app/analytics', label: 'Analytics', Icon: BarChart3 },
    { to: '/app/study-planner', label: 'Planner', Icon: CalendarRange },
  ]

  return (
    <div
      className="relative min-h-screen text-ink"
      style={{
        background: '#0B0918',
        fontFamily: 'Poppins, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* Space background image */}
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: 'url(/vibecheck_space_background.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
        aria-hidden
      />

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

      {/* Content area with glow frame */}
      <div className="relative z-10 flex justify-center px-4 pt-[60px] pb-[222px]">
        <div
          className="relative w-full"
          style={{
            maxWidth: 1300,
            borderRadius: 44,
            padding: '1.6px',
            background: 'linear-gradient(135deg, #7860FF 0%, #D060F2 100%)',
            boxShadow: '0 0 40px rgba(140,100,255,.28)',
          }}
        >
          <div
            style={{
              borderRadius: 42,
              background: 'rgba(26,22,52,.7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              padding: '24px',
              minHeight: 'calc(100vh - 282px)',
              overflow: 'hidden',
            }}
          >
            {/* Bottom fade mask */}
            <div
              style={{
                maskImage: 'linear-gradient(to bottom, #000 calc(100% - 48px), transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 48px), transparent)',
              }}
            >
              <div style={{ maxWidth: 1210, margin: '0 auto', paddingBottom: 150 }}>
                <div key={pathname} className="page-enter">
                  <Outlet />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-[58px] left-1/2 z-40 hidden -translate-x-1/2 items-center gap-1 rounded-[46px] border px-4 lg:flex"
        style={{
          width: 1320,
          height: 92,
          background: 'rgba(24,20,52,.93)',
          borderColor: 'rgba(118,104,205,.6)',
          borderWidth: 2,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        }}
        aria-label="Main"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/app'}
            className={({ isActive }) =>
              clsx(
                'relative flex flex-1 flex-col items-center justify-center gap-1 text-[13px] transition',
                isActive ? 'text-white' : 'text-[#968EB9] hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div
                    className="absolute flex items-center justify-center rounded-full"
                    style={{
                      width: 84,
                      height: 84,
                      top: -40,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#AC52EE',
                      border: '2px solid rgba(255,255,255,.3)',
                      boxShadow: '0 12px 32px rgba(168,85,247,.30)',
                    }}
                  >
                    <item.Icon className="h-6 w-6 text-white" />
                  </div>
                )}
                {!isActive && <item.Icon className="h-5 w-5" />}
                <span className={clsx(isActive && 'mt-8')}>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <NavLink
          to="/app/profile"
          className="ml-2 flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-full border-2 text-white transition hover:scale-105"
          style={{
            borderColor: 'rgba(184,164,224,.5)',
            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
          }}
        >
          <span className="text-lg font-bold">{initial}</span>
        </NavLink>
      </nav>
    </div>
  )
}