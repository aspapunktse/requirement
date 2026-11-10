-- Staged evaluation up to OG1 (#328, PRD 0002 F-ST.1-3). Adds the EvaluationStage enum (the whole flow, so the later stage issues need no
-- enum migration), three nullable columns on "System" (stage, Track, when it entered the stage), the TrackVerdict table (OG1 verdicts)
-- and three ChangeEventAction values. Existing Systems get NULL stage and Track: they stay on the classic flow. No data change and
-- no backfill; it cannot raise (it only creates new objects, adds nullable columns, and adds enum values nothing here uses).

-- CreateEnum
CREATE TYPE "EvaluationStage" AS ENUM ('FIRST_ROUND', 'OG1', 'QUALIFICATION', 'FIRST_DOCUMENTATION', 'OAG_REVIEW_1', 'OG2', 'SECOND_ROUND', 'OAG_REVIEW_2', 'OG3');

-- AlterEnum
ALTER TYPE "ChangeEventAction" ADD VALUE 'EVALUATION_STAGE_CHANGED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'TRACK_VERDICT_GIVEN';
ALTER TYPE "ChangeEventAction" ADD VALUE 'TRACK_VERDICT_REOPENED';

-- AlterTable
ALTER TABLE "System" ADD COLUMN     "evaluationStage" "EvaluationStage",
ADD COLUMN     "evaluationStageEnteredAt" TIMESTAMP(3),
ADD COLUMN     "evaluationTrack" "EvaluationTrack";

-- CreateTable
CREATE TABLE "TrackVerdict" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "reviewGroupId" TEXT,
    "verdictById" TEXT NOT NULL,
    "verdict" "EvaluationTrack" NOT NULL,
    "comment" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "TrackVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackVerdict_systemId_idx" ON "TrackVerdict"("systemId");

-- AddForeignKey
ALTER TABLE "TrackVerdict" ADD CONSTRAINT "TrackVerdict_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVerdict" ADD CONSTRAINT "TrackVerdict_reviewGroupId_fkey" FOREIGN KEY ("reviewGroupId") REFERENCES "ReviewGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackVerdict" ADD CONSTRAINT "TrackVerdict_verdictById_fkey" FOREIGN KEY ("verdictById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
