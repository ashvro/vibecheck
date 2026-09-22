import { useEffect, useState } from 'react'

/**
 * Report which of the given section ids currently sits in a horizontal band around
 * the viewport centre. Accepts ids with or without the leading `#`.
 */
export function useActiveSection(ids: string[], band = 0.4): string | null {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const rootMargin = `${-band * 100}% 0px ${-band * 100}% 0px`
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(`#${entry.target.id}`)
        }
      },
      { rootMargin, threshold: 0 },
    )
    for (const id of ids) {
      const el = document.getElementById(id.replace(/^#/, ''))
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  return active
}