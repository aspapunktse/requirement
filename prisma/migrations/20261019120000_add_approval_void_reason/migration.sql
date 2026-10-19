-- #200: why an Approval was voided, when it was by an edit. A step that approved and then had a
-- Control in its remit edited is reopened by voiding its Approvals (voidedAt, #199) with this text,
-- e.g. 'A.5.1 changed after approval'; a voided Approval with no reason is a dropped step's (#199).
-- Nullable: existing Approvals keep NULL. No data is changed or dropped; a no-op on an empty database.
ALTER TABLE "Approval" ADD COLUMN "voidReason" TEXT;
