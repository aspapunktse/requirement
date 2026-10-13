import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/** Only these roles may change a Risk's status, regardless of who logged it. */
export const ROLES_ALLOWED_TO_MANAGE_RISK_STATUS: UserRole[] = ["ADMIN", "RISK_OWNER"];

/**
 * Who may log an ad-hoc Risk on a System: ADMIN/RISK_OWNER on any System, or
 * the System's owner (`ownerId`, whatever their role). Anyone else — including
 * a SYSTEM_OWNER of a *different* System — cannot.
 */
export function canLogRisk(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(user.role)) return true;
  return isSystemOwnerOrAdmin(user, system);
}

/**
 * Risks opened by an Organization-level Nonconformity have no System (#157, product-owner decision of
 * 2026-10-12): they are read and managed by the Risk Owner and the Admin, and read by the Internal
 * Auditor. Nobody else sees them, and the Business Risk Owner's scoped views never list them
 * (`SYSTEM_RISK_WHERE` below). The Compliance Manager's read-only role doesn't extend to them: the
 * decision named the three roles, and a fourth is an extension to ask for.
 */
export const ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS: UserRole[] = [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, "INTERNAL_AUDITOR"];

export function canReadOrganizationRisks(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS.includes(user.role);
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
