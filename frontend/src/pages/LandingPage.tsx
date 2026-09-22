import { LandingNavbar } from '../components/landing/LandingNavbar'
import { Hero } from '../components/landing/Hero'
import { FeatureBento } from '../components/landing/FeatureBento'
import { BenefitsToggle } from '../components/landing/BenefitsToggle'
import { LandingFooter } from '../components/landing/LandingFooter'
import { ScrollProgressRail } from '../components/landing/ScrollProgressRail'

export function LandingPage() {
  return (
    <div className="overflow-x-hidden bg-thaw text-ice">
      <div className="page-sheen pointer-events-none fixed inset-0 z-[70]" aria-hidden />
      <div className="noise-overlay" aria-hidden />
      <LandingNavbar />
      <Hero />
      <FeatureBento />
      <BenefitsToggle />
      <LandingFooter />
      <ScrollProgressRail />
    </div>
  )
}