import { Router } from 'express'
import { prisma } from '../prisma.js'
import { getIO } from '../socket.js'

export const communityRoutes = Router()

// A VibeTag is this app's identity: every post and comment is attributed to it.
function hasValidVibeTag(user) {
  if (!user) return false
  return typeof user.vibeTag === 'string' && user.vibeTag.trim().length > 0
}

function requireVibeTag(req, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Login required to post to the community.' })
    return false
  }
  if (!hasValidVibeTag(req.user)) {
    res
      .status(400)
      .json({ error: 'Create your VibeTag in Profile before posting to the community.' })
    return false
  }
  return true
}

communityRoutes.get('/stats', async (req, res, next) => {
  try {
    const [members, posts, replies] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
    ])
    res.json({ members, posts, replies })
  } catch (err) {
    next(err)
  }
})

communityRoutes.get('/', async (req, res, next) => {
  try {
    const where = {}
    if (req.query.category) where.category = String(req.query.category)

    let posts = await prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { comments: { orderBy: { createdAt: 'asc' } }, _count: true },
    })

    const votedIds = new Set(
      req.user
        ? await prisma.postVote.findMany({ where: { userId: req.user.id } }).then((v) => v.map((e) => e.postId))
        : [],
    )

    posts = posts.map(({ _count, ownerId, ...post }) => ({
      ...post,
      comments: _count.comments,
      commentList: post.comments,
      voted: votedIds.has(post.id) || false,
      deletable: req.user ? req.user.role === 'admin' || ownerId === req.user.id : false,
    }))

    if (req.query.sort === 'top') posts = [...posts].sort((a, b) => b.upvotes - a.upvotes)

    res.json(posts)
  } catch (err) {
    next(err)
  }
})

communityRoutes.get('/:id', async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: Number(req.params.id) },
      include: { comments: { orderBy: { createdAt: 'asc' } } },
    })
    if (!post) return res.status(404).json({ error: 'Post not found.' })
    const { ownerId, ...safe } = post
    res.json({
      ...safe,
      deletable: req.user ? req.user.role === 'admin' || ownerId === req.user.id : false,
    })
  } catch (err) {
    next(err)
  }
})

communityRoutes.post('/', async (req, res, next) => {
  try {
    const { title, body, category } = req.body || {}
    if (!title || !body || !category) {
      return res.status(400).json({ error: 'title, body, and category are required.' })
    }
    if (!requireVibeTag(req, res)) return

    const post = await prisma.post.create({
      data: {
        title,
        body,
        category,
        authorId: req.user.id,
        authorName: req.user.vibeTag.trim(),
        anonymous: false,
        ownerId: req.user.id,
      },
    })
    const { ownerId: _ownerId, ...safe } = post
    const payload = { ...safe, comments: 0, commentList: [], voted: false, deletable: true }
    getIO().to('live').emit('post:new', { ...payload, deletable: false, voted: false })
    res.status(201).json(payload)
  } catch (err) {
    next(err)
  }
})

communityRoutes.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required to delete a post.' })
    const id = Number(req.params.id)
    const found = await prisma.post.findUnique({ where: { id } })
    if (!found) return res.status(404).json({ error: 'Post not found.' })
    const isAdmin = req.user.role === 'admin'
    if (found.ownerId !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to delete this post.' })
    }
    await prisma.post.delete({ where: { id } })
    getIO().to('live').emit('post:deleted', { id })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

communityRoutes.post('/:id/upvote', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const found = await prisma.post.findUnique({ where: { id } })
    if (!found) return res.status(404).json({ error: 'Post not found.' })
    if (!req.user) {
      const post = await prisma.post.update({ where: { id }, data: { upvotes: { increment: 1 } } })
      getIO().to('live').emit('post:voted', { id, upvotes: post.upvotes })
      return res.json(post)
    }
    const existing = await prisma.postVote.findFirst({ where: { postId: id, userId: req.user.id } })
    if (existing) {
      await prisma.postVote.delete({ where: { id: existing.id } })
      const post = await prisma.post.update({ where: { id }, data: { upvotes: { decrement: 1 } } })
      getIO().to('live').emit('post:voted', { id, upvotes: post.upvotes, unvoted: true })
      return res.json({ ...post, voted: false })
    }
    await prisma.postVote.create({ data: { postId: id, userId: req.user.id } })
    const post = await prisma.post.update({ where: { id }, data: { upvotes: { increment: 1 } } })
    getIO().to('live').emit('post:voted', { id, upvotes: post.upvotes })
    res.json({ ...post, voted: true })
  } catch (err) {
    next(err)
  }
})

communityRoutes.post('/:id/comments', async (req, res, next) => {
  try {
    const postId = Number(req.params.id)
    const found = await prisma.post.findUnique({ where: { id: postId } })
    if (!found) return res.status(404).json({ error: 'Post not found.' })
    const { body } = req.body || {}
    if (!body) return res.status(400).json({ error: 'A comment body is required.' })
    if (!requireVibeTag(req, res)) return

    const comment = await prisma.comment.create({
      data: { postId, body, authorId: req.user.id, authorName: req.user.vibeTag.trim() },
    })
    getIO().to('live').emit('comment:new', { postId, comment })
    res.status(201).json(comment)
  } catch (err) {
    next(err)
  }
})
