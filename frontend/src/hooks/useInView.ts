import { useEffect, useRef, useState } from 'react'

type UseInViewOptions = IntersectionObserverInit & { once?: boolean }

/**
 * Tracks whether an element is in the viewport. With `once` it stops observing after first
 * reveal; otherwise it keeps reacting to scroll so animations can replay.
 */
export function useInView<T extends HTMLElement>(options?: UseInViewOptions) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const { once = true, threshold = 0.35, root = null, rootMargin } = options ?? {}
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) observer.unobserve(el)
        } else {
          setInView(false)
        }
      },
      { threshold, root, rootMargin },
    )

    observer.observe(el)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return [ref, inView] as const
}