import { useEffect, useState } from 'react'

/**
 * Report which of the given section ids currently sits in a horizontal band around
 * the viewport centre. Accepts ids with or without the leading `#`.
 */
export function useActiveSection(ids: string[]): string | null {
  const normalized = ids.map((id) => id.replace(/^#/, ''))
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    function update() {
      const center = window.scrollY + window.innerHeight * 0.45
      let current: string | null = null
      for (const id of normalized) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top + window.scrollY
        if (top <= center) current = `#${id}`
      }
      if (current) setActive(current)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [normalized.join(',')])

  return active
}