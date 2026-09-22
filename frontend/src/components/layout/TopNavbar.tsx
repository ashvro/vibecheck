import { useState } from 'react'
import { Bell, Menu, Search } from 'lucide-react'
import clsx from 'clsx'
import { moodOptions } from '../../data/mockData'
import { api } from '../../lib/api'

type TopNavbarProps = {
  onMenuClick: () => void
}

export function TopNavbar({ onMenuClick }: TopNavbarProps) {
  const [mood, setMood] = useState<string | null>(null)
  const [showMood, setShowMood] = useState(false)

  function selectMood(id: string) {
    setMood(id)
    setShowMood(false)
    api
      .post('/api/moods', { mood: id, text: moodOptions.find((m) => m.id === id)?.label ?? id })
      .catch(() => {})
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ice/10 bg-thaw/80 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="p-2 text-ice/50 transition hover:bg-ice/5 hover:text-ice lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative hidden min-w-0 flex-1 md:block md:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-ice/35" />
        <input
          type="search"
          placeholder="Search…"
          className="w-full border border-ice/10 bg-ice/[0.03] py-1.5 pr-3 pl-9 text-sm text-ink outline-none transition placeholder:text-ice/35 focus:border-ice/30 focus:bg-ice/[0.05]"
        />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMood((v) => !v)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition',
              mood ? 'bg-ice/10 text-ice' : 'text-ice/45 hover:bg-ice/5 hover:text-ice',
            )}
          >
            <span className="hidden text-[13px] sm:inline">Mood</span>
            <span>{mood ? moodOptions.find((m) => m.id === mood)?.emoji : '🙂'}</span>
          </button>

          {showMood && (
            <div className="absolute top-full right-0 mt-2 w-48 border border-ice/12 bg-thaw-lift p-1.5 shadow-lg shadow-black/40">
              <p className="px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-ice/40 uppercase">
                How are you today?
              </p>
              <div className="grid grid-cols-2 gap-0.5">
                {moodOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectMood(option.id)}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-ice/55 transition hover:bg-ice/5 hover:text-ice"
                  >
                    <span>{option.emoji}</span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="relative p-2 text-ice/45 transition hover:bg-ice/5 hover:text-ice"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-ice" />
        </button>

        <div className="ml-1 hidden h-8 w-8 items-center justify-center border border-ice/20 bg-ice/10 text-[11px] font-semibold text-ice sm:flex">
          AR
        </div>
      </div>
    </header>
  )
}
