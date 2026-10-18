-- Remove the well-being sentiment score feature.
--
-- Dropped everywhere: the per-message score/emotion label and its provenance,
-- the session-level roll-up, and the check-in text score. The product's
-- analytics now cover marks and attendance only.
ALTER TABLE "CheckIn" DROP COLUMN "label";
ALTER TABLE "CheckIn" DROP COLUMN "score";
ALTER TABLE "ChatMessage" DROP COLUMN "label";
ALTER TABLE "ChatMessage" DROP COLUMN "score";
ALTER TABLE "ChatMessage" DROP COLUMN "sentimentSource";
ALTER TABLE "ChatMessage" DROP COLUMN "sentimentConfidence";
ALTER TABLE "ChatMessage" DROP COLUMN "sentimentDetail";
ALTER TABLE "ChatSession" DROP COLUMN "sentimentScore";
