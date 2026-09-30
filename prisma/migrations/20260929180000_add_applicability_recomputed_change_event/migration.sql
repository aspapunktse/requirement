-- AlterEnum
-- System-actor event for "the requirement database changed under this System and its
-- applicable Controls moved" (PRD 0001 F-AP.3), distinct from CLASSIFICATION_CHANGED
-- ("the owner changed the System's own classification").
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'APPLICABILITY_RECOMPUTED';
