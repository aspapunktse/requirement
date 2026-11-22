-- Audit Questions (#404): a standing, ordered list of questions per Control for Internal Audits to draw on. One new table, no
-- change to existing ones and no data migration (a no-op on an empty database; every Control starts with an empty list, which
-- falls back to its Self-Assessment Question). Deleting a Control cascades to its Audit Questions.

-- CreateTable
CREATE TABLE "ControlAuditQuestion" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlAuditQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ControlAuditQuestion_controlId_position_key" ON "ControlAuditQuestion"("controlId", "position");

-- AddForeignKey
ALTER TABLE "ControlAuditQuestion" ADD CONSTRAINT "ControlAuditQuestion_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
