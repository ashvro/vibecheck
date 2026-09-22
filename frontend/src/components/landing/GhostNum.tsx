import { useEffect, useRef, type ReactNode } from 'react'

type GhostNumProps = {
  children: ReactNode
}

/**
 * Oversized background numeral that drifts against scroll and fades in as its
 * section approaches the viewport centre.
 */
export function GhostNum({ children }: GhostNumProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0

    const update = () => {
      raf = 0
      const rect = el.getBoundingClientRect()
      const vh = window.innerHeight
      const center = rect.top + rect.height / 2 - vh / 2
      const drift = center * 0.18
      const fade = Math.max(0, Math.min(1, 1 - Math.abs(center) / (vh * 0.42)))
      el.style.transform = `translate3d(0, ${drift.toFixed(1)}px, 0)`
      el.style.opacity = String(Math.max(0, fade))
    }

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <span ref={ref} className="ghost-num" aria-hidden>
      {children}
    </span>
  )
}