import { io, type Socket } from 'socket.io-client'
import { getToken } from './api'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: false,
      auth: { token: getToken() },
    })
  }
  return socket
}

export function connectSocket(): Socket {
  const s = getSocket()
  s.auth = { token: getToken() }
  if (!s.connected) s.connect()
  return s
}