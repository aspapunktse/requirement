import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAssignedScope, scopedSystemsWhere } from "@/lib/business-risk-owner";
import { isReadOnlySystemRole } from "@/lib/system-permissions";
import { reviewGroupScopeWhere } from "@/lib/review-group-visibility";

const FULL_VISIBILITY_ROLES: UserRole[] = ["ADMIN", "RISK_OWNER", "REVIEWER", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"];

/**
 * False for a role that may only read Systems (`READ_ONLY_SYSTEM_ROLES` in
 * `src/lib/system-permissions.ts`: COMPLIANCE_MANAGER #71, INTERNAL_AUDITOR
 * #147). This is the coarse "may this role write Systems at all" check, used
 * as a belt-and-braces guard on replying to a Query; the per-action rules for
 * editing Assessments and submitting live in `system-permissions.ts` (#78).
 */
export function canWriteSystems(user: { role: UserRole }) {
  return !isReadOnlySystemRole(user);
}

/**
 * The Prisma `where` clause for Systems a given user is allowed to see:
 * ADMIN/RISK_OWNER/REVIEWER/COMPLIANCE_MANAGER/INTERNAL_AUDITOR see every
 * System in every status (the last two read-only, see `canWriteSystems`); a
 * BUSINESS_RISK_OWNER additionally sees every System within their assigned
 * Business Unit(s)/Framework(s), any status — they already see these
 * Systems' Risks/compliance data via the Business Risk Owner dashboard, so
 * drilling into a System's own page from there (e.g. the System Portfolio,
 * see #62) shouldn't 404; everyone else sees Systems they own (any status)
 * plus every ONBOARDED System. A member of a Review Group additionally sees every
 * System, in any status, that has one of their groups' Frameworks in its declared
 * Framework Scope (`reviewGroupScopeWhere`, #201).
 */
export async function visibleSystemsWhere(
  user: { id: string; role: UserRole },
  // Pass a transaction client to read in the caller's snapshot.
  db: Pick<Prisma.TransactionClient, "reviewGroup" | "user"> = prisma,
): Promise<Prisma.SystemWhereInput> {
  if (FULL_VISIBILITY_ROLES.includes(user.role)) {
    return {};
  }
  const ownedOrOnboarded: Prisma.SystemWhereInput[] = [{ ownerId: user.id }, { status: "ONBOARDED" }];
  const throughReviewGroup = await reviewGroupScopeWhere(user.id, db);
  if (throughReviewGroup) ownedOrOnboarded.push(throughReviewGroup);
  if (user.role === "BUSINESS_RISK_OWNER") {
    const scope = await getAssignedScope(user.id, db);
    ownedOrOnboarded.push(scopedSystemsWhere(scope));
  }
  return { OR: ownedOrOnboarded };
}

const SYSTEM_SUMMARY_INCLUDE = {
  deploymentFacets: true,
  // Declared Framework Scope rows, ids only: applicability needs them (ADR 0007), and a
  // Draft Framework's name mustn't leak to users who can't see Drafts.
  frameworkScopes: { select: { id: true } },
  owner: true,
} satisfies Prisma.SystemInclude;

/** Every System the given user is allowed to see, newest first. */
export async function getVisibleSystems(user: { id: string; role: UserRole }) {
  const where = await visibleSystemsWhere(user);
  return prisma.system.findMany({
    where,
    include: SYSTEM_SUMMARY_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/** One System by id, or null if it doesn't exist or the user can't see it. */
export async function getVisibleSystem(user: { id: string; role: UserRole }, id: string) {
  const where = await visibleSystemsWhere(user);
  return prisma.system.findFirst({
    where: { id, ...where },
    include: SYSTEM_SUMMARY_INCLUDE,
  });
}
