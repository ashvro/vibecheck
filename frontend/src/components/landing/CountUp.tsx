import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { useInView } from '../../hooks/useInView'

type CountUpProps = {
  to: number
  duration?: number
  className?: string
}

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Counts from 0 to `to` once the element enters the viewport.
 */
export function CountUp({ to, duration = 900, className }: CountUpProps) {
  const [ref, inView] = useInView<HTMLSpanElement>({ once: true, threshold: 0.6 })
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(Math.round(to * easeOutExpo(t)))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, duration])

  return (
    <span ref={ref} className={clsx('inline-block tabular-nums', className)}>
      {value}
    </span>
  )
}