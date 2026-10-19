import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowBigUp, AtSign, Clock, MessageCircle, Send, Share2, Tag, Trash2 } from 'lucide-react'
import { CrystalMark } from '../../components/CrystalMark'
import { PageHeader } from '../../components/PageHeader'
import { api, getUser } from '../../lib/api'
import { connectSocket } from '../../lib/socket'

const categories = ['All', 'Mental Health', 'Study Tips', 'Campus Life', 'Career']

const categoryColors: Record<string, string> = {
  'Mental Health': 'bg-violet/15 text-violet-soft border-violet/30',
  'Study Tips': 'bg-emerald-soft/15 text-emerald-soft border-emerald-soft/30',
  'Campus Life': 'bg-amber-gentle/15 text-amber-gentle border-amber-gentle/30',
  Career: 'bg-ice/10 text-ice border-ice/20',
}

const categoryDots: Record<string, string> = {
  'Mental Health': 'bg-violet-soft',
  'Study Tips': 'bg-emerald-soft',
  'Campus Life': 'bg-amber-gentle',
  Career: 'bg-ice',
}

type Comment = { id: number; authorName: string; body: string; createdAt: string }

type Post = {
  id: number
  title: string
  body: string
  category: string
  authorName: string
  anonymous: boolean
  upvotes: number
  comments: number
  createdAt: string
  voted?: boolean
  deletable?: boolean
  commentList?: Comment[]
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return 'recently'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function CommunityPage() {
  const [category, setCategory] = useState('All')
  const [composer, setComposer] = useState({ title: '', body: '' })
  const [composerCategory, setComposerCategory] = useState('Campus Life')
  const [posts, setPosts] = useState<Post[]>([])
  const [stats, setStats] = useState<{ members: number; posts: number; replies: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [commentLists, setCommentLists] = useState<Record<number, Comment[]>>({})
  const [sendingComment, setSendingComment] = useState<number | null>(null)
  const seenComments = useRef<Set<number>>(new Set())
  const [vibeTag, setVibeTag] = useState<string>('')
  const storedUser = getUser()
  const hasVibeTag = Boolean(vibeTag)
  const navigate = useNavigate()

  useEffect(() => {
    api
      .get<{ vibeTag?: string | null }>('/api/auth/me')
      .then((m) => setVibeTag((m.vibeTag || '').trim()))
      .catch(() => setVibeTag((storedUser?.vibeTag as string) || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    api
      .get<Post[]>('/api/community')
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false))
    api
      .get<{ members: number; posts: number; replies: number }>('/api/community/stats')
      .then(setStats)
      .catch(() => setStats(null))
  }, [])

  useEffect(() => {
    const socket = connectSocket()

    const onNewPost = (payload: Post) => {
      setPosts((prev) => (prev.some((p) => p.id === payload.id) ? prev : [payload, ...prev]))
    }
    const onNewComment = (payload: { postId: number; comment: Comment }) => {
      const { postId, comment } = payload
      if (seenComments.current.has(comment.id)) return
      seenComments.current.add(comment.id)
      setCommentLists((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), comment] }))
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comments: (p.comments ?? 0) + 1 } : p)),
      )
    }
    const onVoted = (payload: { id: number; upvotes: number }) => {
      setPosts((prev) => prev.map((p) => (p.id === payload.id ? { ...p, upvotes: payload.upvotes } : p)))
    }
    const onDeleted = (payload: { id: number }) => {
      setPosts((prev) => prev.filter((p) => p.id !== payload.id))
      setCommentLists((prev) => {
        const next = { ...prev }
        delete next[payload.id]
        return next
      })
    }

    socket.on('post:new', onNewPost)
    socket.on('comment:new', onNewComment)
    socket.on('post:voted', onVoted)
    socket.on('post:deleted', onDeleted)

    return () => {
      socket.off('post:new', onNewPost)
      socket.off('comment:new', onNewComment)
      socket.off('post:voted', onVoted)
      socket.off('post:deleted', onDeleted)
    }
  }, [])

  const filtered = useMemo(
    () => (category === 'All' ? posts : posts.filter((p) => p.category === category)),
    [category, posts],
  )

  const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0)

  const trending = useMemo(() => {
    const counts = new Map<string, number>()
    posts.forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [posts])

  async function toggleVote(id: number) {
    const prev = posts.find((p) => p.id === id)
    if (!prev) return
    const wasVoted = prev.voted
    setPosts((p) =>
      p.map((post) =>
        post.id === id
          ? { ...post, voted: !wasVoted, upvotes: post.upvotes + (wasVoted ? -1 : 1) }
          : post,
      ),
    )
    try {
      const updated = await api.post<{ voted: boolean; upvotes: number }>(`/api/community/${id}/upvote`)
      setPosts((p) =>
        p.map((post) => (post.id === id ? { ...post, voted: updated.voted, upvotes: updated.upvotes } : post)),
      )
    } catch {
      // revert
      setPosts((p) =>
        p.map((post) =>
          post.id === id
            ? { ...post, voted: wasVoted, upvotes: prev.upvotes }
            : post,
        ),
      )
    }
  }

  async function createPost() {
    if (!composer.title.trim() || !composer.body.trim()) return
    setError('')
    if (!hasVibeTag) {
      setError('Create your VibeTag in Profile before posting to the community.')
      return
    }
    try {
      const created = await api.post<Post>('/api/community', {
        title: composer.title.trim(),
        body: composer.body.trim(),
        category: composerCategory,
      })
      setPosts((prev) =>
        prev.some((p) => p.id === created.id)
          ? prev.map((p) => (p.id === created.id ? { ...created, voted: p.voted ?? false } : p))
          : [{ ...created, voted: false }, ...prev],
      )
      setComposer({ title: '', body: '' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to post. Please try again.'
      if (message.includes('Login')) setError('Please sign in to post to the community.')
      else setError(message)
    }
  }

  async function postComment(postId: number) {
    const body = commentDrafts[postId]?.trim()
    if (!body) return
    setSendingComment(postId)
    try {
      const comment = await api.post<Comment>(`/api/community/${postId}/comments`, { body })
      if (seenComments.current.has(comment.id)) return
      seenComments.current.add(comment.id)
      setCommentLists((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] ?? []), comment],
      }))
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }))
      setPosts((p) =>
        p.map((post) =>
          post.id === postId ? { ...post, comments: (post.comments ?? 0) + 1 } : post,
        ),
      )
      setError('')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to comment. Please try again.'
      setError(
        message.includes('VibeTag')
          ? 'Create your VibeTag in Profile before commenting.'
          : message,
      )
    } finally {
      setSendingComment(null)
    }
  }

  function toggleComments(postId: number) {
    setExpandedComments((prev) => ({ ...prev, [postId]: !prev[postId] }))
  }

  function sharePost(postId: number) {
    const url = `${window.location.origin}${window.location.pathname}#post-${postId}`
    navigator.clipboard.writeText(url).catch(() => {})
  }

  function deletePost(post: Post) {
    if (!window.confirm(`Delete the post "${post.title}"? This removes its comments and upvotes.`)) return
    api
      .del(`/api/community/${post.id}`)
      .then(() => {
        setPosts((prev) => prev.filter((p) => p.id !== post.id))
        setCommentLists((prev) => {
          const next = { ...prev }
          delete next[post.id]
          return next
        })
        setCommentDrafts((prev) => {
          const next = { ...prev }
          delete next[post.id]
          return next
        })
        setExpandedComments((prev) => {
          const next = { ...prev }
          delete next[post.id]
          return next
        })
      })
      .catch(() => {})
  }

  return (
    <div className="rise-grid mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Campus"
        title="Community"
        description="Campus conversations — optional anonymity"
      />

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
        <div className="glass-ice rounded-xl px-3.5 py-3 text-center">
          <p className="font-display text-xl font-bold text-ink">{loading ? '…' : stats?.posts ?? posts.length}</p>
          <p className="mt-0.5 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
            Posts
          </p>
        </div>
        <div className="glass-ice rounded-xl px-3.5 py-3 text-center">
          <p className="font-display text-xl font-bold text-ink">{loading ? '…' : stats?.replies ?? totalComments}</p>
          <p className="mt-0.5 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
            Replies
          </p>
        </div>
        <div className="glass-ice rounded-xl px-3.5 py-3 text-center">
          <p className="font-display text-xl font-bold text-ink">{stats?.members ?? '—'}</p>
          <p className="mt-0.5 font-mono text-[9px] tracking-[0.14em] text-muted uppercase">
            Members
          </p>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_220px]">
        <div>
          <div className="glass-ice rounded-xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CrystalMark size="sm" spinOnView />
                <p className="text-sm font-semibold text-ink">New post</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {Object.keys(categoryColors).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setComposerCategory(cat)}
                      className={clsx(
                        'rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.1em] uppercase transition',
                        composerCategory === cat
                          ? categoryColors[cat]
                          : 'border-ice/10 bg-ice/[0.03] text-muted hover:text-ink',
                      )}
                    >
                      {cat.split(' ')[0]}
                    </button>
                  ))}
                </div>
                <span
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] tracking-[0.12em] uppercase',
                    hasVibeTag
                      ? 'border-emerald-soft/30 bg-emerald-soft/10 text-emerald-soft'
                      : 'border-rose-400/30 bg-rose-400/10 text-rose-300',
                  )}
                >
                  <AtSign className="h-3 w-3" />
                  {hasVibeTag ? vibeTag : 'no vibetag'}
                </span>
              </div>
            </div>
            <p className="mt-2 font-mono text-[9px] tracking-[0.14em] uppercase">
              {hasVibeTag ? (
                <span className="text-muted">
                  Posting as <span className="text-emerald-soft">{vibeTag}</span>
                </span>
              ) : (
                <span className="text-rose-400">
                  You need a VibeTag to post —{' '}
                  <button
                    type="button"
                    onClick={() => navigate('/app/profile')}
                    className="underline hover:text-rose-300"
                  >
                    create one in Profile
                  </button>
                </span>
              )}
            </p>
            <input
              value={composer.title}
              onChange={(e) => setComposer((d) => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              className="mt-3 w-full rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
            />
            <textarea
              value={composer.body}
              onChange={(e) => setComposer((d) => ({ ...d, body: e.target.value }))}
              placeholder="Share something helpful or honest…"
              rows={2}
              className="mt-2 w-full resize-none rounded-lg border border-ice/10 bg-thaw px-3 py-2 text-sm text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
            />
            {error && (
              <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-1.5 text-xs font-medium text-rose-400">
                {error}
              </p>
            )}
            <div className="mt-2.5 flex items-center justify-between">
              <span className="font-mono text-[9px] text-muted">
                {composer.body.length > 0 && `${composer.body.length} chars`}
              </span>
              <button
                type="button"
                onClick={createPost}
                className="glow-cta rounded-lg bg-ice px-4 py-1.5 text-sm font-semibold text-thaw transition hover:bg-ice-bright"
              >
                Post
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5 border-b border-line/60 pb-4">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={clsx(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition',
                  category === cat
                    ? 'border-ice/25 bg-ice/15 text-ice'
                    : 'border-ice/10 bg-ice/[0.03] text-muted hover:border-ice/20 hover:text-ink',
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {loading && <p className="py-10 text-center text-sm text-muted">Loading posts…</p>}
            {!loading && filtered.length === 0 && (
              <p className="rounded-xl border border-line p-6 text-center text-sm text-muted">
                No posts yet — be the first to start a conversation.
              </p>
            )}
            {filtered.map((post) => {
              const isExpanded = expandedComments[post.id] ?? false
              const comments = commentLists[post.id] ?? post.commentList ?? []
              return (
                <article
                  key={post.id}
                  id={`post-${post.id}`}
                  className="glass-ice group rounded-xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-violet/40 hover:shadow-[0_0_24px_rgba(139,92,246,0.18)]"
                >
                  <div className="flex gap-3.5">
                    <button
                      type="button"
                      onClick={() => toggleVote(post.id)}
                      className={clsx(
                        'flex h-fit flex-col items-center px-0.5 transition',
                        post.voted
                          ? 'text-violet-soft'
                          : 'text-muted hover:text-ice',
                      )}
                    >
                      <ArrowBigUp
                        className={clsx(
                          'h-5 w-5 transition-transform',
                          post.voted && 'fill-current',
                        )}
                      />
                      <span className="text-xs font-semibold tabular-nums text-ink">
                        {post.upvotes}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[8px] tracking-[0.1em] uppercase',
                            categoryColors[post.category] ?? categoryColors.Career,
                          )}
                        >
                          <span
                            className={clsx(
                              'h-1 w-1 rounded-full',
                              categoryDots[post.category] ?? 'bg-ice',
                            )}
                          />
                          {post.category}
                        </span>
                      </div>
                      <h2 className="mt-1.5 text-[15px] font-semibold tracking-tight text-ink">
                        {post.title}
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{post.body}</p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-violet/30 bg-violet/15 text-[9px] font-semibold text-violet-soft uppercase">
                            {(post.authorName || '?').replace(/^vibe/i, '').slice(0, 2) || '?'}
                          </span>
                          <span className="font-mono text-[11px] tracking-[0.1em] text-ice/80">
                            {post.authorName || 'Student'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleComments(post.id)}
                          className="flex items-center gap-1 transition hover:text-ice"
                        >
                          <MessageCircle className="h-3 w-3" />
                          {post.comments}
                        </button>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {timeAgo(post.createdAt)}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          {post.deletable && (
                            <button
                              type="button"
                              onClick={() => deletePost(post)}
                              className="flex items-center gap-1 rounded-md border border-rose-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400/75 transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-400"
                              aria-label={`Delete ${post.title}`}
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => sharePost(post.id)}
                            className="text-muted transition hover:text-ice"
                            aria-label="Share"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 border-t border-ice/10 pt-3 space-y-3">
                      {comments.length === 0 && (
                        <p className="text-xs text-muted">No comments yet — start the conversation.</p>
                      )}
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-2.5">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-ice/15 bg-ice/[0.06] text-[8px] font-semibold text-ice/60">
                            {(c.authorName || 'Anon').split(' ').map((w) => w[0]).join('').slice(0, 2)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-1.5 text-[10px] text-muted">
                              {c.authorName}
                              <span className="text-ice/30">·</span>
                              {timeAgo(c.createdAt)}
                            </span>
                            <p className="mt-0.5 text-sm text-ink/90">{c.body}</p>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          value={commentDrafts[post.id] ?? ''}
                          onChange={(e) =>
                            setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              postComment(post.id)
                            }
                          }}
                          placeholder="Write a comment…"
                          className="flex-1 rounded-lg border border-ice/10 bg-thaw px-3 py-1.5 text-xs text-ink outline-none placeholder:text-ice/30 focus:border-ice/30 focus:ring-2 focus:ring-violet/20"
                        />
                        <button
                          type="button"
                          onClick={() => postComment(post.id)}
                          disabled={sendingComment === post.id}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-deep/25 text-violet-soft transition hover:bg-violet-deep/40 disabled:opacity-50"
                        >
                          <Send className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-20">
          <div className="glass-ice rounded-xl p-4">
            <div className="flex items-center gap-2.5">
              <CrystalMark size="sm" spinOnView />
              <h2 className="font-mono text-[10px] font-semibold tracking-[0.16em] text-muted uppercase">
                Topics
              </h2>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {trending.length === 0 && (
                <p className="text-xs text-muted">No topics yet.</p>
              )}
              {trending.map(([name, count]) => (
                <span
                  key={name}
                  className="group flex items-center gap-1.5 rounded-full border border-ice/10 bg-ice/[0.03] px-2.5 py-1 text-xs font-medium text-ice/60 transition hover:border-violet/30 hover:bg-violet/10 hover:text-ice"
                >
                  <Tag className="h-2.5 w-2.5 text-ice/40 transition group-hover:text-violet-soft" />
                  {name}
                  <span className="ml-0.5 rounded-full bg-ice/5 px-1.5 py-0.5 font-mono text-[8px] tabular-nums text-muted">
                    {count}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}