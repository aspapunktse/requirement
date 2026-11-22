-- Compliance Boundaries (#418, ADR 0016): the entity, its Frameworks and its member Systems. Three new tables, one new
-- ChangeEventAction value, no change to existing tables and no data migration (DDL only: a no-op on an empty database).
-- The enum value is only added here, nothing in this migration uses it. A Framework a Boundary holds can't be deleted
-- (RESTRICT); deleting a System, or a Boundary, cascades to its join rows; deleting a Business Unit or a Boundary
-- Owner's User clears that field on the Boundary.

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'BOUNDARY_MEMBERSHIP_CHANGED';

-- CreateTable
CREATE TABLE "ComplianceBoundary" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessUnitId" TEXT,
    "boundaryOwnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceBoundary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceBoundaryFramework" (
    "id" TEXT NOT NULL,
    "boundaryId" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "ComplianceBoundaryFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceBoundarySystem" (
    "id" TEXT NOT NULL,
    "boundaryId" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "ComplianceBoundarySystem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceBoundary_name_key" ON "ComplianceBoundary"("name");

-- CreateIndex
CREATE INDEX "ComplianceBoundary_businessUnitId_idx" ON "ComplianceBoundary"("businessUnitId");

-- CreateIndex
CREATE INDEX "ComplianceBoundary_boundaryOwnerId_idx" ON "ComplianceBoundary"("boundaryOwnerId");

-- CreateIndex
CREATE INDEX "ComplianceBoundaryFramework_frameworkId_idx" ON "ComplianceBoundaryFramework"("frameworkId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceBoundaryFramework_boundaryId_frameworkId_key" ON "ComplianceBoundaryFramework"("boundaryId", "frameworkId");

-- CreateIndex
CREATE INDEX "ComplianceBoundarySystem_systemId_idx" ON "ComplianceBoundarySystem"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceBoundarySystem_boundaryId_systemId_key" ON "ComplianceBoundarySystem"("boundaryId", "systemId");

-- AddForeignKey
ALTER TABLE "ComplianceBoundary" ADD CONSTRAINT "ComplianceBoundary_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundary" ADD CONSTRAINT "ComplianceBoundary_boundaryOwnerId_fkey" FOREIGN KEY ("boundaryOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundaryFramework" ADD CONSTRAINT "ComplianceBoundaryFramework_boundaryId_fkey" FOREIGN KEY ("boundaryId") REFERENCES "ComplianceBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundaryFramework" ADD CONSTRAINT "ComplianceBoundaryFramework_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "Framework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundaryFramework" ADD CONSTRAINT "ComplianceBoundaryFramework_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundarySystem" ADD CONSTRAINT "ComplianceBoundarySystem_boundaryId_fkey" FOREIGN KEY ("boundaryId") REFERENCES "ComplianceBoundary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundarySystem" ADD CONSTRAINT "ComplianceBoundarySystem_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceBoundarySystem" ADD CONSTRAINT "ComplianceBoundarySystem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

