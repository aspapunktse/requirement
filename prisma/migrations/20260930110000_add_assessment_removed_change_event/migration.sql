-- AlterEnum
-- Audit event for "the owner or an Admin removed a stale Control Assessment" (#109). Kept apart
-- from ASSESSMENT_STATUS_CHANGED so the trail tells a removal (the row is gone; its last status,
-- evidence and notes live only in this event's detail) from a status change.
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'ASSESSMENT_REMOVED';
