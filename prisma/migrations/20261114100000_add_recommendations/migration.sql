-- The Full track's first half (#331): the Recommendation table (OAG review, one row per group's Recommendation), its kind enum, the
-- written justification on a gate decision (Proceed at OG2 against an Advise-against), and two Change Event actions that no SQL here
-- uses. Additive only: one nullable column, one new table, one new enum, two new enum values. No data changes, and it cannot raise.

-- CreateEnum
CREATE TYPE "RecommendationKind" AS ENUM ('RECOMMEND', 'RECOMMEND_WITH_CONDITIONS', 'ADVISE_AGAINST');

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'RECOMMENDATION_GIVEN';
ALTER TYPE "ChangeEventAction" ADD VALUE 'RECOMMENDATION_REOPENED';

-- AlterTable
ALTER TABLE "GateDecision" ADD COLUMN     "justification" TEXT;

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "stage" "EvaluationStage" NOT NULL,
    "reviewGroupId" TEXT,
    "givenById" TEXT NOT NULL,
    "kind" "RecommendationKind" NOT NULL,
    "comment" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_systemId_idx" ON "Recommendation"("systemId");

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_givenById_fkey" FOREIGN KEY ("givenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
