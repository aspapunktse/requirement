-- Evidence as records (#455): EvidenceItem, a validity period per Control, a SHA-256 digest per uploaded file.

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('LINK', 'DOCUMENT');

-- AlterTable
ALTER TABLE "Control" ADD COLUMN "evidenceValidityMonths" INTEGER;

-- AlterTable
ALTER TABLE "SystemDocumentFile" ADD COLUMN "sha256" TEXT;

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "controlAssessmentId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "url" TEXT,
    "systemDocumentId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceItem_controlAssessmentId_idx" ON "EvidenceItem"("controlAssessmentId");

-- CreateIndex
CREATE INDEX "EvidenceItem_systemDocumentId_idx" ON "EvidenceItem"("systemDocumentId");

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_controlAssessmentId_fkey" FOREIGN KEY ("controlAssessmentId") REFERENCES "ControlAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_systemDocumentId_fkey" FOREIGN KEY ("systemDocumentId") REFERENCES "SystemDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: digest of every file already stored (built-in sha256(bytea); only rows without one; a no-op on an empty table).
UPDATE "SystemDocumentFile" SET "sha256" = encode(sha256("data"), 'hex') WHERE "sha256" IS NULL;

-- Data: every http(s) URL in an Assessment's free-text evidence becomes a LINK record. The text itself stays in
-- "ControlAssessment"."evidence", untouched. One record per distinct (Assessment, URL); the id derives from both, so a
-- re-run inserts nothing. Trailing punctuation is not part of the URL. collectedAt is the Assessment's assessedAt, else
-- its updatedAt. A no-op when there is no evidence text.
INSERT INTO "EvidenceItem" ("id", "controlAssessmentId", "kind", "url", "collectedAt", "createdAt")
SELECT DISTINCT ON (u."assessmentId", u."url")
       'evb' || md5(u."assessmentId" || ' ' || u."url"),
       u."assessmentId",
       'LINK'::"EvidenceKind",
       u."url",
       u."collectedAt",
       u."collectedAt"
FROM (
  SELECT a."id" AS "assessmentId",
         COALESCE(a."assessedAt", a."updatedAt") AS "collectedAt",
         regexp_replace(m[1], '[.,;:!?)\]]+$', '') AS "url"
  FROM "ControlAssessment" a,
       LATERAL regexp_matches(a."evidence", '(https?://[^\s<>"'']+)', 'g') AS m
  WHERE a."evidence" IS NOT NULL
) u
WHERE u."url" ~ '^https?://[^/]+'
ORDER BY u."assessmentId", u."url"
ON CONFLICT ("id") DO NOTHING;
