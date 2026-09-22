import { Link } from 'react-router-dom'

type LogoProps = {
  className?: string
  showWordmark?: boolean
}

export function Logo({ className = '', showWordmark = true }: LogoProps) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="crystal-mark crystal-mark-lg" aria-hidden />
      {showWordmark && (
        <span className="font-mono text-[10px] font-medium tracking-[0.2em] text-ice/70 uppercase">
          VibeCheck
        </span>
      )}
    </Link>
  )
}
