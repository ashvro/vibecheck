import { Router } from 'express'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { prisma } from '../prisma.js'

const JWT_SECRET = process.env.JWT_SECRET || 'vibecheck-dev-secret'
const TOKEN_EXPIRY = '7d'

// A VibeTag is this app's public identity — a gamertag shown in Community.
const VIBE_TAG_RE = /^[A-Za-z0-9_]{3,20}$/

function normalizeVibeTag(raw) {
  return String(raw ?? '').trim()
}

export const authRoutes = Router()

authRoutes.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' })
  const user = await prisma.user.findUnique({ where: { id: req.user.id } })
  if (!user) return res.status(401).json({ error: 'Not authenticated.' })
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    major: user.major,
    year: user.year,
    avatar: user.avatar,
    createdAt: user.createdAt,
    vibeTag: user.vibeTag,
    preferences: {
      anonymousDefault: user.anonymousDefault,
      nudges: user.nudges,
      nightMode: user.nightMode,
    },
  })
})

authRoutes.get('/preferences', async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' })
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } })
    if (!user) return res.status(401).json({ error: 'Not authenticated.' })
    res.json({
      anonymousDefault: user.anonymousDefault,
      nudges: user.nudges,
      nightMode: user.nightMode,
    })
  } catch (err) {
    next(err)
  }
})

authRoutes.patch('/preferences', async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' })
  try {
    const { anonymousDefault, nudges, nightMode } = req.body || {}
    const data = {}
    if (anonymousDefault !== undefined) data.anonymousDefault = !!anonymousDefault
    if (nudges !== undefined) data.nudges = !!nudges
    if (nightMode !== undefined) data.nightMode = !!nightMode
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No preference fields provided.' })
    }
    const updated = await prisma.user.update({ where: { id: req.user.id }, data })
    res.json({
      anonymousDefault: updated.anonymousDefault,
      nudges: updated.nudges,
      nightMode: updated.nightMode,
    })
  } catch (err) {
    next(err)
  }
})

authRoutes.patch('/me', async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' })
  try {
    const { name, major, year, avatar, vibeTag } = req.body || {}
    const data = {}
    if (name !== undefined) data.name = String(name)
    if (major !== undefined) data.major = major === '' ? null : String(major)
    if (year !== undefined) data.year = year === '' ? null : String(year)
    if (avatar !== undefined) data.avatar = avatar === '' ? null : String(avatar)
    if (vibeTag !== undefined) {
      const tag = normalizeVibeTag(vibeTag)
      if (tag && !VIBE_TAG_RE.test(tag)) {
        return res
          .status(400)
          .json({ error: 'VibeTag must be 3–20 characters: letters, numbers, or underscores.' })
      }
      data.vibeTag = tag || null
    }
    const updated = await prisma.user.update({ where: { id: req.user.id }, data })
    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      major: updated.major,
      year: updated.year,
      avatar: updated.avatar,
      createdAt: updated.createdAt,
      vibeTag: updated.vibeTag,
      preferences: {
        anonymousDefault: updated.anonymousDefault,
        nudges: updated.nudges,
        nightMode: updated.nightMode,
      },
    })
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'That VibeTag is already taken. Try another one.' })
    }
    next(err)
  }
})

/** GET /api/auth/vibetag/check?tag=awesome — live availability for the tag picker. */
authRoutes.get('/vibetag/check', async (req, res, next) => {
  try {
    const tag = normalizeVibeTag(req.query.tag)
    if (!VIBE_TAG_RE.test(tag)) {
      return res.json({
        available: false,
        reason: 'format',
        error: 'Use 3–20 characters: letters, numbers, or underscores.',
      })
    }
    const existing = await prisma.user.findUnique({ where: { vibeTag: tag } })
    res.json({
      available: !existing,
      reason: existing ? 'taken' : 'ok',
      error: existing ? 'That VibeTag is already taken.' : null,
    })
  } catch (err) {
    next(err)
  }
})

authRoutes.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, role, vibeTag } = req.body || {}

    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'name, email, and password are required.' })
    }

    const tag = normalizeVibeTag(vibeTag)
    if (tag && !VIBE_TAG_RE.test(tag)) {
      return res
        .status(400)
        .json({ error: 'VibeTag must be 3–20 characters: letters, numbers, or underscores.' })
    }

    const existing = await prisma.user.findUnique({ where: { email: email.trim() } })
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' })
    }

    if (tag) {
      const tagged = await prisma.user.findUnique({ where: { vibeTag: tag } })
      if (tagged) return res.status(409).json({ error: 'That VibeTag is already taken. Pick another one.' })
    }

    const roleValue = ['student', 'teacher', 'admin'].includes(role) ? role : 'student'
    const passwordHash = await bcrypt.hash(password.trim(), 10)
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: roleValue,
        vibeTag: tag || null,
      },
    })

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: await bcrypt.hash(token, 8),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    res.status(201).json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vibeTag: user.vibeTag,
      },
    })
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'That VibeTag is already taken. Pick another one.' })
    }
    next(err)
  }
})

authRoutes.post('/signin', async (req, res, next) => {
  try {
    const { email, password } = req.body || {}

    if (!email?.trim() || !password?.trim()) {
      return res.status(400).json({ error: 'email and password are required.' })
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } })
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const valid = await bcrypt.compare(password.trim(), user.passwordHash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY })

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: await bcrypt.hash(token, 8),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, vibeTag: user.vibeTag },
    })
  } catch (err) {
    next(err)
  }
})