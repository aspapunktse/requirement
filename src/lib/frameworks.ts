import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { logChangeEvent } from "@/lib/change-events";
import { frameworkLabel } from "@/lib/framework-label";

/** Only Compliance Managers and Admins can see (or touch) Draft Frameworks. */
export function canSeeDraftFrameworks(user: { role: UserRole }): boolean {
  return ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role);
}

/**
 * Prisma `where` for the Frameworks a user may see: everything for the
 * curator roles, Published only for everyone else (a Draft Framework is
 * invisible outside the requirement-database roles, see #73).
 */
export function visibleFrameworksWhere(user: { role: UserRole }): Prisma.FrameworkWhereInput {
  return canSeeDraftFrameworks(user) ? {} : { status: "PUBLISHED" };
}

/**
 * Prisma `include` for a Control plus everything the admin UI and API show
 * about it. Its Control Mappings feed both the "Satisfies" line and the
 * reverse view (every Requirement mapped to the Control); mappings into Draft
 * Frameworks are left out for users who can't see Drafts.
 */
export function controlIncludeFor(user: { role: UserRole }) {
  return {
    deploymentFacets: true,
    regulatoryOverlays: true,
    capabilities: true,
    // Set for a Supplementary Control (its origin Framework); `status` is only
    // here so redactDraftOrigin can hide a Draft Framework from users who can't see it.
    originFramework: { select: { id: true, name: true, version: true, status: true } },
    mappings: {
      where: canSeeDraftFrameworks(user) ? {} : { requirement: { framework: { status: "PUBLISHED" as const } } },
      select: {
        id: true,
        coverage: true,
        requirement: {
          select: {
            id: true,
            code: true,
            title: true,
            framework: { select: { id: true, name: true, version: true, status: true } },
          },
        },
      },
    },
  } satisfies Prisma.ControlInclude;
}

/**
 * A Supplementary Control's origin Framework is left out (null) for users who
 * can't see Drafts when that Framework is still a Draft, so a Draft
 * Framework's name doesn't leak through the Control Library.
 */
export function redactDraftOrigin<T extends { originFramework: { status: "DRAFT" | "PUBLISHED" } | null }>(
  user: { role: UserRole },
  control: T,
): T {
  if (canSeeDraftFrameworks(user) || control.originFramework?.status !== "DRAFT") return control;
  return { ...control, originFramework: null };
}

/** Prisma `include` for a Requirement with its Control Mappings (each with its Control). */
export const requirementInclude = {
  mappings: {
    orderBy: { control: { code: "asc" } },
    select: {
      id: true,
      coverage: true,
      rationale: true,
      control: { select: { id: true, code: true, title: true } },
    },
  },
} satisfies Prisma.RequirementInclude;

export type BaseFrameworkViolation = "BASE_EXISTS" | "LAST_BASE";

/**
 * There is exactly one base Framework (ISO/IEC 27001:2022). Enforced here
 * rather than with a partial unique index, which Prisma can't represent
 * without showing up as schema drift.
 *
 * `next` is what the operation would leave `isBase` as for `frameworkId`
 * (undefined for a create, which has no id yet). Returns why it's not
 * allowed, or null. Making a second Framework the base, or unsetting the only
 * base, are both refused; moving the base is not supported.
 */
export async function checkBaseFrameworkInvariant(
  frameworkId: string | undefined,
  next: { wasBase: boolean; isBase: boolean },
): Promise<BaseFrameworkViolation | null> {
  if (next.isBase && !next.wasBase) {
    const otherBase = await prisma.framework.count({
      where: { isBase: true, ...(frameworkId ? { id: { not: frameworkId } } : {}) },
    });
    if (otherBase > 0) return "BASE_EXISTS";
  }
  if (next.wasBase && !next.isBase) return "LAST_BASE";
  return null;
}

export const BASE_FRAMEWORK_ERRORS: Record<BaseFrameworkViolation, string> = {
  BASE_EXISTS: "There is already a base Framework; exactly one Framework can be the base",
  LAST_BASE: "The base Framework can't be unset or retired; exactly one Framework must be the base",
};

/**
 * The single hook point for "a Framework was just published". Publishing
 * (POST /api/frameworks/[id]/publish) records the FRAMEWORK_PUBLISHED Change
 * Event and then calls this.
 *
 * Deliberately still a no-op (PRD 0001 F-FW.5): Framework Scope drives
 * applicability since #85 (ADR 0007), but recomputing every System that already
 * has the Framework in scope (its Draft scope rows become effective on publish)
 * is #87's job, and this is where it goes. Until then such a System's
 * Assessments catch up on its next recompute trigger.
 */
export async function onFrameworkPublished(frameworkId: string): Promise<void> {
  void frameworkId;
}

export type MappingChange = "added" | "changed" | "removed";

/**
 * Records a System-less CONTROL_MAPPING_CHANGED Change Event naming the
 * Requirement (Framework label + code), the Control code, and old -> new
 * Coverage ("none" where there was no mapping before / is none after).
 * `note` appends why, e.g. when deleting a Requirement takes its mappings with it.
 */
export function logMappingChange(
  args: {
    change: MappingChange;
    framework: { name: string; version: string };
    requirementCode: string;
    controlCode: string;
    from: "FULL" | "PARTIAL" | null;
    to: "FULL" | "PARTIAL" | null;
    note?: string;
  },
  actorId: string,
  client?: Parameters<typeof logChangeEvent>[4],
) {
  const { change, framework, requirementCode, controlCode, from, to, note } = args;
  const detail =
    `Control Mapping ${change}: Requirement ${frameworkLabel(framework)} ${requirementCode} ` +
    `↔ Control ${controlCode} (${from ?? "none"} → ${to ?? "none"})` +
    (note ? `; ${note}` : "");
  return logChangeEvent(null, "CONTROL_MAPPING_CHANGED", detail, actorId, client);
}
