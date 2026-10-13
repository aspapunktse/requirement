-- A Check-up's response (PRD 0001 F-IA.4, F-IA.5, #155).
-- Purely additive: one enum and two tables, no change to any existing row or column and no new
-- value in an existing enum.
--
-- * "CheckUpResponse": one per Check-up ("checkUpId" is unique, CASCADE like "CheckUpQuestion").
--   Its existence is what "answered" means (no status column on "CheckUp" yet). It records who
--   first submitted it and when ("respondedById", "respondedAt"), who changed it last and when
--   ("lastChangedById", "updatedAt") and the evidence links of the response as a whole
--   ("evidenceLinks", http(s) URLs validated by the application). Both users are RESTRICT: who
--   answered is part of the audit evidence, so a User with responses can't be deleted from under them.
-- * "CheckUpResponseAnswer": one per question of the Check-up ("questionId" is unique): Yes / No /
--   N/A in its own enum "CheckUpAnswer" (not "SelfAssessmentAnswer", so the two can diverge) and a
--   free-text description.
-- * #156 (evaluation) and #158 (withdrawal) add their own table or column beside these.

-- CreateEnum
CREATE TYPE "CheckUpAnswer" AS ENUM ('YES', 'NO', 'NA');

-- CreateTable
CREATE TABLE "CheckUpResponse" (
    "id" TEXT NOT NULL,
    "checkUpId" TEXT NOT NULL,
    "respondedById" TEXT NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "evidenceLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "CheckUpResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckUpResponseAnswer" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" "CheckUpAnswer" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CheckUpResponseAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckUpResponse_checkUpId_key" ON "CheckUpResponse"("checkUpId");

-- CreateIndex
CREATE INDEX "CheckUpResponse_respondedById_idx" ON "CheckUpResponse"("respondedById");

-- CreateIndex
CREATE INDEX "CheckUpResponse_lastChangedById_idx" ON "CheckUpResponse"("lastChangedById");

-- CreateIndex
CREATE UNIQUE INDEX "CheckUpResponseAnswer_questionId_key" ON "CheckUpResponseAnswer"("questionId");

-- CreateIndex
CREATE INDEX "CheckUpResponseAnswer_responseId_idx" ON "CheckUpResponseAnswer"("responseId");

-- AddForeignKey
ALTER TABLE "CheckUpResponse" ADD CONSTRAINT "CheckUpResponse_checkUpId_fkey" FOREIGN KEY ("checkUpId") REFERENCES "CheckUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpResponse" ADD CONSTRAINT "CheckUpResponse_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpResponse" ADD CONSTRAINT "CheckUpResponse_lastChangedById_fkey" FOREIGN KEY ("lastChangedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpResponseAnswer" ADD CONSTRAINT "CheckUpResponseAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CheckUpResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckUpResponseAnswer" ADD CONSTRAINT "CheckUpResponseAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CheckUpQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

