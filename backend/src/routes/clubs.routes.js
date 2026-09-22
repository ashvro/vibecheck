import { Router } from 'express'
import { prisma } from '../prisma.js'
import { getIO } from '../socket.js'

export const clubsRoutes = Router()

clubsRoutes.get('/', async (req, res, next) => {
  try {
    let clubs = await prisma.club.findMany({ orderBy: { createdAt: 'desc' } })
    if (req.query.tag) {
      clubs = clubs.filter((c) => {
        const tags = JSON.parse(c.tags || '[]')
        return tags.some((t) => t.toLowerCase() === String(req.query.tag).toLowerCase())
      })
    }
    res.json(clubs)
  } catch (err) {
    next(err)
  }
})

clubsRoutes.get('/joined', async (req, res, next) => {
  try {
    if (!req.user) return res.json([])
    const memberships = await prisma.clubMember.findMany({
      where: { userId: req.user.id },
      include: { club: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(memberships.map((m) => m.club))
  } catch (err) {
    next(err)
  }
})

clubsRoutes.get('/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.clubMessage.findMany({
      where: { clubId: Number(req.params.id) },
      orderBy: { createdAt: 'asc' },
    })
    res.json(messages)
  } catch (err) {
    next(err)
  }
})

clubsRoutes.post('/:id/messages', async (req, res, next) => {
  try {
    const clubId = Number(req.params.id)
    const club = await prisma.club.findUnique({ where: { id: clubId } })
    if (!club) return res.status(404).json({ error: 'Club not found.' })

    const { body } = req.body || {}
    if (!body || typeof body !== 'string') return res.status(400).json({ error: 'A message body is required.' })

    const message = await prisma.clubMessage.create({
      data: {
        clubId,
        userId: req.user?.id ?? null,
        author: req.user?.name || 'Anonymous',
        body,
      },
    })

    getIO().to(`club:${clubId}`).emit('message:new', message)
    res.status(201).json(message)
  } catch (err) {
    next(err)
  }
})

clubsRoutes.post('/:id/join', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required to join a club.' })

    const clubId = Number(req.params.id)
    const club = await prisma.club.findUnique({ where: { id: clubId } })
    if (!club) return res.status(404).json({ error: 'Club not found.' })

    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: req.user.id } },
    })
    if (!existing) {
      await prisma.clubMember.create({ data: { clubId, userId: req.user.id } })
      await prisma.club.update({ where: { id: clubId }, data: { members: { increment: 1 } } })
    }
    const newCount = club.members + (existing ? 0 : 1)
    getIO().to('live').emit('club:updated', { id: clubId, members: newCount })
    res.json({ joined: true, members: newCount })
  } catch (err) {
    next(err)
  }
})

clubsRoutes.delete('/:id/join', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required.' })

    const clubId = Number(req.params.id)
    const existing = await prisma.clubMember.findUnique({
      where: { clubId_userId: { clubId, userId: req.user.id } },
    })
    if (existing) {
      await prisma.clubMember.delete({ where: { id: existing.id } })
      const club = await prisma.club.findUnique({ where: { id: clubId } })
      if (club && club.members > 0) {
        await prisma.club.update({ where: { id: clubId }, data: { members: { decrement: 1 } } })
        getIO().to('live').emit('club:updated', { id: clubId, members: club.members - 1 })
      }
    }
    res.json({ joined: false })
  } catch (err) {
    next(err)
  }
})

clubsRoutes.post('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required to create a club.' })

    const { name, description, tags, accent, banner } = req.body || {}
    if (!name?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'name and description are required.' })
    }

    const tagList = Array.isArray(tags) ? tags : []
    const accentValue = accent || '#8b5cf6'

    const club = await prisma.club.create({
      data: {
        name: name.trim(),
        description: description.trim(),
        members: 1,
        tags: JSON.stringify(tagList.length ? tagList : ['General']),
        accent: accentValue,
        banner: banner ? String(banner) : null,
        ownerId: req.user.id,
      },
    })

    await prisma.clubMember.create({ data: { clubId: club.id, userId: req.user.id } })

    getIO().to('live').emit('club:new', club)
    res.status(201).json(club)
  } catch (err) {
    next(err)
  }
})

clubsRoutes.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Login required to delete a club.' })

    const clubId = Number(req.params.id)
    const club = await prisma.club.findUnique({ where: { id: clubId } })
    if (!club) return res.status(404).json({ error: 'Club not found.' })

    const isAdmin = req.user.role === 'admin'
    const isOwner = club.ownerId === req.user.id
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'You can only delete clubs you created.' })
    }

    await prisma.club.delete({ where: { id: clubId } })
    getIO().to('live').emit('club:deleted', { id: clubId })
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

clubsRoutes.get('/:id', async (req, res, next) => {
  try {
    const club = await prisma.club.findUnique({ where: { id: Number(req.params.id) } })
    if (!club) return res.status(404).json({ error: 'Club not found.' })
    res.json(club)
  } catch (err) {
    next(err)
  }
})