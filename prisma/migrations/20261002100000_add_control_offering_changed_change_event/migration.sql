-- AlterEnum
-- Audit event for "a Provider's owner or an Admin added, changed or removed one of the Provider's
-- Control Offerings" (#123). System-scoped to the Provider, actor the User who made the change.
-- Marking or unmarking a System as a Provider reuses CLASSIFICATION_CHANGED. No data change.
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'CONTROL_OFFERING_CHANGED';
