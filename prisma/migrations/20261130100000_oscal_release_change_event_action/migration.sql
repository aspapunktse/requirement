-- #453: making an OSCAL Release writes a Change Event of its own. Purely additive: one enum value, no change to any row or
-- column. The value is only used by application code, never in this file (nor in the next migration), because Postgres
-- can't use an enum value in the migration that adds it.
ALTER TYPE "ChangeEventAction" ADD VALUE IF NOT EXISTS 'OSCAL_RELEASE_MADE';
