import type { UserRole } from "@prisma/client";

/** Only these roles may record an Approval decision on a System. */
export const ROLES_ALLOWED_TO_APPROVE: UserRole[] = ["ADMIN", "REVIEWER"];

// A System's Approval history, grouped by Review Round, is `loadReviewRounds` in `review-steps.ts`.
