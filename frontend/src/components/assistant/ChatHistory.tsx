import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Pencil, Search, Trash2 } from 'lucide-react'

export type SessionItem = {
  id: number
  title: string
}

type Props = {
  sessions: SessionItem[]
  activeId: number | null
  loading: boolean
  onNewChat: () => void
  onSelect: (id: number) => void
  onDelete: (e: React.MouseEvent, id: number) => void
  confirmingDelete: number | null
  search: string
  onSearchChange: (value: string) => void
  className?: string
}

/**
 * Chat history for the AI Assistant tab, sitting under the mode pills exactly
 * where the old rail used to be — a "New chat" row and a Recent list. It is the
 * same shape as the previous UI, just tilted into the header column instead of a
 * full-height rail, so the app sidebar stays the only rail on screen.
 */
export function ChatHistory({
  sessions,
  activeId,
  loading,
  onNewChat,
  onSelect,
  onDelete,
  confirmingDelete,
  search,
  onSearchChange,
  className,
}: Props) {
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searching) searchRef.current?.focus()
  }, [searching])

  const query = search.trim().toLowerCase()
  const filtered = query ? sessions.filter((s) => s.title.toLowerCase().includes(query)) : sessions

  return (
    <div className={clsx('mt-3', className)}>
      <button
        type="button"
        onClick={onNewChat}
        className="vc-glass-plum flex h-10 w-full items-center gap-2.5 rounded-lg border border-vc-line-strong px-2 text-left text-[14px] font-medium text-vc-ink transition hover:border-vc-check"
      >
        <Pencil className="h-3.5 w-3.5 text-vc-ink-2" strokeWidth={1.75} />
        New chat
      </button>

      {searching ? (
        <div className="mt-1 flex h-10 items-center gap-2.5 rounded-lg bg-vc-surface-2/50 px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-vc-ink-2" strokeWidth={1.75} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onBlur={() => {
              if (!search) setSearching(false)
            }}
            placeholder="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-vc-ink outline-none placeholder:text-vc-ink-3"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="mt-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-vc-rail-text transition hover:bg-vc-row/70 hover:text-vc-ink"
        >
          <Search className="h-3.5 w-3.5 text-vc-ink-2" strokeWidth={1.75} />
          Search chats
        </button>
      )}

      <div className="vc-scroll mt-2 max-h-[260px] overflow-y-auto pb-1">
        <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-vc-ink-2">Recent</p>
        {!loading && filtered.length === 0 && (
          <p className="px-2 py-3 text-[12px] leading-relaxed text-vc-ink-3">
            {query ? 'No chats match that.' : 'No conversations yet. Start one above.'}
          </p>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className={clsx(
              'group/x flex h-10 items-center rounded-lg border transition',
              s.id === activeId
                ? 'vc-glass-plum border-vc-line-strong text-vc-ink'
                : 'border-transparent text-vc-rail-text hover:bg-vc-row/60 hover:text-vc-ink',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className="min-w-0 flex-1 truncate pr-1 pl-2 text-left text-[14px]"
            >
              {s.title}
            </button>
            <button
              type="button"
              onClick={(e) => onDelete(e, s.id)}
              title={confirmingDelete === s.id ? 'Click again to delete' : 'Delete conversation'}
              className={clsx(
                'mr-1.5 inline-flex shrink-0 items-center justify-center rounded-md transition',
                confirmingDelete === s.id
                  ? 'bg-rose-500/20 px-2 py-1 font-mono text-[9px] font-semibold tracking-wider text-rose-300 uppercase'
                  : 'h-6 w-6 text-vc-ink-3 opacity-0 hover:bg-vc-bubble hover:text-rose-300 group-hover/x:opacity-100',
              )}
            >
              {confirmingDelete === s.id ? 'Delete' : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
