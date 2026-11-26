-- OSCAL Releases (#453, ADR 0018): stored, immutable OSCAL Packages. A new table and enum; no existing row or column changes.

-- CreateEnum
CREATE TYPE "OscalReleaseTrigger" AS ENUM ('MANUAL', 'INTERNAL_AUDIT_CLOSE');

-- CreateTable
CREATE TABLE "OscalRelease" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "trigger" "OscalReleaseTrigger" NOT NULL,
    "internalAuditId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,

    CONSTRAINT "OscalRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OscalRelease_internalAuditId_idx" ON "OscalRelease"("internalAuditId");

-- CreateIndex
CREATE UNIQUE INDEX "OscalRelease_systemId_number_key" ON "OscalRelease"("systemId", "number");

-- AddForeignKey
ALTER TABLE "OscalRelease" ADD CONSTRAINT "OscalRelease_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OscalRelease" ADD CONSTRAINT "OscalRelease_internalAuditId_fkey" FOREIGN KEY ("internalAuditId") REFERENCES "InternalAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OscalRelease" ADD CONSTRAINT "OscalRelease_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
