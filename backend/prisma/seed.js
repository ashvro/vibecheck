import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const courses = [
  { code: 'PSY-301', name: 'Cognitive Psychology', credits: 4, instructor: 'Dr. Elena Marsh', color: '#8b5cf6' },
  { code: 'CS-210', name: 'Data Structures', credits: 3, instructor: 'Prof. James Liu', color: '#06b6d4' },
  { code: 'STAT-220', name: 'Statistics for Social Sci.', credits: 3, instructor: 'Dr. Amara Osei', color: '#10b981' },
  { code: 'ENG-205', name: 'Academic Writing', credits: 3, instructor: 'Prof. Sarah Klein', color: '#f59e0b' },
  { code: 'BIO-101', name: 'Intro to Biology', credits: 4, instructor: 'Dr. Nadia Rahman', color: '#ec4899' },
  { code: 'HIS-150', name: 'World History', credits: 3, instructor: 'Dr. Tom Alvarez', color: '#f97316' },
]

const quizzes = [
  { courseCode: 'CS-210', title: 'Trees & Graphs Quiz', date: 'Wed, Mar 18', daysLeft: 2 },
  { courseCode: 'PSY-301', title: 'Memory Systems Quiz', date: 'Fri, Mar 20', daysLeft: 4 },
  { courseCode: 'STAT-220', title: 'Hypothesis Testing Quiz', date: 'Mon, Mar 23', daysLeft: 7 },
]

async function main() {
  await prisma.$transaction(async (tx) => {
    await tx.comment.deleteMany()
    await tx.post.deleteMany()
    await tx.clubMember.deleteMany()
    await tx.clubMessage.deleteMany()
    await tx.club.deleteMany()
    await tx.assignment.deleteMany()
    await tx.quiz.deleteMany()
    await tx.enrollment.deleteMany()
    await tx.submission.deleteMany()
    await tx.course.deleteMany()
    await tx.checkIn.deleteMany()
    await tx.chatMessage.deleteMany()
    await tx.chatSession.deleteMany()
    await tx.user.deleteMany()

    for (const c of courses) {
      await tx.course.create({ data: c })
    }

    for (const q of quizzes) {
      const course = await tx.course.findUnique({ where: { code: q.courseCode } })
      if (course) {
        await tx.quiz.create({
          data: { courseId: course.id, title: q.title, date: q.date, daysLeft: q.daysLeft },
        })
      }
    }

    console.log('Database seeded — course catalog only.')
  })
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })