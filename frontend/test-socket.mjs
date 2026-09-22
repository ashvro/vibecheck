import { io } from 'socket.io-client'
import * as http from 'http'

const BASE = 'http://localhost:4000'
const events = []
const received = new Promise((resolve) => {
  const socket = io(BASE, { transports: ['websocket'] })
  const wanted = ['post:new', 'comment:new', 'post:voted', 'post:deleted', 'club:new', 'club:updated', 'club:deleted', 'message:new']
  const got = {}
  socket.on('connect', () => {
    console.log('socket connected:', socket.connected)
    socket.emit('club:join', 1)
  })
  for (const ev of wanted) {
    socket.on(ev, (payload) => {
      got[ev] = payload
      console.log('EVENT', ev, JSON.stringify(payload).slice(0, 120))
      if (wanted.every((w) => got[w])) {
        socket.close()
        resolve(got)
      }
    })
  }
  socket.on('connect_error', (e) => {
    console.log('connect error', e.message)
    resolve(null)
  })
  setTimeout(() => { socket.close(); resolve(got) }, 12000)
})

async function auth(email, role) {
  const res = await fetch(BASE + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'T', email, password: 'pass1234', role }),
  })
  return res.json()
}
async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const t = new Date().getTime()
const student = await auth(`rt_s_${t}@test.com`, 'student')
const admin = await auth(`rt_a_${t}@test.com`, 'admin')
const stok = student.token, atok = admin.token

// club message
const msg = await api('POST', '/api/clubs/1/messages', stok, { body: 'hello via socket' })
// comment
const post = await api('POST', '/api/community', stok, { title: `rt ${t}`, body: 'x', category: 'Career' })
await api('POST', `/api/community/${post.id}/comments`, stok, { body: 'a comment' })
// vote
await api('POST', `/api/community/${post.id}/upvote`, stok)
// admin deletes post + deletes a club
await api('DELETE', `/api/community/${post.id}`, atok)
await api('DELETE', '/api/clubs/2', atok)

const summary = await received
console.log('EVENTS RECEIVED:', summary ? Object.keys(summary).sort() : 'none')
process.exit(0)