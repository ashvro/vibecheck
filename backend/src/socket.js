import { Server } from 'socket.io'
import jwt from 'jsonwebtoken'
import { prisma } from './prisma.js'

const JWT_SECRET = process.env.JWT_SECRET || 'vibecheck-dev-secret'

let io = null

export function initSocketIO(server) {
  io = new Server(server, {
    cors: { origin: '*' },
  })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
      if (token) {
        const payload = jwt.verify(token, JWT_SECRET)
        if (payload && payload.sub) {
          const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } })
          if (user) {
            socket.data.user = {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
            }
          }
        }
      }
      next()
    } catch {
      next()
    }
  })

  io.on('connection', (socket) => {
    socket.join('live')

    socket.on('club:join', (clubId) => {
      if (Number.isFinite(Number(clubId))) socket.join(`club:${Number(clubId)}`)
    })

    socket.on('club:leave', (clubId) => {
      socket.leave(`club:${Number(clubId)}`)
    })

    socket.on('disconnect', () => {
      /* rooms are cleaned up automatically */
    })
  })

  return io
}

export function getIO() {
  if (!io) throw new Error('Socket.IO has not been initialized.')
  return io
}