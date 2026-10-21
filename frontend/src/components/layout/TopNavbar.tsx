import { Bell, Menu } from 'lucide-react'

type TopNavbarProps = {
  onMenuClick: () => void
}

export function TopNavbar({ onMenuClick }: TopNavbarProps) {
  return (
    <header className="nav-topbar hairline-grad sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ice/10 bg-thaw/70 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="p-2 text-ice/50 transition hover:bg-ice/5 hover:text-ice lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>



      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          className="relative p-2 text-ice/45 transition hover:bg-ice/5 hover:text-ice"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-ice" />
        </button>

        <div className="ml-1 hidden h-8 w-8 items-center justify-center border border-ice/20 bg-ice/10 text-[11px] font-semibold text-ice sm:flex">
          AR
        </div>
      </div>
    </header>
  )
}
