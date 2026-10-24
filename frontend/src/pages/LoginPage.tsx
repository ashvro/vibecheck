import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Eye,  ArrowLeft,
  Loader2,
} from 'lucide-react'
import { getToken, getUser } from '../lib/api'

type Role = 'student' | 'teacher' | 'admin'

const VIBE_TAG_RE = /^[A-Za-z0-9_]{3,20}$/
type TagStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid'


export function LoginPage() {
  const [role, setRole] = useState<Role | null>(null)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  // Name of the previous session, if one is still stored in the browser.
  // Shown as a banner so returning users can hop straight in; signing out
  // from the banner clears it and reveals the full sign-in form below.
  const [previousName] = useState<string | null>(() => {
    const user = getUser() as { name?: unknown } | null
    return getToken() ? (typeof user?.name === 'string' ? user.name : null) : null
  })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [vibeTag, setVibeTag] = useState('')
  const [tagStatus, setTagStatus] = useState<TagStatus>('idle')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const isSignin = mode === 'signin'
  const tagTrimmed = vibeTag.trim()
  // Valid format and not known-taken. If the availability ping fails we still let
  // the attempt through — the server is the final authority and answers with 409.
  const tagOk = VIBE_TAG_RE.test(tagTrimmed) && tagStatus !== 'taken' && tagStatus !== 'checking'

  // Live availability of the tag the user is typing.
  useEffect(() => {
    if (isSignin) return
    if (!tagTrimmed) {
      setTagStatus('idle')
      return
    }
    if (!VIBE_TAG_RE.test(tagTrimmed)) {
      setTagStatus('invalid')
      return
    }
    setTagStatus('checking')
    const timer = setTimeout(() => {
      fetch(`/api/auth/vibetag/check?tag=${encodeURIComponent(tagTrimmed)}`)
        .then((r) => r.json())
        .then((d: { available?: boolean }) => setTagStatus(d.available ? 'available' : 'taken'))
        .catch(() => setTagStatus('idle'))
    }, 350)
    return () => clearTimeout(timer)
  }, [tagTrimmed, isSignin])

  function suggestVibeTag() {
    const tag = 'vibe' + String(Math.floor(100000 + Math.random() * 900000))
    setVibeTag(tag)
    setError('')
  }

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
              : { name: name.trim(), email: email.trim(), password, role, vibeTag: tagTrimmed },
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
      window.location.assign('/app')
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-thaw text-ice">
      <div className="relative z-10 flex min-h-screen items-center justify-center px-12 py-12">
        <div className="content-frame w-full max-w-[1680px]" style={{ minHeight: 'calc(100vh - 96px)' }}>
          <div className="content-frame-inner flex min-h-[calc(100vh-96px)] w-full px-6 py-6 gap-6">
            <div className="hidden lg:block relative w-1/2 overflow-hidden rounded-2xl">
              <img
                src="/loginbg.jpeg"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ imageRendering: 'auto' }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-thaw-deep/40">
                <div className="text-center px-6">
                  <p className="font-mono text-[12px] tracking-[0.28em] text-ice/80 uppercase">
                    Welcome back
                  </p>
                  <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-ice">
                    Your clarity starts here.
                  </h2>
                  <p className="mt-3 text-base leading-relaxed text-ice/70">
                    Sign in to continue to your campus support network.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex w-full lg:w-1/2 items-center justify-center">
              <div className="w-full">
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ice/50 uppercase transition hover:text-ice"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Link>

          <div className="flex h-[720px] flex-col rounded-3xl border border-white/10 bg-[#17111f] p-10 shadow-[0_20px_60px_rgba(0,0,0,0.4)] transition-all duration-[120ms]">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => navigate('/')}
                aria-label="Back to home"
                className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/10 bg-white/5 text-ice/70 transition hover:text-ice focus:outline-none focus:ring-2 focus:ring-[#c9b6ff]"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              {previousName && (
                <div className="flex items-center gap-2">
                  <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gradient-to-br from-[#c9b6ff] to-[#8b5cf6] text-xs font-bold text-[#1b1033]">
                    {previousName.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-[#f1ecf8]">{previousName}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/app')}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-[#f1ecf8] transition hover:bg-white/10"
                  >
                    Continue
                  </button>
                </div>
              )}
            </div>

            <h1 className="text-center font-['Bricolage_Grotesque'] text-[44px] font-bold leading-tight tracking-tight text-[#f1ecf8]">
              {isSignin ? 'Welcome back' : 'Join VibeCheck'}
            </h1>

            <div className="mt-8 flex rounded-xl border border-white/10 bg-[#1f1829] p-1">
              {(['student', 'teacher', 'admin'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition-all duration-[120ms] ${
                    role === r
                      ? 'bg-white/10 text-[#f1ecf8] ring-1 ring-inset ring-[#c9b6ff]/60'
                      : 'text-[#9b90ad] hover:text-[#f1ecf8]'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="mt-6 space-y-4">
              {!isSignin && (
                <div>
                  <label className="mb-2 block text-[15px] text-[#9b90ad]">Full name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your full name"
                    required className="h-[46px] w-full rounded-xl border border-white/10 bg-[#1f1829] px-4 text-[15px] text-[#f1ecf8] outline-none placeholder:text-[#9b90ad]/60 focus:border-[#c9b6ff] focus:ring-4 focus:ring-[#c9b6ff]/20"
                  />
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[15px] text-[#9b90ad]">
                    {isSignin ? 'Email' : 'Email'}
                  </label>
                  {isSignin && (
                    <button type="button" className="text-[14px] text-[#c9b6ff] hover:underline">
                      Forgot?
                    </button>
                  )}
                </div>
                <input
                  type={isSignin ? 'text' : 'email'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isSignin ? 'Email or VibeTag' : 'you@gmail.com'}
                  required className="h-[46px] w-full rounded-xl border border-white/10 bg-[#1f1829] px-4 text-[15px] text-[#f1ecf8] outline-none placeholder:text-[#9b90ad]/60 focus:border-[#c9b6ff] focus:ring-4 focus:ring-[#c9b6ff]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-[15px] text-[#9b90ad]">Password</label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isSignin ? '••••••••' : 'At least 8 characters'}
                    required className="h-[46px] w-full rounded-xl border border-white/10 bg-[#1f1829] px-4 pr-12 text-[15px] text-[#f1ecf8] outline-none placeholder:text-[#9b90ad]/60 focus:border-[#c9b6ff] focus:ring-4 focus:ring-[#c9b6ff]/20"
                  />
                  <button
                    type="button"
                    aria-label="Show password"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b90ad] hover:text-[#f1ecf8]"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {!isSignin && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[15px] text-[#9b90ad]">VibeTag</label>
                    <button
                      type="button"
                      onClick={suggestVibeTag}
                      className="text-[14px] text-[#c9b6ff] hover:underline"
                    >
                      Shuffle
                    </button>
                  </div>
                  <input
                    type="text"
                    value={vibeTag}
                    onChange={(e) => setVibeTag(e.target.value)}
                    placeholder="Your Unique Tag"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required className="h-[46px] w-full rounded-xl border border-white/10 bg-[#1f1829] px-4 text-[15px] text-[#f1ecf8] outline-none placeholder:text-[#9b90ad]/60 focus:border-[#c9b6ff] focus:ring-4 focus:ring-[#c9b6ff]/20"
                  />
                </div>
              )}

              {error && (
                <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs font-medium text-rose-400">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={
                  loading ||
                  !email.trim() ||
                  !password.trim() ||
                  (!isSignin && (!name.trim() || !tagOk))
                }
                className="h-[56px] w-full rounded-xl bg-[#c9b6ff] text-[15px] font-bold text-[#1b1033] transition-all duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />}
                {isSignin ? 'Sign in' : 'Create account'}
              </button>
            </form>

            <p className="mt-8 text-center text-sm text-[#9b90ad]">
              {isSignin ? 'New here?' : 'Have an account?'}{' '}
              <button
                type="button"
                onClick={() => setMode(isSignin ? 'signup' : 'signin')}
                className="font-bold text-[#f1ecf8] underline-offset-4 hover:underline"
              >
                {isSignin ? 'Create account' : 'Sign in'}
              </button>
            </p>
          </div>

          <p className="mt-6 text-center font-mono text-[9px] tracking-[0.16em] text-ice/30 uppercase">
            VibeCheck · Campus mental-health network
          </p>
        </div>
      </div>
      </div>
      </div>
      </div>
    </div>
  )
}