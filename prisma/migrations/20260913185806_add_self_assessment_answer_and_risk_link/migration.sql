-- CreateEnum
CREATE TYPE "SelfAssessmentAnswer" AS ENUM ('YES', 'NO', 'NA');

-- AlterTable
ALTER TABLE "RequirementAssessment" ADD COLUMN     "selfAssessmentAnswer" "SelfAssessmentAnswer";

-- AlterTable
ALTER TABLE "Risk" ADD COLUMN     "requirementAssessmentId" TEXT;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_requirementAssessmentId_fkey" FOREIGN KEY ("requirementAssessmentId") REFERENCES "RequirementAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
