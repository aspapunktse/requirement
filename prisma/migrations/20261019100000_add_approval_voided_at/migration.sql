-- #199: a decision on a Review Step that disappears from its Review Round is voided, not deleted,
-- so a step that comes back during the same round comes back Open. Nullable: existing Approvals
-- are all live (voidedAt NULL). No data is changed or dropped; a no-op on an empty database.
ALTER TABLE "Approval" ADD COLUMN "voidedAt" TIMESTAMP(3);
