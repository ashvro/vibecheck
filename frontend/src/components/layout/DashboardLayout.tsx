import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'

export function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { pathname } = useLocation()

  /* Cursor-tracked ambient light — pure decoration for the spatial stage. */
  const auraRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      auraRef.current?.style.setProperty('--mx', `${e.clientX}px`)
      auraRef.current?.style.setProperty('--my', `${e.clientY}px`)
    }
    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [])

  return (
    <div className="app-shell grain landing-frost relative min-h-screen bg-bg text-ink">
      <div className="aurora" aria-hidden>
        <span className="aurora-orb orb-a" />
        <span className="aurora-orb orb-b" />
        <span className="aurora-orb orb-c" />
      </div>
      <div ref={auraRef} className="aura-follow" aria-hidden />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="relative z-10 lg:pl-[332px]">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white backdrop-blur-md lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <main className="p-5 sm:p-6 lg:p-8">
          {/* Keyed by route so every navigation replays the spatial entrance. */}
          <div key={pathname} className="page-enter">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}