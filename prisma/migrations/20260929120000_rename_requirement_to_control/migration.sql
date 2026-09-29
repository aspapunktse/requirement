-- Rename the Requirement concept to Control (ADR 0005, #70). Pure rename:
-- every table, column, enum, index, and constraint is renamed in place, so
-- all rows and ids are preserved. "Requirement" is freed up for a
-- Framework's own line items, introduced by a later migration.
--
--   Requirement              -> Control
--   RequirementAssessment    -> ControlAssessment   (requirementId -> controlId)
--   RequirementQuery         -> AssessmentQuery     (requirementAssessmentId -> controlAssessmentId)
--   QueryMessage.requirementQueryId      -> assessmentQueryId
--   Risk.requirementAssessmentId         -> controlAssessmentId
--   enum RequirementStatus        -> ControlAssessmentStatus (values unchanged)
--   enum RequirementApplicability -> ControlApplicability    (values unchanged)
--
-- Implicit m:n join tables are named _<AlphabeticallyFirst>To<Second>, with
-- A = the first model's id and B = the second's. "Control" sorts before
-- DeploymentFacet/Framework/RegulatoryOverlay (but after Capability), so for
-- those three join tables the A/B columns swap sides; see the rename dance in
-- 20260914175041_replace_system_type_with_deployment_facet.

-- Enums (renaming a type keeps every column that uses it pointing at it)
ALTER TYPE "RequirementStatus" RENAME TO "ControlAssessmentStatus";
ALTER TYPE "RequirementApplicability" RENAME TO "ControlApplicability";

-- Requirement -> Control
ALTER TABLE "Requirement" RENAME TO "Control";
ALTER TABLE "Control" RENAME CONSTRAINT "Requirement_pkey" TO "Control_pkey";
ALTER INDEX "Requirement_code_key" RENAME TO "Control_code_key";

-- RequirementAssessment -> ControlAssessment
ALTER TABLE "RequirementAssessment" RENAME TO "ControlAssessment";
ALTER TABLE "ControlAssessment" RENAME COLUMN "requirementId" TO "controlId";
ALTER TABLE "ControlAssessment" RENAME CONSTRAINT "RequirementAssessment_pkey" TO "ControlAssessment_pkey";
ALTER TABLE "ControlAssessment" RENAME CONSTRAINT "RequirementAssessment_systemId_fkey" TO "ControlAssessment_systemId_fkey";
ALTER TABLE "ControlAssessment" RENAME CONSTRAINT "RequirementAssessment_requirementId_fkey" TO "ControlAssessment_controlId_fkey";
ALTER TABLE "ControlAssessment" RENAME CONSTRAINT "RequirementAssessment_assessedById_fkey" TO "ControlAssessment_assessedById_fkey";
ALTER TABLE "ControlAssessment" RENAME CONSTRAINT "RequirementAssessment_fulfilledByCapabilityId_fkey" TO "ControlAssessment_fulfilledByCapabilityId_fkey";
ALTER INDEX "RequirementAssessment_systemId_requirementId_key" RENAME TO "ControlAssessment_systemId_controlId_key";

-- RequirementQuery -> AssessmentQuery
ALTER TABLE "RequirementQuery" RENAME TO "AssessmentQuery";
ALTER TABLE "AssessmentQuery" RENAME COLUMN "requirementAssessmentId" TO "controlAssessmentId";
ALTER TABLE "AssessmentQuery" RENAME CONSTRAINT "RequirementQuery_pkey" TO "AssessmentQuery_pkey";
ALTER TABLE "AssessmentQuery" RENAME CONSTRAINT "RequirementQuery_requirementAssessmentId_fkey" TO "AssessmentQuery_controlAssessmentId_fkey";
ALTER TABLE "AssessmentQuery" RENAME CONSTRAINT "RequirementQuery_resolvedById_fkey" TO "AssessmentQuery_resolvedById_fkey";

-- QueryMessage.requirementQueryId -> assessmentQueryId
ALTER TABLE "QueryMessage" RENAME COLUMN "requirementQueryId" TO "assessmentQueryId";
ALTER TABLE "QueryMessage" RENAME CONSTRAINT "QueryMessage_requirementQueryId_fkey" TO "QueryMessage_assessmentQueryId_fkey";

-- Risk.requirementAssessmentId -> controlAssessmentId
ALTER TABLE "Risk" RENAME COLUMN "requirementAssessmentId" TO "controlAssessmentId";
ALTER TABLE "Risk" RENAME CONSTRAINT "Risk_requirementAssessmentId_fkey" TO "Risk_controlAssessmentId_fkey";

-- _CapabilityToRequirement -> _CapabilityToControl
-- ("Capability" < "Control": A stays Capability id, B stays Control id — no swap.)
ALTER TABLE "_CapabilityToRequirement" RENAME TO "_CapabilityToControl";
ALTER TABLE "_CapabilityToControl" RENAME CONSTRAINT "_CapabilityToRequirement_AB_pkey" TO "_CapabilityToControl_AB_pkey";
ALTER TABLE "_CapabilityToControl" RENAME CONSTRAINT "_CapabilityToRequirement_A_fkey" TO "_CapabilityToControl_A_fkey";
ALTER TABLE "_CapabilityToControl" RENAME CONSTRAINT "_CapabilityToRequirement_B_fkey" TO "_CapabilityToControl_B_fkey";
ALTER INDEX "_CapabilityToRequirement_B_index" RENAME TO "_CapabilityToControl_B_index";

-- _DeploymentFacetToRequirement -> _ControlToDeploymentFacet
-- Old: A = DeploymentFacet id, B = Requirement id.
-- New: A = Control id,         B = DeploymentFacet id.
ALTER TABLE "_DeploymentFacetToRequirement" RENAME TO "_ControlToDeploymentFacet";
ALTER TABLE "_ControlToDeploymentFacet" DROP CONSTRAINT "_DeploymentFacetToRequirement_A_fkey";
ALTER TABLE "_ControlToDeploymentFacet" DROP CONSTRAINT "_DeploymentFacetToRequirement_B_fkey";
ALTER TABLE "_ControlToDeploymentFacet" DROP CONSTRAINT "_DeploymentFacetToRequirement_AB_pkey";
DROP INDEX "_DeploymentFacetToRequirement_B_index";
ALTER TABLE "_ControlToDeploymentFacet" RENAME COLUMN "A" TO "tmp_facet";
ALTER TABLE "_ControlToDeploymentFacet" RENAME COLUMN "B" TO "A";
ALTER TABLE "_ControlToDeploymentFacet" RENAME COLUMN "tmp_facet" TO "B";
ALTER TABLE "_ControlToDeploymentFacet" ADD CONSTRAINT "_ControlToDeploymentFacet_AB_pkey" PRIMARY KEY ("A", "B");
CREATE INDEX "_ControlToDeploymentFacet_B_index" ON "_ControlToDeploymentFacet"("B");
ALTER TABLE "_ControlToDeploymentFacet" ADD CONSTRAINT "_ControlToDeploymentFacet_A_fkey" FOREIGN KEY ("A") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ControlToDeploymentFacet" ADD CONSTRAINT "_ControlToDeploymentFacet_B_fkey" FOREIGN KEY ("B") REFERENCES "DeploymentFacet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- _FrameworkToRequirement -> _ControlToFramework
-- Old: A = Framework id, B = Requirement id.
-- New: A = Control id,   B = Framework id.
ALTER TABLE "_FrameworkToRequirement" RENAME TO "_ControlToFramework";
ALTER TABLE "_ControlToFramework" DROP CONSTRAINT "_FrameworkToRequirement_A_fkey";
ALTER TABLE "_ControlToFramework" DROP CONSTRAINT "_FrameworkToRequirement_B_fkey";
ALTER TABLE "_ControlToFramework" DROP CONSTRAINT "_FrameworkToRequirement_AB_pkey";
DROP INDEX "_FrameworkToRequirement_B_index";
ALTER TABLE "_ControlToFramework" RENAME COLUMN "A" TO "tmp_framework";
ALTER TABLE "_ControlToFramework" RENAME COLUMN "B" TO "A";
ALTER TABLE "_ControlToFramework" RENAME COLUMN "tmp_framework" TO "B";
ALTER TABLE "_ControlToFramework" ADD CONSTRAINT "_ControlToFramework_AB_pkey" PRIMARY KEY ("A", "B");
CREATE INDEX "_ControlToFramework_B_index" ON "_ControlToFramework"("B");
ALTER TABLE "_ControlToFramework" ADD CONSTRAINT "_ControlToFramework_A_fkey" FOREIGN KEY ("A") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ControlToFramework" ADD CONSTRAINT "_ControlToFramework_B_fkey" FOREIGN KEY ("B") REFERENCES "Framework"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- _RegulatoryOverlayToRequirement -> _ControlToRegulatoryOverlay
-- Old: A = RegulatoryOverlay id, B = Requirement id.
-- New: A = Control id,           B = RegulatoryOverlay id.
ALTER TABLE "_RegulatoryOverlayToRequirement" RENAME TO "_ControlToRegulatoryOverlay";
ALTER TABLE "_ControlToRegulatoryOverlay" DROP CONSTRAINT "_RegulatoryOverlayToRequirement_A_fkey";
ALTER TABLE "_ControlToRegulatoryOverlay" DROP CONSTRAINT "_RegulatoryOverlayToRequirement_B_fkey";
ALTER TABLE "_ControlToRegulatoryOverlay" DROP CONSTRAINT "_RegulatoryOverlayToRequirement_AB_pkey";
DROP INDEX "_RegulatoryOverlayToRequirement_B_index";
ALTER TABLE "_ControlToRegulatoryOverlay" RENAME COLUMN "A" TO "tmp_overlay";
ALTER TABLE "_ControlToRegulatoryOverlay" RENAME COLUMN "B" TO "A";
ALTER TABLE "_ControlToRegulatoryOverlay" RENAME COLUMN "tmp_overlay" TO "B";
ALTER TABLE "_ControlToRegulatoryOverlay" ADD CONSTRAINT "_ControlToRegulatoryOverlay_AB_pkey" PRIMARY KEY ("A", "B");
CREATE INDEX "_ControlToRegulatoryOverlay_B_index" ON "_ControlToRegulatoryOverlay"("B");
ALTER TABLE "_ControlToRegulatoryOverlay" ADD CONSTRAINT "_ControlToRegulatoryOverlay_A_fkey" FOREIGN KEY ("A") REFERENCES "Control"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ControlToRegulatoryOverlay" ADD CONSTRAINT "_ControlToRegulatoryOverlay_B_fkey" FOREIGN KEY ("B") REFERENCES "RegulatoryOverlay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
