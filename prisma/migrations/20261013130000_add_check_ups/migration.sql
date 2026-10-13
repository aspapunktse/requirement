-- Check-up questions and launching an Internal Audit (PRD 0001 F-IA.2, F-IA.3, #154).
-- Purely additive: two columns on "InternalAudit" and four tables, no change to any existing row,
-- and no enum value (a Check-up has no status yet: answered, evaluated and withdrawn arrive with
-- #155, #156 and #158, which add what they need).
--
-- * "InternalAuditQuestion": the draft's ordered questions per target Control (hangs off the
--   "InternalAuditControl" row, CASCADE, so removing a Control from a draft removes them).
-- * "CheckUp" / "CheckUpQuestion": generated at launch. A Check-up names the audit, the Control
--   and one target: a System ("systemId") or, when null, the Organization. Every foreign key into
--   a Check-up's parents is RESTRICT: a launched audit is evidence, so a Control, a System or the
--   audit can't be deleted from under its Check-ups. The recipient is not stored (it is the
--   System's owner or the Control Owner *now*, #155) and neither is the due date (the audit's).
-- * Postgres treats NULLs as distinct in a unique index, so the unique on (audit, Control,
--   "systemId") only guards System targets. The Organization-level target gets a partial unique
--   index, written by hand below; Prisma's schema can't express it and ignores it in `migrate
--   diff`, so the drift check stays clean.
-- * "InternalAudit"."launchedAt" / "launchedById": when and by whom (RESTRICT, like "createdById").

-- AlterTable
ALTER TABLE "InternalAudit" ADD COLUMN     "launchedAt" TIMESTAMP(3),
ADD COLUMN     "launchedById" TEXT;

-- CreateTable
CREATE TABLE "InternalAuditQuestion" (
    "id" TEXT NOT NULL,
    "internalAuditControlId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalAuditQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckUp" (
    "id" TEXT NOT NULL,
    "internalAuditId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "systemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckUpQuestion" (
    "id" TEXT NOT NULL,
    "checkUpId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckUpQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InternalAuditQuestion_internalAuditControlId_position_key" ON "InternalAuditQuestion"("internalAuditControlId", "position");

-- CreateIndex
CREATE INDEX "CheckUp_controlId_idx" ON "CheckUp"("controlId");

-- CreateIndex
CREATE INDEX "CheckUp_systemId_idx" ON "CheckUp"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckUp_internalAuditId_controlId_systemId_key" ON "CheckUp"("internalAuditId", "controlId", "systemId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckUpQuestion_checkUpId_position_key" ON "CheckUpQuestion"("checkUpId", "position");

-- CreateIndex
CREATE INDEX "InternalAudit_launchedById_idx" ON "InternalAudit"("launchedById");

-- AddForeignKey
ALTER TABLE "InternalAudit" ADD CONSTRAINT "InternalAudit_launchedById_fkey" FOREIGN KEY ("launchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditQuestion" ADD CONSTRAINT "InternalAuditQuestion_internalAuditControlId_fkey" FOREIGN KEY ("internalAuditControlId") REFERENCES "InternalAuditControl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUp" ADD CONSTRAINT "CheckUp_internalAuditId_fkey" FOREIGN KEY ("internalAuditId") REFERENCES "InternalAudit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUp" ADD CONSTRAINT "CheckUp_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUp" ADD CONSTRAINT "CheckUp_internalAuditId_controlId_fkey" FOREIGN KEY ("internalAuditId", "controlId") REFERENCES "InternalAuditControl"("internalAuditId", "controlId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUp" ADD CONSTRAINT "CheckUp_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpQuestion" ADD CONSTRAINT "CheckUpQuestion_checkUpId_fkey" FOREIGN KEY ("checkUpId") REFERENCES "CheckUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: at most one Organization-level Check-up per audit and Control.
CREATE UNIQUE INDEX "CheckUp_organization_target_key" ON "CheckUp"("internalAuditId", "controlId") WHERE "systemId" IS NULL;

-- Draft Internal Audits created under #152 have no question rows: give each target Control that has
-- a Self-Assessment Question that question as its first draft question, as a new draft would get.
-- Idempotent (only pairs with no question yet) and a no-op on an empty table.
INSERT INTO "InternalAuditQuestion" ("id", "internalAuditControlId", "position", "text")
SELECT gen_random_uuid()::text, iac."id", 1, btrim(c."question")
FROM "InternalAuditControl" iac
JOIN "InternalAudit" ia ON ia."id" = iac."internalAuditId" AND ia."status" = 'DRAFT'
JOIN "Control" c ON c."id" = iac."controlId"
WHERE c."question" IS NOT NULL
  AND btrim(c."question") <> ''
  AND NOT EXISTS (SELECT 1 FROM "InternalAuditQuestion" q WHERE q."internalAuditControlId" = iac."id");
