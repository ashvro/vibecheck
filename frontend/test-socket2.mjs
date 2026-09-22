import { io } from 'socket.io-client'

const BASE = 'http://localhost:4000'
const got = {}
const done = new Promise((resolve) => {
  const s = io(BASE, { transports: ['websocket'] })
  s.on('connect', () => { console.log('CONNECT'); s.emit('club:join', 1) })
  s.on('message:new', (p) => { got['message:new'] = p; console.log('EVENT message:new', JSON.stringify(p).slice(0, 100)) })
  s.on('club:new', (p) => { got['club:new'] = p; console.log('EVENT club:new', JSON.stringify(p).slice(0, 100)) })
  s.on('club:updated', (p) => { got['club:updated'] = p; console.log('EVENT club:updated', JSON.stringify(p).slice(0, 100)) })
  s.on('club:deleted', (p) => { got['club:deleted'] = p; console.log('EVENT club:deleted', JSON.stringify(p).slice(0, 100)) })
  setTimeout(() => { s.close(); resolve(got) }, 15000)
})

const t = new Date().getTime()
const r1 = await fetch(BASE + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'S', email: `cs_s_${t}@test.com`, password: 'pass1234' }) })
const stu = await r1.json()
const r2 = await fetch(BASE + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'A', email: `cs_a_${t}@test.com`, password: 'pass1234', role: 'admin' }) })
const adm = await r2.json()
const h = (tok) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` })

const m = await fetch(BASE + '/api/clubs/1/messages', { method: 'POST', headers: h(stu.token), body: JSON.stringify({ body: 'live msg' }) })
console.log('POST message ->', m.status)

const c = await fetch(BASE + '/api/clubs', { method: 'POST', headers: h(stu.token), body: JSON.stringify({ name: 'Live Club', description: 'sock', tags: ['Tech'] }) })
console.log('POST club ->', c.status)
const club = await c.json()

const j = await fetch(BASE + `/api/clubs/${club.id}/join`, { method: 'POST', headers: h(stu.token) })
console.log('JOIN club ->', j.status, JSON.stringify(await j.json()))

const d = await fetch(BASE + `/api/clubs/${club.id}`, { method: 'DELETE', headers: h(adm.token) })
console.log('DELETE club ->', d.status, JSON.stringify(await d.json()))

const summary = await done
console.log('RECEIVED:', Object.keys(summary).sort().join(', '))
process.exit(0)