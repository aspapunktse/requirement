-- The Organization's own implementation of a Control (PRD 0001 F-IN.1, migration §9.7, #120): one
-- row per ORGANIZATIONAL or BOTH Control, with a status (the Control Assessment set) and a
-- description. PER_SYSTEM Controls never get one.
--
-- Data-driven: the rows come from whatever Controls exist (selected by applicability, no ids or
-- names hard-coded), so this is a no-op on an empty database. Idempotent: the unique index on
-- "controlId" plus ON CONFLICT DO NOTHING means running the INSERT again adds nothing. Ids come
-- from gen_random_uuid() (any unique string will do; Prisma's cuid() default is client-side only).

-- CreateTable
CREATE TABLE "OrganizationControlImplementation" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "status" "ControlAssessmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "description" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationControlImplementation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationControlImplementation_controlId_key" ON "OrganizationControlImplementation"("controlId");

-- CreateIndex
CREATE INDEX "OrganizationControlImplementation_updatedById_idx" ON "OrganizationControlImplementation"("updatedById");

-- AddForeignKey
-- CASCADE: an implementation belongs to its Control and goes with it.
ALTER TABLE "OrganizationControlImplementation" ADD CONSTRAINT "OrganizationControlImplementation_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: deleting the User who last edited it keeps the row and drops the attribution.
ALTER TABLE "OrganizationControlImplementation" ADD CONSTRAINT "OrganizationControlImplementation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: every existing ORGANIZATIONAL or BOTH Control starts Not Started, with no description and
-- nobody recorded as the editor. No other row is touched.
INSERT INTO "OrganizationControlImplementation" ("id", "controlId", "status", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'NOT_STARTED', CURRENT_TIMESTAMP
FROM "Control" c
WHERE c."applicability" IN ('ORGANIZATIONAL', 'BOTH')
ON CONFLICT ("controlId") DO NOTHING;
