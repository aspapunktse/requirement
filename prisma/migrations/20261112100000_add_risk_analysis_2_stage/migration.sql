-- The stage between the second round and OG3 / OAG review (#329, PRD 0002 F-ST.2, F-RA.4): the second round is submitted and the System waits
-- for a Risk Analysis. One enum value, placed in flow order. No SQL here uses it, no data changes, and it cannot raise.

-- AlterEnum
ALTER TYPE "EvaluationStage" ADD VALUE 'RISK_ANALYSIS_2' AFTER 'SECOND_ROUND';
