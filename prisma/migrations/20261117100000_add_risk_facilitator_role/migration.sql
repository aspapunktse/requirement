-- AlterEnum
-- The Risk Facilitator role (#362). No data change: the seeded user comes from prisma/seed.ts,
-- because a new enum value can't be used in the migration that adds it.
ALTER TYPE "UserRole" ADD VALUE 'RISK_FACILITATOR';
