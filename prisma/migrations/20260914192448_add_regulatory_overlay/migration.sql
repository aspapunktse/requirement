/*
  Warnings:

  - The primary key for the `_DeploymentFacetToRequirement` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "_DeploymentFacetToRequirement" DROP CONSTRAINT "_DeploymentFacetToRequirement_AB_pkey",
ADD CONSTRAINT "_DeploymentFacetToRequirement_AB_pkey" PRIMARY KEY ("A", "B");

-- CreateTable
CREATE TABLE "RegulatoryOverlay" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegulatoryOverlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RegulatoryOverlayToRequirement" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RegulatoryOverlayToRequirement_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_RegulatoryOverlayToSystem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RegulatoryOverlayToSystem_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryOverlay_name_key" ON "RegulatoryOverlay"("name");

-- CreateIndex
CREATE INDEX "_RegulatoryOverlayToRequirement_B_index" ON "_RegulatoryOverlayToRequirement"("B");

-- CreateIndex
CREATE INDEX "_RegulatoryOverlayToSystem_B_index" ON "_RegulatoryOverlayToSystem"("B");

-- AddForeignKey
ALTER TABLE "_RegulatoryOverlayToRequirement" ADD CONSTRAINT "_RegulatoryOverlayToRequirement_A_fkey" FOREIGN KEY ("A") REFERENCES "RegulatoryOverlay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegulatoryOverlayToRequirement" ADD CONSTRAINT "_RegulatoryOverlayToRequirement_B_fkey" FOREIGN KEY ("B") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegulatoryOverlayToSystem" ADD CONSTRAINT "_RegulatoryOverlayToSystem_A_fkey" FOREIGN KEY ("A") REFERENCES "RegulatoryOverlay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RegulatoryOverlayToSystem" ADD CONSTRAINT "_RegulatoryOverlayToSystem_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;
