import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useActiveSection } from '../../hooks/useActiveSection'

const SECTIONS = [
  { id: '#features', n: '01', label: 'Approach' },
  { id: '#how', n: '02', label: 'How it works' },
  { id: '#institutions', n: '03', label: 'Science' },
]

/**
 * Fixed right-hand rail showing the active section and scroll progress through
 * the narrative sections (Approach → How it works → Science). Hidden until the
 * visitor scrolls down into the Approach section.
 */
export function ScrollProgressRail() {
  const active = useActiveSection(SECTIONS.map((s) => s.id))
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const features = document.getElementById('features')
      const science = document.getElementById('institutions')
      if (!features || !science) return
      const scrollY = window.scrollY
      const vh = window.innerHeight
      const start = features.getBoundingClientRect().top + scrollY
      const end = science.getBoundingClientRect().bottom + scrollY - vh
      setVisible(scrollY + vh * 0.12 >= start)
      const span = end - start
      setProgress(span > 0 ? Math.min(1, Math.max(0, (scrollY - start) / span)) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <div
      className={clsx(
        'pointer-events-none fixed top-1/2 right-5 z-50 -translate-y-1/2 flex-col items-end gap-6 transition-opacity duration-500 flex',
        visible ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-4">
        {SECTIONS.map((s) => {
          const isActive = active === s.id
          return (
            <a key={s.id} href={s.id} className="group flex flex-col items-end gap-1">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] tracking-[0.18em] uppercase">
                  <span
                    className={clsx(
                      'transition-all duration-300',
                      isActive ? 'text-ice' : 'text-ice/40 group-hover:text-ice/70',
                    )}
                  >
                    {s.n}
                  </span>
                  <span className="mx-1 text-ice/20">/</span>
                  <span
                    className={clsx(
                      'transition-all duration-300',
                      isActive ? 'text-ice' : 'text-ice/40 group-hover:text-ice/70',
                    )}
                  >
                    {s.label}
                  </span>
                </span>
              </span>
              <span className="relative block h-px w-full overflow-hidden bg-ice/10">
                <span
                  className="absolute inset-0 h-px bg-gradient-to-r from-violet-soft to-ice transition-transform duration-500 ease-out origin-left"
                  style={{ transform: isActive ? 'scaleX(1)' : 'scaleX(0)' }}
                />
              </span>
            </a>
          )
        })}
      </div>

      <div className="flex items-center gap-2.5">
        <span className="block h-1.5 w-1.5 rotate-45 border border-violet-soft/70" aria-hidden />
        <span className="font-mono text-[10px] tracking-[0.18em] text-ice/50 tabular-nums">
          {String(Math.round(progress * 100)).padStart(2, '0')}%
        </span>
      </div>
    </div>
  )
}