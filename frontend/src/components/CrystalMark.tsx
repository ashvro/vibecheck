import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import clsx from 'clsx'

type CrystalMarkProps = HTMLAttributes<HTMLSpanElement> & {
  size?: 'sm' | 'md' | 'lg'
  spinOnView?: boolean
}

export function CrystalMark({
  className,
  size = 'md',
  spinOnView = false,
  ...props
}: CrystalMarkProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [spin, setSpin] = useState(false)

  useEffect(() => {
    if (!spinOnView || !ref.current) return
    const node = ref.current
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSpin(true)
          observer.disconnect()
        }
      },
      { threshold: 0.6 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [spinOnView])

  return (
    <span
      ref={ref}
      aria-hidden
      className={clsx(
        'crystal-mark',
        size === 'lg' && 'crystal-mark-lg',
        size === 'sm' && 'scale-75',
        spin && 'crystal-spin-once',
        className,
      )}
      {...props}
    />
  )
}
