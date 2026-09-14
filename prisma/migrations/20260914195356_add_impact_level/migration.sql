/*
  Warnings:

  - You are about to drop the column `dataClassification` on the `System` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ImpactLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "minAvailabilityImpactLevel" "ImpactLevel",
ADD COLUMN     "minConfidentialityImpactLevel" "ImpactLevel",
ADD COLUMN     "minIntegrityImpactLevel" "ImpactLevel";

-- AlterTable
ALTER TABLE "System" DROP COLUMN "dataClassification",
ADD COLUMN     "availabilityImpactLevel" "ImpactLevel",
ADD COLUMN     "confidentialityImpactLevel" "ImpactLevel",
ADD COLUMN     "integrityImpactLevel" "ImpactLevel";
