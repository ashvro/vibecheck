import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  GraduationCap,
  Lock,
  Loader2,
  Mail,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { CrystalMark } from '../components/CrystalMark'

type Role = 'student' | 'teacher' | 'admin'

const roles: {
  value: Role
  label: string
  desc: string
  icon: LucideIcon
  accent: string
}[] = [
  {
    value: 'student',
    label: 'Student',
    desc: 'Courses, clubs & well-being on campus',
    icon: UserRound,
    accent: '#9db8a8',
  },
  {
    value: 'teacher',
    label: 'Teacher',
    desc: 'Classes, assignments & student insights',
    icon: GraduationCap,
    accent: '#8b5cf6',
  },
  {
    value: 'admin',
    label: 'Admin',
    desc: 'Manage the VibeCheck network & users',
    icon: ShieldCheck,
    accent: '#d4b896',
  },
]

export function LoginPage() {
  const [role, setRole] = useState<Role | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const isSignin = mode === 'signin'
  const activeRole = roles.find((r) => r.value === role)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(
        isSignin ? '/api/auth/signin' : '/api/auth/signup',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isSignin
              ? { email: email.trim(), password }
              : { name: name.trim(), email: email.trim(), password, role },
          ),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      localStorage.setItem('vibecheck.token', data.token)
      localStorage.setItem('vibecheck.user', JSON.stringify(data.user))
      navigate('/app')
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-thaw text-ice">
      <div className="page-sheen pointer-events-none fixed inset-0 z-[70]" aria-hidden />
      <div className="noise-overlay" aria-hidden />

      <div className="landing-grid absolute inset-0 opacity-40" aria-hidden />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ice/50 uppercase transition hover:text-ice"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>

          <div className="glass-ice rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2.5">
                <CrystalMark spinOnView />
                <span className="font-mono text-[10px] tracking-[0.2em] text-ice/70 uppercase">
                  VibeCheck
                </span>
              </div>
              <h1 className="font-display mt-5 text-2xl font-bold tracking-tight text-ink">
                {role ? activeRole?.label + ' sign in' : 'Continue as'}
              </h1>
              <p className="mt-1.5 text-sm text-muted">
                {role
                  ? 'Sign in to continue to the network'
                  : 'Pick your role to get started'}
              </p>
            </div>

            {!role ? (
              <div className="mt-7 space-y-3">
                {roles.map((r) => {
                  const Icon = r.icon
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className="group flex w-full items-center gap-3.5 rounded-xl border border-ice/10 bg-surface-2/40 p-4 text-left transition hover:border-violet/40 hover:shadow-[0_0_20px_rgba(139,92,246,0.12)]"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${r.accent}2e`, color: r.accent }}
                      >
                        <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink">{r.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{r.desc}</span>
                      </span>
                      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ice/30 transition group-hover:translate-x-0.5 group-hover:text-ice" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <>
                <div className="mt-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setRole(null)}
                    aria-label="Change role"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ice/10 text-muted transition hover:text-ink"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      backgroundColor: `${activeRole?.accent}2e`,
                      color: activeRole?.accent,
                    }}
                  >
                    {(() => {
                      const Icon = activeRole?.icon ?? UserRound
                      return <Icon className="h-4.5 w-4.5" strokeWidth={1.75} />
                    })()}
                  </span>
                  <p className="text-sm font-semibold text-ink">
                    {activeRole?.label}
                    <span className="ml-2 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      {role === 'teacher' ? 'Faculty' : role}
                    </span>
                  </p>
                </div>

                <form onSubmit={submit} className="mt-5 space-y-4">
                  {!isSignin && (
                    <div>
                      <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                        Full name
                      </label>
                      <div className="relative mt-1.5">
                        <UserRound className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ice/40" />
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Alex Rivera"
                          className="w-full rounded-lg border border-ice/10 bg-thaw py-2.5 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      Email (Gmail)
                    </label>
                    <div className="relative mt-1.5">
                      <Mail className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ice/40" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@gmail.com"
                        className="w-full rounded-lg border border-ice/10 bg-thaw py-2.5 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
                      Password
                    </label>
                    <div className="relative mt-1.5">
                      <Lock className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ice/40" />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full rounded-lg border border-ice/10 bg-thaw py-2.5 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-400">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={
                      loading || !email.trim() || !password.trim() || (!isSignin && !name.trim())
                    }
                    className="glow-cta flex w-full items-center justify-center gap-2 rounded-lg bg-ice py-2.5 text-sm font-semibold text-thaw transition hover:bg-ice-bright disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
                  >
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSignin ? 'Sign in' : 'Create account'}
                  </button>
                </form>

                <button
                  type="button"
                  onClick={() => setMode(isSignin ? 'signup' : 'signin')}
                  className="mt-5 w-full text-center text-xs font-medium text-muted transition hover:text-ice"
                >
                  {isSignin ? (
                    <>
                      New here? <span className="font-semibold text-violet-soft">Sign up</span>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <span className="font-semibold text-violet-soft">Sign in</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          <p className="mt-6 text-center font-mono text-[9px] tracking-[0.16em] text-ice/30 uppercase">
            VibeCheck · Campus mental-health network
          </p>
        </div>
      </div>
    </div>
  )
}