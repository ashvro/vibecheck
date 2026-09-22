import { prisma } from './prisma.js'
import { factorWeights } from './data/store.js'

function fmtDate(value) {
  try {
    return new Date(value).toLocaleDateString('en-GB')
  } catch {
    return String(value)
  }
}

export async function buildUserContext(userId) {
  const [user, enrollments, checkIns, sessions, memberships, posts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true, major: true, year: true },
    }),
    prisma.enrollment.findMany({ where: { userId }, include: { course: true } }),
    prisma.checkIn.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 7 }),
    prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { sentimentScore: true },
    }),
    prisma.clubMember.findMany({
      where: { userId },
      include: { club: { select: { name: true } } },
    }),
    prisma.post.findMany({
      where: { authorId: userId },
      orderBy: { createdAt: 'desc' },
      take: 4,
      select: { title: true, category: true, upvotes: true },
    }),
  ])

  const lines = []

  if (user) {
    const profile = [user.name, user.role].filter(Boolean).join(' · ')
    const extra = [user.major, user.year ? `year ${user.year}` : ''].filter(Boolean).join(' · ')
    lines.push(`Profile: ${profile}${extra ? ` · ${extra}` : ''}`)
  }

  if (enrollments.length) {
    lines.push('Courses:')
    for (const e of enrollments) {
      const avg = e.ia1 != null && e.ia2 != null ? Math.round((e.ia1 + e.ia2) / 2) : null
      const parts = [
        `${e.course.code} ${e.course.name}`,
        `IA1 ${e.ia1 ?? '—'}`,
        `IA2 ${e.ia2 ?? '—'}`,
        avg != null ? `average ${avg}/100` : '',
        e.attendance != null ? `attendance ${e.attendance}%` : '',
      ].filter(Boolean)
      lines.push(` - ${parts.join(', ')}`)
    }
  }

  const sentiment = sessions.find((s) => s.sentimentScore != null)?.sentimentScore ?? null
  if (sentiment != null) {
    lines.push(`Well-being sentiment (latest assistant session): ${sentiment}`)
  }

  if (checkIns.length) {
    lines.push('Recent mood check-ins (most recent first):')
    for (const c of checkIns) {
      const score = c.score != null && c.label != null ? ` (${c.label}, ${Math.round(c.score * 100)}%)` : ''
      lines.push(` - ${fmtDate(c.createdAt)}: mood "${c.mood}"${score}`)
    }
  }

  if (memberships.length) {
    lines.push(`Clubs: ${memberships.map((m) => `${m.club.name} (as ${m.role})`).join(', ')}`)
  }

  if (posts.length) {
    lines.push(`Community posts (${posts.length}): ${posts.map((p) => `"${p.title}" (${p.category}, ${p.upvotes} upvotes)`).join(', ')}`)
  } else if (user) {
    lines.push('Community: no posts yet')
  }

  const weightOf = (name) => factorWeights.find((f) => f.name === name)?.value ?? 0
  const wGrade = weightOf('Grades') / 100
  const wAtt = weightOf('Attendance') / 100
  const wSent = weightOf('Well-being Sentiment') / 100

  let grade = null
  let attendance = null
  for (const e of enrollments) {
    if (e.ia1 != null && e.ia2 != null) {
      const g = Math.round((e.ia1 + e.ia2) / 2)
      grade = grade == null ? g : Math.round((grade + g) / 2)
    }
    if (e.attendance != null) {
      attendance = attendance == null ? e.attendance : Math.min(attendance, e.attendance)
    }
  }

  const weightSum = (grade != null ? wGrade : 0) + (attendance != null ? wAtt : 0) + (sentiment != null ? wSent : 0)
  if (weightSum > 0 && (grade != null || attendance != null || sentiment != null)) {
    const contribution =
      (grade != null ? (grade / 100) * wGrade : 0) +
      (attendance != null ? (attendance / 100) * wAtt : 0) +
      (sentiment != null ? sentiment * wSent : 0)
    const score = Math.round((1 - contribution / weightSum) * 100)
    const risk = score < 30 ? 'Low' : score < 55 ? 'Moderate' : 'High'
    lines.push(`Risk assessment (analytics model): ${risk} risk (score ${score}/100)`)
  }

  return {
    summary: lines.join('\n'),
    counts: {
      courses: enrollments.length,
      checkIns: checkIns.length,
      clubs: memberships.length,
      posts: posts.length,
    },
  }
}