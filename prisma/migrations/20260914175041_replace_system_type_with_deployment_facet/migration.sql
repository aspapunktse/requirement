-- Replace single-select SystemType (System.systemTypeId, a required scalar
-- FK) with a many-to-many DeploymentFacet relation, per ADR 0003. Existing
-- data is preserved: SystemType rows become DeploymentFacet rows in place,
-- and every System's single systemTypeId becomes exactly one row in the new
-- join table, so no System loses its current classification.

-- Rename SystemType -> DeploymentFacet (in place, preserving rows/ids)
ALTER TABLE "SystemType" RENAME TO "DeploymentFacet";
ALTER TABLE "DeploymentFacet" RENAME CONSTRAINT "SystemType_pkey" TO "DeploymentFacet_pkey";
ALTER INDEX "SystemType_name_key" RENAME TO "DeploymentFacet_name_key";

-- Rename & re-point the Requirement<->SystemType join table.
-- Old shape: _RequirementToSystemType(A = Requirement id, B = SystemType id)
-- New shape: _DeploymentFacetToRequirement(A = DeploymentFacet id, B = Requirement id)
-- ("DeploymentFacet" < "Requirement" alphabetically, so A/B swap sides.)
ALTER TABLE "_RequirementToSystemType" RENAME TO "_DeploymentFacetToRequirement";
ALTER TABLE "_DeploymentFacetToRequirement" DROP CONSTRAINT "_RequirementToSystemType_A_fkey";
ALTER TABLE "_DeploymentFacetToRequirement" DROP CONSTRAINT "_RequirementToSystemType_B_fkey";
ALTER TABLE "_DeploymentFacetToRequirement" RENAME COLUMN "A" TO "tmp_req";
ALTER TABLE "_DeploymentFacetToRequirement" RENAME COLUMN "B" TO "A";
ALTER TABLE "_DeploymentFacetToRequirement" RENAME COLUMN "tmp_req" TO "B";
ALTER TABLE "_DeploymentFacetToRequirement" RENAME CONSTRAINT "_RequirementToSystemType_AB_pkey" TO "_DeploymentFacetToRequirement_AB_pkey";
DROP INDEX "_RequirementToSystemType_B_index";
CREATE INDEX "_DeploymentFacetToRequirement_B_index" ON "_DeploymentFacetToRequirement"("B");
ALTER TABLE "_DeploymentFacetToRequirement" ADD CONSTRAINT "_DeploymentFacetToRequirement_A_fkey" FOREIGN KEY ("A") REFERENCES "DeploymentFacet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DeploymentFacetToRequirement" ADD CONSTRAINT "_DeploymentFacetToRequirement_B_fkey" FOREIGN KEY ("B") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New Deployment Facet <-> System join table.
-- ("DeploymentFacet" < "System" alphabetically: A = DeploymentFacet id, B = System id.)
CREATE TABLE "_DeploymentFacetToSystem" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DeploymentFacetToSystem_AB_pkey" PRIMARY KEY ("A","B")
);

CREATE INDEX "_DeploymentFacetToSystem_B_index" ON "_DeploymentFacetToSystem"("B");

-- Backfill: every existing System's single systemTypeId becomes its one
-- declared facet, before the column is dropped below.
INSERT INTO "_DeploymentFacetToSystem" ("A", "B")
SELECT "systemTypeId", "id" FROM "System";

ALTER TABLE "_DeploymentFacetToSystem" ADD CONSTRAINT "_DeploymentFacetToSystem_A_fkey" FOREIGN KEY ("A") REFERENCES "DeploymentFacet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_DeploymentFacetToSystem" ADD CONSTRAINT "_DeploymentFacetToSystem_B_fkey" FOREIGN KEY ("B") REFERENCES "System"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop the now-superseded scalar FK.
ALTER TABLE "System" DROP CONSTRAINT "System_systemTypeId_fkey";
ALTER TABLE "System" DROP COLUMN "systemTypeId";
