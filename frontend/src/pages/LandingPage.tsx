import { useEffect, useRef } from 'react'
import { LandingNavbar } from '../components/landing/LandingNavbar'
import { Hero } from '../components/landing/Hero'
import { FeatureBento } from '../components/landing/FeatureBento'
import { BenefitsToggle } from '../components/landing/BenefitsToggle'
import { LandingFooter } from '../components/landing/LandingFooter'
import { ScrollProgressRail } from '../components/landing/ScrollProgressRail'

export function LandingPage() {
  const auraRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      auraRef.current?.style.setProperty('--mx', `${e.clientX}px`)
      auraRef.current?.style.setProperty('--my', `${e.clientY}px`)
    }
    window.addEventListener('pointermove', handleMove)
    return () => window.removeEventListener('pointermove', handleMove)
  }, [])

  return (
    <div className="app-shell grain relative min-h-screen overflow-x-hidden bg-thaw text-ice">
      <img
        src="/hero-bg.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 h-full w-full object-cover z-0"
        style={{ opacity: 0.7 }}
      />
      <div className="aurora" aria-hidden>
        <span className="aurora-orb orb-a" />
        <span className="aurora-orb orb-b" />
        <span className="aurora-orb orb-c" />
      </div>
      <div ref={auraRef} className="aura-follow" aria-hidden />

      <LandingNavbar />

      <div className="relative z-10 mx-auto w-full max-w-[1680px] px-12 pt-12 pb-24">
        <div
          className="content-frame"
          style={{ minHeight: 'calc(100vh - 168px)', height: 'auto', overflow: 'visible' }}
        >
          <div
            className="content-frame-inner relative px-6 pt-6 pb-6"
            style={{ minHeight: 'calc(100vh - 168px)', height: 'auto', background: 'rgba(18,15,24,0.97)' }}
          >
            <Hero />
            <FeatureBento />
            <BenefitsToggle />
            <LandingFooter />
          </div>
        </div>
      </div>

      <ScrollProgressRail />
    </div>
  )
}