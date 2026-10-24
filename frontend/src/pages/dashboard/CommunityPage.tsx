import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowBigDown,
  ArrowBigUp,
  BookOpen,
  Briefcase,
  Building,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  Bookmark,
  X,
  Trash2,
} from 'lucide-react'
import { api, getUser } from '../../lib/api'
import { connectSocket } from '../../lib/socket'

const categories = ['All', 'Mental Health', 'Academics', 'Career', 'Campus Life', 'Others']

const categoryConfig: Record<
  string,
  {
    text: string
    dot: string
    cardBg: string
    cardBorder: string
    tagBg: string
    icon: any
    hint: string
  }
> = {
  'Mental Health': {
    text: '#5fd4c4',
    dot: '#5fd4c4',
    cardBg: '#11292a',
    cardBorder: '#1f4a49',
    tagBg: '#123533',
    icon: Heart,
    hint: 'Stress, mood, support',
  },
  Academics: {
    text: '#9cc2ff',
    dot: '#9cc2ff',
    cardBg: '#14213d',
    cardBorder: '#26407a',
    tagBg: '#16294a',
    icon: BookOpen,
    hint: 'Courses, exams, study tips',
  },
  Career: {
    text: '#8fd694',
    dot: '#8fd694',
    cardBg: '#132a1a',
    cardBorder: '#24503a',
    tagBg: '#173a24',
    icon: Briefcase,
    hint: 'Placements, DSA, internships',
  },
  'Campus Life': {
    text: '#f0b865',
    dot: '#f0b865',
    cardBg: '#2e2312',
    cardBorder: '#5a4521',
    tagBg: '#3a2c14',
    icon: Building,
    hint: 'Hostels, events, clubs',
  },
  Others: {
    text: '#c9bff0',
    dot: '#c9bff0',
    cardBg: '#231d38',
    cardBorder: '#3d3360',
    tagBg: '#2d2547',
    icon: MoreHorizontal,
    hint: 'Anything else',
  },
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
  votedDirection?: 'up' | 'down' | null
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
  const [sort, setSort] = useState<'Hot' | 'New' | 'Top'>('New')
  const [composer, setComposer] = useState({ title: '', body: '' })
  const [composerCategory, setComposerCategory] = useState<string>('')
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedComments, setExpandedComments] = useState<Record<number, boolean>>({})
  const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({})
  const [commentLists, setCommentLists] = useState<Record<number, Comment[]>>({})
  const [sendingComment, setSendingComment] = useState<number | null>(null)
  const seenComments = useRef<Set<number>>(new Set())
  const [vibeTag, setVibeTag] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creatingPost, setCreatingPost] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  useEffect(() => {
    function handleClick() {
      setOpenMenuId(null)
    }
    if (openMenuId !== null) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [openMenuId])
  const storedUser = getUser()
  const hasVibeTag = Boolean(vibeTag)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars

  useEffect(() => {
    api
      .get<{ vibeTag?: string | null }>('/api/auth/me')
      .then((m) => setVibeTag((m.vibeTag || '').trim()))
      .catch(() => setVibeTag((storedUser?.vibeTag as string) || ''))
  }, [])

  useEffect(() => {
    api
      .get<Post[]>('/api/community')
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false))
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
      setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, comments: (p.comments ?? 0) + 1 } : p)))
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

  const filtered = useMemo(() => {
    let result = category === 'All' ? posts : posts.filter((p) => p.category === category)
    if (sort === 'New') {
      result = [...result].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } else if (sort === 'Top') {
      result = [...result].sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0))
    } else if (sort === 'Hot') {
      result = [...result].sort((a, b) => (b.comments || 0) + (b.upvotes || 0) - ((a.comments || 0) + (a.upvotes || 0)))
    }
    return result
  }, [category, posts, sort])

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
      setPosts((p) =>
        p.map((post) => (post.id === id ? { ...post, voted: wasVoted, upvotes: prev.upvotes } : post)),
      )
    }
  }

  async function createPost() {
    if (!composer.title.trim() || !composer.body.trim() || !composerCategory || creatingPost) return
    setError('')
    if (!hasVibeTag) {
      setError('Create your VibeTag in Profile before posting to the community.')
      return
    }
    setCreatingPost(true)
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
      setComposerCategory('')
      setShowCreateModal(false)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to post. Please try again.'
      if (message.includes('Login')) setError('Please sign in to post to the community.')
      else setError(message)
    } finally {
      setCreatingPost(false)
    }
  }

  async function deletePost(postId: number) {
    if (!window.confirm('Delete this post permanently?')) return
    try {
      await api.del(`/api/community/${postId}`)
      setPosts((prev) => prev.filter((p) => p.id !== postId))
      setCommentLists((prev) => {
        const next = { ...prev }
        delete next[postId]
        return next
      })
    } catch {
      /* ignore */
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
      setCommentLists((prev) => ({ ...prev, [postId]: [...(prev[postId] ?? []), comment] }))
      setCommentDrafts((prev) => ({ ...prev, [postId]: '' }))
      setPosts((p) => p.map((post) => (post.id === postId ? { ...post, comments: (post.comments ?? 0) + 1 } : post)))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unable to comment. Please try again.'
      setError(message.includes('VibeTag') ? 'Create your VibeTag in Profile before commenting.' : message)
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

  const userInitials = (String(storedUser?.name || 'U').charAt(0) || 'U').toUpperCase()

  return (
    <div className="min-h-screen" style={{ background: 'transparent', fontFamily: 'inherit' }}>
      <div className="mx-auto grid max-w-[1560px] gap-6 px-4 pt-4 lg:grid-cols-[1fr_300px]">
        <div className="flex flex-col gap-6">
          <header className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="text-[26px] font-bold" style={{ color: '#ece8f8' }}>
              Community
            </h1>
            <p className="text-sm text-right" style={{ color: '#a79fc4' }}>
              Campus conversations, optional anonymity
            </p>
          </header>

          <div
            className="flex items-center gap-3 rounded-[14px] border px-4 py-3 backdrop-blur-xl"
            style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)' }}
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold"
              style={{ background: 'rgba(255,255,255,0.1)' }}
            >
              {userInitials}
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex h-11 min-w-0 flex-1 items-center rounded-[22px] border px-4 text-left text-sm transition"
              style={{ borderColor: '#2e2350', color: '#a79fc4' }}
            >
              Share something with campus
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex h-11 items-center rounded-[22px] px-5 text-sm font-medium transition"
              style={{ background: '#b9a2f5', color: '#1a1030' }}
            >
              Create post
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => {
                const isSelected = category === cat
                const cfgF = (categoryConfig as any)[cat]
                if (!cfgF) return <></>
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className="flex h-9 items-center gap-2 rounded-[20px] border px-3 text-sm transition focus:outline-none focus:ring-2 focus:ring-[#b9a2f5]/40"
                    style={{
                      borderColor: isSelected ? '#b9a2f5' : '#2e2350',
                      background: isSelected ? '#2a1f4d' : 'transparent',
                      color: '#ece8f8',
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: cfgF.dot }}
                      aria-hidden
                    />
                    {cat}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              {(['Hot', 'New', 'Top'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className="flex h-9 items-center rounded-[20px] border px-3 text-sm transition"
                  style={{
                    borderColor: sort === s ? '#b9a2f5' : '#2e2350',
                    background: sort === s ? '#2a1f4d' : 'transparent',
                    color: '#ece8f8',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {loading && (
              <>
                <div className="h-32 animate-pulse rounded-[14px] border backdrop-blur-xl" style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)' }} />
                <div className="h-32 animate-pulse rounded-[14px] border backdrop-blur-xl" style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)' }} />
                <div className="h-32 animate-pulse rounded-[14px] border backdrop-blur-xl" style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)' }} />
              </>
            )}
            {!loading && filtered.length === 0 && (
              <div
                className="rounded-[14px] border p-6 text-center text-sm backdrop-blur-xl"
                style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)', color: '#a79fc4' }}
              >
                Be the first to post
              </div>
            )}
            {filtered.map((post) => {
              const cfgPost = (categoryConfig as any)[post.category] || (categoryConfig as any).Others
              const IconPost = cfgPost.icon
              const isExpanded = expandedComments[post.id] ?? false
              const comments = commentLists[post.id] ?? post.commentList ?? []
              return (
                <article
                  key={post.id}
                  id={`post-${post.id}`}
                  className="grid grid-cols-[52px_1fr] gap-0 overflow-hidden rounded-[14px] border transition hover:border-[#b9a2f5]"
                  style={{
                    background: cfgPost.cardBg,
                    borderColor: cfgPost.cardBorder,
                  }}
                >
                  <div
                    className="flex flex-col items-center justify-center gap-1 py-3"
                    style={{ background: 'rgba(0,0,0,.25)' }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleVote(post.id)}
                      className="flex h-8 w-9 items-center justify-center rounded hover:bg-[#2a1f4d]"
                      aria-label="Upvote"
                    >
                      <ArrowBigUp
                        className={clsx('h-5 w-5', post.voted && 'fill-current')}
                        style={{ color: post.voted ? '#b9a2f5' : '#cfc8e6' }}
                      />
                    </button>
                    <span className="text-xs font-semibold" style={{ color: post.voted ? '#b9a2f5' : '#ece8f8' }}>
                      {post.upvotes}
                    </span>
                    <button
                      type="button"
                      className="flex h-8 w-9 items-center justify-center rounded hover:bg-[#2a1f4d]"
                      aria-label="Downvote"
                    >
                      <ArrowBigDown className="h-5 w-5" style={{ color: '#cfc8e6' }} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-[18px] border px-2 py-0.5"
                        style={{
                          background: cfgPost.tagBg,
                          borderColor: cfgPost.cardBorder,
                          color: cfgPost.text,
                          fontSize: '11px',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          fontWeight: 600,
                        }}
                      >
                        <IconPost className="h-3.5 w-3.5" />
                        {post.category}
                      </span>
                      <span style={{ color: '#a79fc4' }}>
                        · Posted {post.anonymous ? 'anonymously' : `by ${post.authorName || 'User'}`} · {timeAgo(post.createdAt)}
                      </span>
                      <div className="relative ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenMenuId((prev) => (prev === post.id ? null : post.id))
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full border transition hover:bg-violet/10 hover:text-violet-soft"
                          style={{ borderColor: 'rgba(184,164,224,0.25)', color: '#9a8fb0' }}
                          aria-label="More options"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {openMenuId === post.id && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-9 z-20 min-w-[120px] rounded-xl border p-1 shadow-lg backdrop-blur-xl"
                            style={{ background: 'rgba(26,21,36,0.9)', borderColor: 'rgba(184,164,224,0.2)' }}
                          >
                            {post.deletable && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuId(null)
                                  deletePost(post.id)
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-violet/10"
                                style={{ color: '#cfc8e6' }}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </button>
                            )}
                            {!post.deletable && (
                              <div className="px-3 py-2 text-xs" style={{ color: '#9a8fb0' }}>
                                No actions
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <h2 className="text-[18px] font-semibold leading-tight" style={{ color: '#ece8f8' }}>
                      {post.title}
                    </h2>
                    <p
                      className="line-clamp-2 text-sm"
                      style={{ color: '#cfc8e6' }}
                    >
                      {post.body}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleComments(post.id)}
                        className="flex h-11 items-center gap-1.5 rounded-[22px] px-3 text-sm transition hover:bg-white/5"
                        style={{ color: '#cfc8e6' }}
                      >
                        <MessageCircle className="h-4 w-4" />
                        {post.comments} Replies
                      </button>
                      <button
                        type="button"
                        onClick={() => sharePost(post.id)}
                        className="flex h-11 items-center gap-1.5 rounded-[22px] px-3 text-sm transition hover:bg-white/5"
                        style={{ color: '#cfc8e6' }}
                      >
                        <Share2 className="h-4 w-4" />
                        Share
                      </button>
                      <button
                        type="button"
                        className="flex h-11 items-center gap-1.5 rounded-[22px] px-3 text-sm transition hover:bg-white/5"
                        style={{ color: '#cfc8e6' }}
                      >
                        <Bookmark className="h-4 w-4" />
                        Save
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 space-y-3 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                        {comments.length === 0 && (
                          <p className="text-xs" style={{ color: '#a79fc4' }}>
                            No comments yet — start the conversation.
                          </p>
                        )}
                        {comments.map((c) => (
                          <div key={c.id} className="flex gap-3">
                            <div
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                              style={{ background: '#b9a2f5', color: '#1a1030' }}
                            >
                              {(c.authorName || 'A').slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline gap-2">
                                <span className="text-sm font-medium" style={{ color: '#ece8f8' }}>
                                  {c.authorName}
                                </span>
                                <span className="text-xs" style={{ color: '#a79fc4' }}>
                                  {timeAgo(c.createdAt)}
                                </span>
                              </div>
                              <p className="mt-1 text-sm" style={{ color: '#cfc8e6' }}>
                                {c.body}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-2 pt-2">
                          <input
                            value={commentDrafts[post.id] ?? ''}
                            onChange={(e) => setCommentDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                postComment(post.id)
                              }
                            }}
                            placeholder="Write a comment..."
                            className="flex-1 rounded-[22px] border bg-transparent px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#b9a2f5]/40"
                            style={{ borderColor: '#2e2350', color: '#ece8f8' }}
                          />
                          <button
                            type="button"
                            onClick={() => postComment(post.id)}
                            disabled={sendingComment === post.id}
                            className="flex h-11 w-11 items-center justify-center rounded-[22px] transition disabled:opacity-50"
                            style={{ background: '#b9a2f5', color: '#1a1030' }}
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <aside className="hidden flex-col gap-4 lg:sticky lg:top-4 lg:flex">
          <div
            className="flex flex-col gap-3 rounded-[14px] border p-4 backdrop-blur-xl"
            style={{ background: 'rgba(26,21,36,0.55)', borderColor: 'rgba(184,164,224,0.18)' }}
          >
            <span
              className="text-[11px] uppercase tracking-[0.12em]"
              style={{ color: '#a79fc4', fontFamily: 'JetBrains Mono, monospace' }}
            >
              Community rules
            </span>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm" style={{ color: '#cfc8e6' }}>
              <li>Be kind and respectful</li>
              <li>No sharing personal details</li>
              <li>No harassment or shaming</li>
              <li>Support, don't diagnose</li>
            </ol>
          </div>
        </aside>
      </div>

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(10,6,20,.72)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateModal(false)
              setError('')
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="flex w-full max-w-[640px] flex-col rounded-[18px] border shadow-[0_24px_80px_rgba(0,0,0,.55)] backdrop-blur-xl"
            style={{ background: 'rgba(26,21,36,0.75)', borderColor: 'rgba(184,164,224,0.25)' }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowCreateModal(false)
                setError('')
              }
            }}
          >
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
              <h2 className="text-[18px] font-semibold" style={{ color: '#ece8f8' }}>
                Create post
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false)
                  setError('')
                }}
                className="flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/5"
                aria-label="Close"
              >
                <X className="h-5 w-5" style={{ color: '#cfc8e6' }} />
              </button>
            </div>

            <div className="flex flex-col gap-5 px-6 py-6">
              <div className="text-sm font-semibold" style={{ color: '#ece8f8' }}>
                Posting as {vibeTag || String(storedUser?.name || 'User')}
              </div>

              <div className="flex flex-col gap-2">
                <span
                  className="text-[11px] uppercase tracking-[0.12em]"
                  style={{ color: '#a79fc4', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Choose a topic
                </span>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-3">
                  {['Mental Health', 'Academics', 'Career', 'Campus Life', 'Others'].map((cat) => {
                    const cfgTile = (categoryConfig as any)[cat]
                  const IconComp = cfgTile?.icon
                  const isSelected = composerCategory === cat
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setComposerCategory(cat)}
                      className="flex min-h-[76px] flex-col items-start justify-center gap-1 rounded-[12px] border p-3.5 text-left transition focus:outline-none focus:ring-2 focus:ring-[#b9a2f5]/40"
                      style={{
                        background: cfgTile?.cardBg,
                        borderColor: isSelected ? cfgTile?.text : cfgTile?.cardBorder,
                        boxShadow: isSelected ? `inset 0 0 0 1px ${cfgTile?.text}` : undefined,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {IconComp && <IconComp className="h-4 w-4" style={{ color: cfgTile?.text }} />}
                        <span className="text-[14px] font-semibold" style={{ color: cfgTile?.text }}>
                          {cat}
                        </span>
                      </div>
                      <span className="text-[12px]" style={{ color: '#cfc8e6' }}>
                        {cfgTile?.hint}
                      </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span
                    className="text-[11px] uppercase tracking-[0.12em]"
                    style={{ color: '#a79fc4', fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    Title
                  </span>
                  <span className="text-xs" style={{ color: '#a79fc4' }}>
                    {composer.title.length} / 150
                  </span>
                </div>
                <input
                  value={composer.title}
                  onChange={(e) => setComposer((d) => ({ ...d, title: e.target.value.slice(0, 150) }))}
                  placeholder="An interesting title"
                  className="h-12 rounded-lg border bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-[#b9a2f5]/40"
                  style={{ borderColor: '#2e2350', color: '#ece8f8' }}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span
                  className="text-[11px] uppercase tracking-[0.12em]"
                  style={{ color: '#a79fc4', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  Body
                </span>
                <textarea
                  value={composer.body}
                  onChange={(e) => setComposer((d) => ({ ...d, body: e.target.value }))}
                  placeholder="Share something helpful or honest"
                  rows={6}
                  className="resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#b9a2f5]/40"
                  style={{ borderColor: '#2e2350', color: '#ece8f8', minHeight: '150px' }}
                />
              </div>

              {composerCategory === 'Mental Health' && (
                <div
                  className="flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-[13px]"
                  style={{ background: '#2a1f4d', color: '#cfc8e6' }}
                >
                  <Heart className="h-4 w-4 flex-shrink-0" style={{ color: '#5fd4c4' }} />
                  <span>Struggling? The AI Assistant and counselor resources are always open for you.</span>
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {error}
                </p>
              )}
            </div>

            <div
              className="flex items-center justify-end gap-3 border-t px-6 py-4"
              style={{ borderColor: 'rgba(255,255,255,0.1)' }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false)
                  setError('')
                }}
                className="flex h-11 items-center rounded-[22px] border px-5 text-sm transition hover:bg-white/5"
                style={{ borderColor: '#2e2350', color: '#cfc8e6' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={createPost}
                disabled={!composerCategory || !composer.title.trim() || !composer.body.trim() || creatingPost}
                className="flex h-11 items-center rounded-[22px] px-5 text-sm font-medium transition disabled:opacity-40"
                style={{ background: '#b9a2f5', color: '#1a1030' }}
              >
                Post
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
