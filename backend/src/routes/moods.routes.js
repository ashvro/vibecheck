import { Router } from 'express'
import { prisma } from '../prisma.js'
import { moodOptions } from '../data/store.js'
import { analyzeSentiment } from '../utils/sentiment.js'

export const moodRoutes = Router()

moodRoutes.get('/options', (_req, res) => {
  res.json(moodOptions)
})

moodRoutes.get('/', async (req, res, next) => {
  try {
    const where = {}
    if (req.user) where.userId = req.user.id
    else where.userId = null
    const checkIns = await prisma.checkIn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: req.query.limit ? Number(req.query.limit) : undefined,
    })
    res.json(checkIns)
  } catch (err) {
    next(err)
  }
})

moodRoutes.post('/', async (req, res, next) => {
  try {
    const { mood, text } = req.body || {}

    if (!mood) {
      return res.status(400).json({ error: 'A mood selection is required.' })
    }

    const info = moodOptions.find((o) => o.id === mood)
    const sentiment = analyzeSentiment(text || '')

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: req.user?.id ?? null,
        mood,
        text: text || '',
        label: sentiment.label,
        score: sentiment.score,
      },
    })

    res.status(201).json({
      ...checkIn,
      moodLabel: info ? info.label : mood,
      sentiment,
    })
  } catch (err) {
    next(err)
  }
})