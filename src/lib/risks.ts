import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risk-roles";

// The role lists live in `risk-roles.ts`, which is free of server code so the app header can use them too.
export { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS, canReadOrganizationRisks } from "@/lib/risk-roles";

/**
 * Who may log an ad-hoc Risk on a System: ADMIN/RISK_OWNER on any System, or
 * the System's owner (`ownerId`, whatever their role). Anyone else — including
 * a SYSTEM_OWNER of a *different* System — cannot.
 */
export function canLogRisk(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)) return true;
  return isSystemOwnerOrAdmin(user, system);
}

/** Same people as changing any Risk's status: a Risk Owner or an Admin. The Internal Auditor changes nothing. */
export function canManageOrganizationRisks(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role);
}

/** The Risks that belong to a System. Every per-System and Business Risk Owner view adds this, so a System-less Risk can never leak into one. */
export const SYSTEM_RISK_WHERE = { systemId: { not: null } } as const;

/** What an Organization Risk's "System" reads as wherever a System's name would be. */
export const ORGANIZATION_RISK_LABEL = "Organization";

/** Where a Risk Owner follows an Organization Risk. */
export const ORGANIZATION_RISKS_HREF = "/risks/organization";

/** Where a Risk's link goes: its System, or the Organization Risks page for one with none. */
export function riskHref(risk: { system: { id: string } | null }) {
  return risk.system ? `/systems/${risk.system.id}` : ORGANIZATION_RISKS_HREF;
}

const RISK_INCLUDE = {
  owner: true,
  controlAssessment: { include: { control: true } },
  // The Check-up that opened it (#157), for the link back to the finding.
  checkUp: { select: { id: true, control: { select: { code: true } }, internalAudit: { select: { title: true } } } },
} as const;

/** Every Risk with no System (opened by an Organization-level Nonconformity), newest first. */
export function getOrganizationRisks() {
  return prisma.risk.findMany({
    where: { systemId: null },
    include: RISK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/** Every Risk logged against a System, newest first, with its origin (if auto-created). */
export function getSystemRisks(systemId: string) {
  return prisma.risk.findMany({
    where: { systemId },
    include: RISK_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

export { RISK_INCLUDE };
