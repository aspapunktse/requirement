-- Business System Owner on a System (#321, PRD 0002 F-BSO). Adds a nullable column, an index, a foreign key and one
-- enum value; no data change and no backfill (no System has a Business System Owner at first, PRD 0002 section 7.3).
--
-- 1. System.businessSystemOwnerId: the optional User who will decide the System's evaluation gates. ON DELETE SET NULL,
--    like Framework.ownerId and Control.ownerId.
-- 2. ChangeEventAction gains BUSINESS_SYSTEM_OWNER_CHANGED. No row uses it in this migration, so it needs no migration
--    of its own (Postgres only refuses to use a value in the transaction that adds it).
--
-- Cannot raise: it only adds a nullable column and its constraints to existing rows, all of which are NULL.

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'BUSINESS_SYSTEM_OWNER_CHANGED';

-- AlterTable
ALTER TABLE "System" ADD COLUMN "businessSystemOwnerId" TEXT;

-- CreateIndex
CREATE INDEX "System_businessSystemOwnerId_idx" ON "System"("businessSystemOwnerId");

-- AddForeignKey
ALTER TABLE "System" ADD CONSTRAINT "System_businessSystemOwnerId_fkey" FOREIGN KEY ("businessSystemOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
