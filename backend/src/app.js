import express from 'express'
import cors from 'cors'
import { healthRoutes } from './routes/health.routes.js'
import { moodRoutes } from './routes/moods.routes.js'
import { assistantRoutes } from './routes/assistant.routes.js'
import { communityRoutes } from './routes/community.routes.js'
import { clubsRoutes } from './routes/clubs.routes.js'
import { lmsRoutes } from './routes/lms.routes.js'
import { analyticsRoutes } from './routes/analytics.routes.js'
import { mlRoutes } from './routes/ml.routes.js'
import { studyPlannerRoutes } from './routes/studyplanner.routes.js'
import { authRoutes } from './routes/auth.routes.js'
import { optionalAuth } from './middleware/auth.js'

export function createApp() {
  const app = express()

  app.use(cors())
  app.use(express.json())
  app.use(optionalAuth)

  app.use('/api/health', healthRoutes)
  app.use('/api/auth', authRoutes)
  app.use('/api/moods', moodRoutes)
  app.use('/api/assistant', assistantRoutes)
  app.use('/api/community', communityRoutes)
  app.use('/api/clubs', clubsRoutes)
  app.use('/api/lms', lmsRoutes)
  app.use('/api/analytics', analyticsRoutes)
  app.use('/api/analytics/ml', mlRoutes)
  app.use('/api/study-planner', studyPlannerRoutes)

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((err, req, res, next) => {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })

  return app
}