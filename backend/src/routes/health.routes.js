import { Router } from 'express'

export const healthRoutes = Router()

healthRoutes.get('/', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})