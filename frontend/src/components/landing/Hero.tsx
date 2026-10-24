import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from 'react'
import clsx from 'clsx'

const AbstractBrainScene = lazy(() =>
  import('./AbstractBrainScene').then((m) => ({ default: m.AbstractBrainScene })),
)

const FULL_TEXT = 'Clarity Begins Here!'
const WORD_A = 'Clarity'
const WORD_B = 'Begins'
const WORD_C = 'Here!'

export function Hero() {
  const [crystalOpacity, setCrystalOpacity] = useState(1)
  const [scrollBoost, setScrollBoost] = useState(0)
  const [parallaxY, setParallaxY] = useState(0)
  const [typed, setTyped] = useState('')
  const [reduceMotion, setReduceMotion] = useState(false)
  const [glitching, setGlitching] = useState(false)
  const glowRef = useRef<HTMLDivElement>(null)
  const done = typed.length >= FULL_TEXT.length

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReduceMotion(prefersReduced)
    if (prefersReduced) {
      setTyped(FULL_TEXT)
      return
    }

    let i = 0
    let timer = 0

    const typeNext = () => {
      i += 1
      setTyped(FULL_TEXT.slice(0, i))
      if (i < FULL_TEXT.length) {
        const char = FULL_TEXT[i - 1]
        const delay = char === ' ' ? 120 : 70
        timer = window.setTimeout(typeNext, delay)
      } else {
        timer = window.setTimeout(() => setGlitching(true), 180)
      }
    }

    timer = window.setTimeout(typeNext, 320)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      const vh = window.innerHeight
      const fadeDistance = vh * 1.1
      setCrystalOpacity(Math.max(0, 1 - y / fadeDistance))
      setScrollBoost(Math.min(2.2, (y / vh) * 2.4))
      setParallaxY(Math.min(110, y * 0.18))
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    if (reduceMotion || !glowRef.current) return
    glowRef.current.style.transform = `translate(${e.clientX - 260}px, ${e.clientY - 260}px)`
  }

  const stageA = typed.slice(0, WORD_A.length)
  const stageB = typed.slice(WORD_A.length + 1, WORD_A.length + 1 + WORD_B.length)
  const stageC = typed.slice(WORD_A.length + 1 + WORD_B.length + 1)

  return (
    <section
      id="top"
      className="relative flex min-h-[100svh] flex-col overflow-hidden bg-transparent text-ice"
      onPointerMove={handlePointerMove}
    >
      {/* Hairline grid backdrop */}
      <div className="landing-grid pointer-events-none absolute inset-0" aria-hidden />

      {/* Deep violet halo behind the scene */}
      <div
        className="pointer-events-none absolute top-[54%] left-[68%] h-[64vh] w-[120vw] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.16),transparent_58%)]"
        aria-hidden
      />

      {/* Pointer glow */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
        <div
          ref={glowRef}
          className={clsx(
            'hero-glow absolute top-0 left-0 h-[520px] w-[520px] rounded-full',
            reduceMotion && 'hidden',
          )}
          style={{ transform: 'translate(-520px, -520px)' }}
        />
      </div>

      {/* Text left, 3D model right */}
      <div
        className="relative z-20 mx-auto flex w-full max-w-[88rem] flex-1 flex-col items-center justify-center gap-12 px-6 lg:flex-row lg:gap-20 xl:gap-28"
        style={{ opacity: crystalOpacity, transform: `translate3d(0, ${parallaxY}px, 0)` }}
      >
        <div className="flex max-w-2xl shrink-0 flex-col items-center text-center lg:items-start lg:text-left">
          <h1 className="relative z-30 font-display text-[clamp(2.6rem,6vw+0.3rem,6.5rem)] leading-[0.92] font-extrabold tracking-[-0.045em]">
            <span className="hero-word block whitespace-nowrap">{stageA}</span>
            <span className="hero-word block whitespace-nowrap">{stageB}</span>
            <span className="block whitespace-nowrap">
              <span
                className={clsx('hero-here', glitching && !reduceMotion && 'hero-glitch')}
                data-text={WORD_C}
              >
                {stageC}
              </span>
              <span
                className={clsx(
                  'hero-caret ml-3 inline-block shrink-0 align-baseline',
                  done && 'hero-caret-idle',
                )}
                aria-hidden
              />
            </span>
          </h1>
        </div>

        {/* Brain, masked into the page */}
        <div className="relative z-10 aspect-square w-[min(80vw,50vh,40rem)] shrink-0">
          <div className="hero-scene absolute inset-0">
            <div className="relative z-10 h-full w-full">
              <Suspense fallback={null}>
                <AbstractBrainScene scrollBoost={scrollBoost} />
              </Suspense>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <div
        className="pointer-events-none absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2.5"
        style={{ opacity: crystalOpacity }}
        aria-hidden
      >
        <span className="scroll-cue" />
        <span className="font-mono text-[9px] tracking-[0.32em] text-ice/40 uppercase">Scroll</span>
      </div>
    </section>
  )
}