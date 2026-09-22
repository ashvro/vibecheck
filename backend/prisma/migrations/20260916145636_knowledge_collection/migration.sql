-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeChunk" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "collection" TEXT NOT NULL DEFAULT 'mental_health',
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_KnowledgeChunk" ("category", "createdAt", "embedding", "id", "source", "text", "title", "tokens") SELECT "category", "createdAt", "embedding", "id", "source", "text", "title", "tokens" FROM "KnowledgeChunk";
DROP TABLE "KnowledgeChunk";
ALTER TABLE "new_KnowledgeChunk" RENAME TO "KnowledgeChunk";
CREATE INDEX "KnowledgeChunk_collection_category_idx" ON "KnowledgeChunk"("collection", "category");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
