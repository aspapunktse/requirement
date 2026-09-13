import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Only these roles may change a Risk's status, regardless of who logged it. */
export const ROLES_ALLOWED_TO_MANAGE_RISK_STATUS: UserRole[] = ["ADMIN", "RISK_OWNER"];

/**
 * Who may log an ad-hoc Risk on a System: ADMIN/RISK_OWNER on any System, or
 * a SYSTEM_OWNER on a System they own. A SYSTEM_OWNER of a *different*
 * System (or any other role) cannot.
 */
export function canLogRisk(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)) return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

const RISK_INCLUDE = {
  owner: true,
  requirementAssessment: { include: { requirement: true } },
} as const;

/** Every Risk logged against a System, newest first, with its origin (if auto-created). */
export function getSystemRisks(systemId: string) {
  return prisma.risk.findMany({
    where: { systemId },
    include: RISK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export { RISK_INCLUDE };
