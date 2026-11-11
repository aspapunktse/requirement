-- Change Review on Onboarded Systems (#334): the ChangeReview and ChangeReviewControl tables, its status enum, the link from a
-- Recommendation to the review it was given on (a Change Review Recommendation belongs to no stage, so `stage` becomes nullable),
-- and three Change Event actions that no SQL here uses. Additive only: no data changes, nothing is dropped, and it cannot raise.

-- CreateEnum
CREATE TYPE "ChangeReviewStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REVOKED');

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'CHANGE_REVIEW_STARTED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'CHANGE_REVIEW_WIDENED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'CHANGE_REVIEW_DECIDED';

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN     "changeReviewId" TEXT,
ALTER COLUMN "stage" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ChangeReview" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "status" "ChangeReviewStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionComment" TEXT,
    "sentBackTo" "EvaluationStage",

    CONSTRAINT "ChangeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeReviewControl" (
    "id" TEXT NOT NULL,
    "changeReviewId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "reviewGroupId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeReviewControl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeReview_systemId_idx" ON "ChangeReview"("systemId");

-- CreateIndex
CREATE INDEX "ChangeReviewControl_changeReviewId_idx" ON "ChangeReviewControl"("changeReviewId");

-- CreateIndex
CREATE INDEX "Recommendation_changeReviewId_idx" ON "Recommendation"("changeReviewId");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_changeReviewId_fkey" FOREIGN KEY ("changeReviewId") REFERENCES "ChangeReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeReview" ADD CONSTRAINT "ChangeReview_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeReview" ADD CONSTRAINT "ChangeReview_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeReviewControl" ADD CONSTRAINT "ChangeReviewControl_changeReviewId_fkey" FOREIGN KEY ("changeReviewId") REFERENCES "ChangeReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeReviewControl" ADD CONSTRAINT "ChangeReviewControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeReviewControl" ADD CONSTRAINT "ChangeReviewControl_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
