import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { CrystalMark } from '../CrystalMark'
import { useActiveSection } from '../../hooks/useActiveSection'

const NAV_LINKS = [
  { href: '#features', label: 'Approach' },
  { href: '#how', label: 'How it works' },
  { href: '#institutions', label: 'Science' },
]

export function LandingNavbar() {
  const [open, setOpen] = useState(false)
  const active = useActiveSection(NAV_LINKS.map((l) => l.href))

  return (
    <header className="absolute inset-x-0 top-0 z-50">
      {/* Slightly inset from left & right so the bar is a bit shorter */}
      <div
        className="
          absolute top-4 left-6 right-6
          sm:left-10 sm:right-10
          md:left-[max(1.75rem,calc((100vw-min(1400px,100vw))/2+0.08*min(1400px,100vw)+0.5rem))]
          md:right-[max(1.75rem,calc((100vw-min(1400px,100vw))/2+0.08*min(1400px,100vw)+0.5rem))]
          lg:left-[max(2.25rem,calc((100vw-min(1400px,100vw))/2+0.1*min(1400px,100vw)+0.75rem))]
          lg:right-[max(2.25rem,calc((100vw-min(1400px,100vw))/2+0.1*min(1400px,100vw)+0.75rem))]
        "
      >
        <div className="landing-nav-card">
          <div className="landing-nav-card-inner relative flex h-12 items-center px-5 sm:px-6 lg:px-8">
            <a
              href="#top"
              className="relative z-10 flex shrink-0 items-center gap-2.5 text-ice"
              aria-label="Back to top"
            >
              <CrystalMark />
              <span className="font-mono text-[10px] tracking-[0.2em] text-ice/70 uppercase">
                VibeCheck
              </span>
            </a>

            {/* Middle cluster */}
            <nav className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-10 font-mono text-[10px] font-medium tracking-[0.16em] text-ice/50 uppercase lg:flex xl:gap-12">
              {NAV_LINKS.map((link) => {
                const isActive = active === link.href
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    className={clsx(
                      'relative py-1 transition-colors duration-300',
                      isActive ? 'text-ice' : 'hover:text-ice',
                    )}
                  >
                    {link.label}
                    <span
                      className={clsx('nav-active-bar', isActive && 'nav-active-on')}
                      aria-hidden
                    />
                  </a>
                )
              })}
            </nav>

            {/* Right corner */}
            <Link
              to="/login"
              className="relative z-10 ml-auto hidden font-mono text-[10px] font-medium tracking-[0.16em] text-ice/80 uppercase transition hover:text-ice lg:block"
            >
              Begin
            </Link>

            <button
              type="button"
              className="relative z-10 ml-auto p-1.5 text-ice lg:hidden"
              onClick={() => setOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="mt-2 rounded-2xl border border-ice/15 bg-thaw/95 px-4 py-3 backdrop-blur-md lg:hidden">
            <div className="flex flex-col gap-3 font-mono text-[11px] tracking-[0.14em] text-ice/80 uppercase">
              <a href="#features" onClick={() => setOpen(false)}>
                Approach
              </a>
              <a href="#how" onClick={() => setOpen(false)}>
                How it works
              </a>
              <a href="#institutions" onClick={() => setOpen(false)}>
                Science
              </a>
              <Link to="/login" className="text-ice" onClick={() => setOpen(false)}>
                Begin
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
