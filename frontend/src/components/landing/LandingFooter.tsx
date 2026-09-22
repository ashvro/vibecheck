import { Link } from 'react-router-dom'
import { ArrowUpRight, MessagesSquare, Send, Hash } from 'lucide-react'
import { CrystalMark } from '../CrystalMark'
import { GhostNum } from '../landing/GhostNum'

const productLinks = [
  { label: 'Talk it out', href: '#features' },
  { label: 'Peer space', href: '#features' },
  { label: 'Catch risk early', href: '#features' },
  { label: 'Launch app', href: '/app' },
]

const exploreLinks = [
  { label: 'Approach', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Science', href: '#institutions' },
  { label: 'For students', href: '#students' },
]

const careLinks = [
  { label: 'Crisis resources', href: '#institutions' },
  { label: 'For educators', href: '#students' },
  { label: 'Stay anonymous', href: '#institutions' },
]

const socials = [
  { label: 'Community', icon: MessagesSquare },
  { label: 'Updates', icon: Send },
  { label: 'Campus channel', icon: Hash },
]

function FooterLink({ label, href }: { label: string; href: string }) {
  const inner = (
    <span className="group inline-flex items-center gap-1.5">
      {label}
      <ArrowUpRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
    </span>
  )
  if (href.startsWith('/')) {
    return (
      <Link
        to={href}
        className="transition hover:text-ice group"
      >
        {inner}
      </Link>
    )
  }
  return (
    <a href={href} className="transition hover:text-ice group">
      {inner}
    </a>
  )
}

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-ice/10 bg-thaw-deep text-ice">
      <div className="landing-grid pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="haze-blob pointer-events-none absolute -top-56 left-1/2 h-[28rem] w-[52rem] -translate-x-1/2 rounded-full bg-violet/15 blur-[140px]"
        aria-hidden
      />
      <div className="relative">
        <GhostNum>04</GhostNum>
        <div className="relative z-10 mx-auto max-w-[1100px] px-5 sm:px-8 lg:px-10">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-ice/10 py-8">
            <span className="mr-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-ice/35 uppercase">
              <span className="footer-live-dot h-1.5 w-1.5 rounded-full bg-emerald-soft" aria-hidden />
              What ships inside
            </span>
            <span className="footer-pill flex items-center gap-2 rounded-full border border-ice/10 bg-white/[0.04] px-3.5 py-1.5">
              <span className="footer-pill-dots" aria-hidden />
              <span className="font-mono text-[9px] tracking-[0.14em] text-ice/55 uppercase">
                mood pulse
              </span>
            </span>
            <span className="footer-pill flex items-center gap-2 rounded-full border border-ice/10 bg-white/[0.04] px-3.5 py-1.5">
              <span className="footer-pill-bars" aria-hidden />
              <span className="font-mono text-[9px] tracking-[0.14em] text-ice/55 uppercase">
                grades
              </span>
            </span>
            <span className="footer-pill flex items-center gap-2 rounded-full border border-ice/10 bg-white/[0.04] px-3.5 py-1.5">
              <span className="footer-pill-alert" aria-hidden />
              <span className="font-mono text-[9px] tracking-[0.14em] text-ice/55 uppercase">
                early alerts
              </span>
            </span>
          </div>

          <div className="flex flex-col items-start justify-between gap-8 py-16 sm:flex-row sm:items-end">
            <div>
              <div className="flex items-center gap-3">
                <CrystalMark spinOnView />
                <p className="font-mono text-[11px] tracking-[0.18em] text-ice/45 uppercase">
                  Ready when you are
                </p>
              </div>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight sm:text-4xl">
                Start with clarity.
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-ice/45">
                One quiet place for feelings, grades, and risk — no dashboards to babysit.
              </p>
            </div>
            <Link to="/app" className="group landing-cta flex overflow-hidden">
              <span className="flex items-center bg-ice px-5 py-3.5 text-sm font-semibold text-thaw transition group-hover:bg-ice-bright">
                Launch app
              </span>
              <span className="flex w-12 items-center justify-center bg-thaw-deep text-ice transition group-hover:bg-black">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </Link>
          </div>

          <div className="grid gap-10 border-t border-ice/10 py-12 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.4fr]">
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-ice/30 uppercase">
                Product
              </p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                {productLinks.map((link) => (
                  <li key={link.label} className="text-ice/50">
                    <FooterLink label={link.label} href={link.href} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-ice/30 uppercase">
                Explore
              </p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                {exploreLinks.map((link) => (
                  <li key={link.label} className="text-ice/50">
                    <FooterLink label={link.label} href={link.href} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-ice/30 uppercase">
                Care
              </p>
              <ul className="mt-4 space-y-2.5 text-[13px]">
                {careLinks.map((link) => (
                  <li key={link.label} className="text-ice/50">
                    <FooterLink label={link.label} href={link.href} />
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-ice/30 uppercase">
                Say hello
              </p>
              <a
                href="mailto:hello@vibecheck.study"
                className="mt-4 inline-flex items-center gap-2 font-mono text-[12px] tracking-[0.08em] text-ice/60 transition hover:text-ice"
              >
                hello@vibecheck.study
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <p className="mt-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ice/35 uppercase">
                <span className="footer-live-dot h-1.5 w-1.5 rounded-full bg-emerald-soft" aria-hidden />
                student beta · intake open
              </p>
              <div className="mt-5 flex gap-2.5">
                {socials.map(({ label, icon: Icon }) => (
                  <a
                    key={label}
                    href="#"
                    aria-label={label}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-ice/15 text-ice/45 transition hover:border-ice/40 hover:text-ice"
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start justify-between gap-6 border-t border-ice/10 py-8 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <CrystalMark />
              <span className="font-mono text-[10px] tracking-[0.18em] text-ice/50 uppercase">
                Clarity over noise
              </span>
            </div>
            <p className="max-w-xl text-xs leading-relaxed text-ice/30">
              If you are in crisis, call or text 988 (US) or visit your campus counseling center.
              VibeCheck supports — it does not replace — professional care. © 2026 VibeCheck Studio.
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}