import jwt from 'jsonwebtoken'
import { prisma } from '../prisma.js'

const JWT_SECRET = process.env.JWT_SECRET || 'vibecheck-dev-secret'

export async function optionalAuth(req, _res, next) {
  try {
    const header = req.headers.authorization
    if (header && header.startsWith('Bearer ')) {
      const token = header.slice(7)
      const payload = jwt.verify(token, JWT_SECRET)
      if (payload && payload.sub) {
        const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
        if (user) {
          req.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            major: user.major,
            year: user.year,
            avatar: user.avatar,
            createdAt: user.createdAt,
          }
        }
      }
    }
  } catch {
    // Invalid or expired token — proceed as anonymous.
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' })
  next()
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions.' })
    }
    next()
  }
}