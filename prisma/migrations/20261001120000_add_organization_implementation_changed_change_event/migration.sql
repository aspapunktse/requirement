-- AlterEnum
-- System-less audit event for "the status of an Organizational Control's Organization Control
-- Implementation changed" (#122). One event per change, written by the User who made it; an
-- Organizational Control now counts live on every System with the Framework in scope, so
-- nothing is written per System. Kept apart from ASSESSMENT_STATUS_CHANGED, which is per System.
-- No data change.
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'ORGANIZATION_IMPLEMENTATION_CHANGED';
