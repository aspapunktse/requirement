-- CreateEnum
CREATE TYPE "ChangeEventAction" AS ENUM ('SYSTEM_SUBMITTED', 'APPROVAL_DECIDED', 'SYSTEM_ONBOARDED', 'RISK_STATUS_CHANGED', 'ASSESSMENT_STATUS_CHANGED', 'QUERY_OPENED', 'QUERY_REPLIED', 'QUERY_RESOLVED', 'CLASSIFICATION_CHANGED');

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "action" "ChangeEventAction" NOT NULL,
    "detail" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeEvent_systemId_createdAt_idx" ON "ChangeEvent"("systemId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeEvent_createdAt_idx" ON "ChangeEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
