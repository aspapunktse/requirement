import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Only these roles may record an Approval decision on a System. */
export const ROLES_ALLOWED_TO_APPROVE: UserRole[] = ["ADMIN", "REVIEWER"];

/** A System's full Approval history, oldest to newest — survives resubmission. */
export function getApprovalHistory(systemId: string) {
  return prisma.approval.findMany({
    where: { systemId },
    include: { approver: true },
    orderBy: { decidedAt: "asc" },
  });
}
