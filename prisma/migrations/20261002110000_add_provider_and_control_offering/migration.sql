-- Providers and Control Offerings (PRD 0001 F-IN.2, ADR 0008, #123). A System can be marked as a
-- Provider, and a Provider publishes Control Offerings: per Control, "this Provider implements it
-- for the Systems depending on it", Full or Shared. Nothing reads them yet (dependencies are #124).
--
-- Additive, no data change: every existing System gets isProvider = false (the column default) and
-- there are no Offerings. A no-op on an empty database apart from the new objects. The enum value
-- CONTROL_OFFERING_CHANGED is added by the previous migration, because a new enum value can't be
-- used in the transaction that adds it and this one doesn't use it.

-- CreateEnum
CREATE TYPE "ControlOfferingType" AS ENUM ('FULL', 'SHARED');

-- AlterTable
ALTER TABLE "System" ADD COLUMN "isProvider" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ControlOffering" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "type" "ControlOfferingType" NOT NULL,
    "customerResponsibility" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlOffering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControlOffering_controlId_idx" ON "ControlOffering"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlOffering_providerId_controlId_key" ON "ControlOffering"("providerId", "controlId");

-- AddForeignKey
-- CASCADE: an Offering belongs to its Provider and goes with it.
ALTER TABLE "ControlOffering" ADD CONSTRAINT "ControlOffering_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- CASCADE: an Offering is about one Control and goes with it.
ALTER TABLE "ControlOffering" ADD CONSTRAINT "ControlOffering_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
