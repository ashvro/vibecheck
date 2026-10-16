-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN "instructions" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "pdfMime" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "pdfName" TEXT;
ALTER TABLE "Assignment" ADD COLUMN "pdfSize" INTEGER;
ALTER TABLE "Assignment" ADD COLUMN "pdfStoredAs" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "assignmentId" INTEGER,
    "type" TEXT NOT NULL DEFAULT 'assignment',
    "score" REAL,
    "notes" TEXT,
    "fileName" TEXT,
    "fileStoredAs" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "gradedAt" DATETIME,
    "feedback" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Submission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Submission_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Submission" ("courseId", "createdAt", "id", "score", "type", "userId") SELECT "courseId", "createdAt", "id", "score", "type", "userId" FROM "Submission";
DROP TABLE "Submission";
ALTER TABLE "new_Submission" RENAME TO "Submission";
CREATE INDEX "Submission_assignmentId_idx" ON "Submission"("assignmentId");
CREATE UNIQUE INDEX "Submission_userId_assignmentId_key" ON "Submission"("userId", "assignmentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Assignment_courseId_idx" ON "Assignment"("courseId");
