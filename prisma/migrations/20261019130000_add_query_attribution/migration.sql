-- #201: who a Query Message, and an Assessment Query's resolution, is attributed to.
-- Additive and nullable only: no existing row changes (null means "shown named", as before),
-- so it is a no-op on an empty database and cannot raise.

-- AlterTable
ALTER TABLE "AssessmentQuery" ADD COLUMN     "resolvedAttributedTo" TEXT,
ADD COLUMN     "resolvedByReviewGroupId" TEXT;

-- AlterTable
ALTER TABLE "QueryMessage" ADD COLUMN     "attributedTo" TEXT,
ADD COLUMN     "reviewGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "AssessmentQuery" ADD CONSTRAINT "AssessmentQuery_resolvedByReviewGroupId_fkey" FOREIGN KEY ("resolvedByReviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryMessage" ADD CONSTRAINT "QueryMessage_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
