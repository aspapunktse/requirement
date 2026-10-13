-- Internal Audits (PRD 0001 F-IA.1, #152). Purely additive: one enum and three tables, no change to
-- any existing row. The Control and System pairs are explicit join tables (not implicit
-- many-to-many) because #154 hangs per-Control questions off them. A Control or System that
-- is deleted takes its join rows with it (CASCADE); that is right for a draft and must be
-- revisited by #154/#158 for launched audits. The creator is RESTRICT: a User with audits
-- can't be deleted. All three status values are added now since an enum value can't be used in
-- the migration that adds it.

-- CreateEnum
CREATE TYPE "InternalAuditStatus" AS ENUM ('DRAFT', 'LAUNCHED', 'CLOSED');

-- CreateTable
CREATE TABLE "InternalAudit" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeDescription" TEXT NOT NULL DEFAULT '',
    "dueDate" DATE NOT NULL,
    "includeOrganization" BOOLEAN NOT NULL DEFAULT false,
    "status" "InternalAuditStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalAuditControl" (
    "id" TEXT NOT NULL,
    "internalAuditId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalAuditControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalAuditSystem" (
    "id" TEXT NOT NULL,
    "internalAuditId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalAuditSystem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalAudit_createdById_idx" ON "InternalAudit"("createdById");

-- CreateIndex
CREATE INDEX "InternalAuditControl_controlId_idx" ON "InternalAuditControl"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalAuditControl_internalAuditId_controlId_key" ON "InternalAuditControl"("internalAuditId", "controlId");

-- CreateIndex
CREATE INDEX "InternalAuditSystem_systemId_idx" ON "InternalAuditSystem"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "InternalAuditSystem_internalAuditId_systemId_key" ON "InternalAuditSystem"("internalAuditId", "systemId");

-- AddForeignKey
ALTER TABLE "InternalAudit" ADD CONSTRAINT "InternalAudit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditControl" ADD CONSTRAINT "InternalAuditControl_internalAuditId_fkey" FOREIGN KEY ("internalAuditId") REFERENCES "InternalAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditControl" ADD CONSTRAINT "InternalAuditControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditSystem" ADD CONSTRAINT "InternalAuditSystem_internalAuditId_fkey" FOREIGN KEY ("internalAuditId") REFERENCES "InternalAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalAuditSystem" ADD CONSTRAINT "InternalAuditSystem_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

