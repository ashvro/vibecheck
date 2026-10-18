import { prisma } from '../src/prisma.js'
import { buildUserContext } from '../src/userContext.js'

const EMAIL = 'smoke.ctx@vibe.test'
const base = 'http://localhost:4000'

async function main() {
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.enrollment.deleteMany({ where: { user: { email: EMAIL } } })
  await prisma.course.deleteMany({ where: { code: { startsWith: 'SMOKE' }, enrollments: { none: {} }, submissions: { none: {} } } })
  await prisma.clubMember.deleteMany({ where: { user: { email: EMAIL } } })

  const signup = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Tester', email: EMAIL, password: 'smoketest', role: 'student' }),
  })
  const { token, user } = await signup.json()
  if (!token) throw new Error('signup failed')
  const auth = { Authorization: `Bearer ${token}` }

  const course = await prisma.course.create({ data: { code: 'SMOKE101', name: 'Context Test Course', credits: 4 } })
  await prisma.enrollment.create({ data: { userId: user.id, courseId: course.id, ia1: 82, ia2: 91, attendance: 96 } })
  await prisma.checkIn.createMany({ data: [
    { userId: user.id, mood: 'anxious', text: 'stressed about tests' },
    { userId: user.id, mood: 'okay', text: 'decent day' },
  ]})
  const club = await prisma.club.create({ data: { name: 'Smoke Coding Club', description: 'x', members: 1 } })
  await prisma.clubMember.create({ data: { clubId: club.id, userId: user.id, role: 'lead' } })
  await prisma.post.create({ data: { authorId: user.id, authorName: 'Smoke Tester', category: 'study', title: 'Preparing for SMOKE101 finals', body: 'help?', upvotes: 3 } })
  await prisma.chatSession.create({ data: { userId: user.id, title: 'MH smoke' } })

  const ctx = await buildUserContext(user.id)
  console.log('--- buildUserContext output ---')
  console.log(ctx.summary)
  console.log('counts:', JSON.stringify(ctx.counts))
  console.log('--- end ---')

  const ask = async (label, text) => {
    const r = await fetch(`${base}/api/assistant/chat`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    })
    const j = await r.json()
    console.log(`\n=== ${label} ===`)
    console.log('intent:', j.reply?.intent ?? j?.meta?.intent ?? '(none)')
    console.log('reply:\n' + (j.reply?.message ?? j.reply ?? '(no reply)'))
    console.log('meta:', JSON.stringify(j.meta ?? {}).slice(0, 200))
    return j
  }

  await ask('STRUCTURED (academics)', 'Explain how binary search works in simple words')
  await ask('USER-CONTEXT (grades/attendance)', 'how are my grades and attendance doing?')
  await ask('USER-CONTEXT (mood/clubs/posts)', 'what does my recent mood look like, and am I in any clubs?')

  console.log('\n--- cleanup ---')
  await prisma.post.deleteMany({ where: { authorId: user.id } })
  await prisma.clubMember.deleteMany({ where: { userId: user.id } })
  await prisma.enrollment.deleteMany({ where: { userId: user.id } })
  await prisma.checkIn.deleteMany({ where: { userId: user.id } })
  await prisma.chatSession.deleteMany({ where: { userId: user.id } })
  await prisma.user.deleteMany({ where: { id: user.id } })
  console.log('cleaned temp user', user.id)
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1) })