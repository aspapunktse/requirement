-- A Risk opened by an Internal Audit's Nonconformity (PRD 0001 F-IA.7, F-CE.2, #157).
--
-- ALTERS AN EXISTING TABLE ("Risk"), but cannot change or abort on any existing row:
--   * "systemId" loses NOT NULL (a Risk opened by an Organization-level Nonconformity has no
--     System). Dropping a NOT NULL constraint is always valid; every existing row keeps its System.
--   * "checkUpId" is a new nullable column: every existing row gets NULL.
--   * a unique index on it (NULLs are distinct in Postgres, so any number of NULLs coexist), a
--     foreign key (RESTRICT: a Check-up is audit evidence and cannot be deleted from under a Risk)
--     and a CHECK constraint, written by hand because Prisma's schema language cannot express it
--     and `migrate diff` ignores it (like the partial index "CheckUp_organization_target_key"):
--     a Risk has a System or a Check-up, never neither. Every existing row has a System, so the
--     constraint is true for all of them and ADD CONSTRAINT cannot fail.
-- No data is read or written beyond that, so this is a no-op on an empty database and needs no
-- pre-check script.

-- AlterTable
ALTER TABLE "Risk" ALTER COLUMN "systemId" DROP NOT NULL,
ADD COLUMN     "checkUpId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Risk_checkUpId_key" ON "Risk"("checkUpId");

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_checkUpId_fkey" FOREIGN KEY ("checkUpId") REFERENCES "CheckUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Risk is never without context: it belongs to a System or it was opened by a Check-up.
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_system_or_check_up_check" CHECK ("systemId" IS NOT NULL OR "checkUpId" IS NOT NULL);
