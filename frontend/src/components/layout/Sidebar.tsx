import { useRef, type PointerEvent } from 'react'
import { NavLink, Link } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  CalendarRange,
  LayoutDashboard,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import clsx from 'clsx'
import { Logo } from '../Logo'
import { CrystalMark } from '../CrystalMark'

const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard },
  { to: '/app/ai', label: 'AI Assistant', icon: Bot },
  { to: '/app/community', label: 'Community', icon: Users },
  { to: '/app/clubs', label: 'Clubs', icon: UsersRound },
  { to: '/app/lms', label: 'LMS Portal', icon: BookOpen },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/study-planner', label: 'Study Planner', icon: CalendarRange },
  { to: '/app/profile', label: 'Profile', icon: UserRound },
]

type SidebarProps = {
  open: boolean
  onClose: () => void
}

function NavCard({
  to,
  label,
  icon: Icon,
  onClose,
}: {
  to: string
  label: string
  icon: LucideIcon
  onClose: () => void
}) {
  const ref = useRef<HTMLAnchorElement>(null)

  function handleMove(e: PointerEvent<HTMLAnchorElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--gx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--gy', `${e.clientY - rect.top}px`)
  }

  return (
    <NavLink
      ref={ref}
      to={to}
      end={to === '/app'}
      onClick={onClose}
      onPointerMove={handleMove}
      className={({ isActive }) =>
        clsx(
          'nav-card group relative flex items-center gap-2.5 overflow-hidden rounded-lg border px-2.5 py-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'nav-active-glow border-ice/25 bg-surface-2/80 text-ice'
            : 'border-ice/10 bg-surface-2/40 text-ice/55 hover:border-ice/20 hover:bg-surface-2/60 hover:text-ice',
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="chat-shine pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            aria-hidden
          />
          <span className="relative shrink-0">
            {isActive ? (
              <CrystalMark size="sm" />
            ) : (
              <Icon className="h-4 w-4 opacity-70" strokeWidth={1.75} />
            )}
          </span>
          <span className="relative truncate">{label}</span>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-thaw/70 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={clsx(
          'nav-rail fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-hidden border-r border-ice/10 bg-thaw-deep transition-transform duration-300 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Ambient bloom so the rail reads as a lit plane, not a flat panel. */}
        <span
          className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-violet/10 blur-3xl"
          aria-hidden
        />

        <div className="relative border-b border-ice/10">
          <Link
            to="/"
            className="flex items-center gap-1.5 px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-ice/40 uppercase transition hover:text-ice"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div className="flex h-11 items-center px-4">
            <Logo />
          </div>
        </div>

        <nav className="rise-grid relative flex-1 space-y-1.5 overflow-y-auto p-2">
          {links.map(({ to, label, icon }) => (
            <NavCard key={to} to={to} label={label} icon={icon} onClose={onClose} />
          ))}
        </nav>
      </aside>
    </>
  )
}