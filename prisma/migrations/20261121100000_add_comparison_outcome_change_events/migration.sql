-- AlterEnum
-- The Change Events of a Comparison's outcome being recorded and of the Comparison being reopened (#375), one on every
-- Candidate. No data change, and the values are not used in this migration (a new enum value can't be); the next
-- migration only adds the outcome columns.
ALTER TYPE "ChangeEventAction" ADD VALUE 'COMPARISON_OUTCOME_RECORDED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'COMPARISON_REOPENED';
