-- AlterEnum
-- Not selected (#376, ADR 0015): a second way to close a System, for a Candidate that lost a Comparison, and the Change Events of
-- closing it and of an Admin reopening it. No data change: no existing System becomes Not selected. The values are not used in
-- this migration (a new enum value can't be); no column is needed, since the System keeps its stage and Track.
ALTER TYPE "OnboardingStatus" ADD VALUE 'NOT_SELECTED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'SYSTEM_NOT_SELECTED';
ALTER TYPE "ChangeEventAction" ADD VALUE 'SYSTEM_REOPENED';
