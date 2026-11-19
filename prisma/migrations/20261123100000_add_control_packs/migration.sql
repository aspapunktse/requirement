-- Control Packs (#394): named sets of Controls an Internal Auditor keeps for planning Internal Audits. Two new tables, no
-- change to existing ones and no data migration (a no-op on an empty database). InternalAudit has no link to a pack: the
-- audit doesn't remember where its Controls came from. Deleting a Control or a pack cascades to the join rows.

-- CreateTable
CREATE TABLE "ControlPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlPackControl" (
    "id" TEXT NOT NULL,
    "controlPackId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,

    CONSTRAINT "ControlPackControl_pkey" PRIMARY KEY ("id")
);

-- Names are unique ignoring case ("Access control" and "access control" clash). Prisma's schema can't express an index
-- on an expression, so this one lives only here; the route checks first and maps a lost race to the same refusal.
CREATE UNIQUE INDEX "ControlPack_name_lower_key" ON "ControlPack"(lower("name"));

-- CreateIndex
CREATE INDEX "ControlPackControl_controlId_idx" ON "ControlPackControl"("controlId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlPackControl_controlPackId_controlId_key" ON "ControlPackControl"("controlPackId", "controlId");

-- AddForeignKey
ALTER TABLE "ControlPackControl" ADD CONSTRAINT "ControlPackControl_controlPackId_fkey" FOREIGN KEY ("controlPackId") REFERENCES "ControlPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlPackControl" ADD CONSTRAINT "ControlPackControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
