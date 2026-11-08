-- Framework Owner and first-round Controls (#319, PRD 0002 F-FO). Adds a column and a table; no data change.
--
-- 1. Framework.ownerId: the one User who owns the Framework, nullable (every existing Framework starts unowned,
--    no backfill). ON DELETE SET NULL, like Control.ownerId.
-- 2. FrameworkFirstRoundControl: one row per (Framework, Control) the owner marked first round; the primary key is
--    the pair, and both foreign keys are ON DELETE CASCADE. Starts empty.
--
-- Cannot raise: it only adds a nullable column and a new empty table with their constraints.

-- AlterTable
ALTER TABLE "Framework" ADD COLUMN "ownerId" TEXT;

-- CreateTable
CREATE TABLE "FrameworkFirstRoundControl" (
    "frameworkId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkFirstRoundControl_pkey" PRIMARY KEY ("frameworkId","controlId")
);

-- CreateIndex
CREATE INDEX "FrameworkFirstRoundControl_controlId_idx" ON "FrameworkFirstRoundControl"("controlId");

-- CreateIndex
CREATE INDEX "Framework_ownerId_idx" ON "Framework"("ownerId");

-- AddForeignKey
ALTER TABLE "Framework" ADD CONSTRAINT "Framework_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkFirstRoundControl" ADD CONSTRAINT "FrameworkFirstRoundControl_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkFirstRoundControl" ADD CONSTRAINT "FrameworkFirstRoundControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
