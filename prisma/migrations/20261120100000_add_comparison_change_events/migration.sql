-- AlterEnum
-- The Change Events of a Candidate added to or removed from a Comparison (#372). No data change, and the values are not
-- used in this migration (a new enum value can't be); the next migration only creates the Comparison tables.
ALTER TYPE "ChangeEventAction" ADD VALUE 'COMPARISON_CANDIDATE_ADDED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'COMPARISON_CANDIDATE_REMOVED';
