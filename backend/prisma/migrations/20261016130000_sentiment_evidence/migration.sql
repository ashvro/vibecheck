-- Provenance for the well-being sentiment score on each chat turn.
ALTER TABLE "ChatMessage" ADD COLUMN "sentimentSource" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "sentimentConfidence" REAL;
ALTER TABLE "ChatMessage" ADD COLUMN "sentimentDetail" TEXT;
