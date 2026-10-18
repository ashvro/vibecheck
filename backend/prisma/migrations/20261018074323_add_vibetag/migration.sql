/*
  Warnings:

  - Added the required column `vibeTag` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vibeTag" TEXT NOT NULL DEFAULT 'vibe000000',
    "role" TEXT NOT NULL DEFAULT 'student',
    "avatar" TEXT,
    "major" TEXT,
    "year" TEXT,
    "anonymousDefault" BOOLEAN NOT NULL DEFAULT true,
    "nudges" BOOLEAN NOT NULL DEFAULT true,
    "nightMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("anonymousDefault", "avatar", "createdAt", "email", "id", "major", "name", "nightMode", "nudges", "passwordHash", "role", "updatedAt", "year") SELECT "anonymousDefault", "avatar", "createdAt", "email", "id", "major", "name", "nightMode", "nudges", "passwordHash", "role", "updatedAt", "year" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_vibeTag_key" ON "User"("vibeTag");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
