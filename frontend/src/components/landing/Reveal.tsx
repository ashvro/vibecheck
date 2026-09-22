import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'

type RevealProps = {
  children: ReactNode
  className?: string
  delay?: number
  /** Wipe-up panel reveal instead of the plain fade/slide. */
  mask?: boolean
}

/**
 * Fades + slides its content in when it scrolls into view.
 *
 * The mask wipe lives on an inner wrapper so the observed element is never
 * clipped/transformed to zero — otherwise IntersectionObserver never fires.
 */
export function Reveal({ children, className, delay = 0, mask = false }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={clsx('reveal', shown && 'reveal-visible', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {mask ? (
        <div
          className={clsx('reveal-mask h-full', shown && 'reveal-mask-visible')}
          style={delay ? { transitionDelay: `${delay}ms` } : undefined}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  )
}