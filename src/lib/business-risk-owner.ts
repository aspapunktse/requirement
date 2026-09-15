import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AssignedScope = { businessUnitIds: string[]; frameworkIds: string[] };

/** The Business Unit(s) and/or Framework(s) a BUSINESS_RISK_OWNER is assigned to. */
export async function getAssignedScope(userId: string): Promise<AssignedScope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { businessUnitScopes: true, frameworkScopes: true },
  });
  return {
    businessUnitIds: user?.businessUnitScopes.map((b) => b.id) ?? [],
    frameworkIds: user?.frameworkScopes.map((f) => f.id) ?? [],
  };
}

/**
 * The Prisma `where` clause for Systems visible to a BUSINESS_RISK_OWNER
 * with this assigned scope: any System whose declared Business Unit(s) or
 * Framework Scope(s) intersect the assignment — a union across the two
 * axes, since owning either one grants visibility to a matching System (a
 * Business Risk Owner assigned only to Frameworks still sees every System
 * in those Frameworks' scope, regardless of Business Unit). An unassigned
 * Business Risk Owner (no Business Unit or Framework yet) sees nothing —
 * there's no "default to everything" fallback, unlike RISK_OWNER's full
 * visibility. See #55.
 */
export function scopedSystemsWhere(scope: AssignedScope): Prisma.SystemWhereInput {
  const clauses: Prisma.SystemWhereInput[] = [];
  if (scope.businessUnitIds.length > 0) {
    clauses.push({ businessUnits: { some: { id: { in: scope.businessUnitIds } } } });
  }
  if (scope.frameworkIds.length > 0) {
    clauses.push({ frameworkScopes: { some: { id: { in: scope.frameworkIds } } } });
  }
  if (clauses.length === 0) return { id: { in: [] } };
  return { OR: clauses };
}

export type ScopeFilter = { businessUnitId?: string; frameworkId?: string };

/**
 * Resolves a request's optional businessUnitId/frameworkId query filters
 * into the final Systems `where` clause for one of the Business Risk
 * Owner views (Risks, Compliance), for a given acting user:
 *
 * - ADMIN: unrestricted — any filter value is accepted, no filter means
 *   every System.
 * - BUSINESS_RISK_OWNER: bounded to their assigned scope
 *   (scopedSystemsWhere); an explicit filter must name a Business
 *   Unit/Framework they're actually assigned to, or the whole request is
 *   rejected rather than silently widened or narrowed to nothing.
 *
 * Any other role isn't a valid caller of this function — routes must gate
 * on role before calling it.
 */
export async function resolveScopeWhere(
  user: { id: string; role: string },
  filter: ScopeFilter,
): Promise<{ ok: true; where: Prisma.SystemWhereInput } | { ok: false; error: string }> {
  const explicitClauses: Prisma.SystemWhereInput[] = [];
  if (filter.businessUnitId) {
    explicitClauses.push({ businessUnits: { some: { id: filter.businessUnitId } } });
  }
  if (filter.frameworkId) {
    explicitClauses.push({ frameworkScopes: { some: { id: filter.frameworkId } } });
  }

  if (user.role === "ADMIN") {
    return { ok: true, where: explicitClauses.length > 0 ? { AND: explicitClauses } : {} };
  }

  const assigned = await getAssignedScope(user.id);
  if (filter.businessUnitId && !assigned.businessUnitIds.includes(filter.businessUnitId)) {
    return { ok: false, error: "Not assigned to that Business Unit" };
  }
  if (filter.frameworkId && !assigned.frameworkIds.includes(filter.frameworkId)) {
    return { ok: false, error: "Not assigned to that Framework" };
  }

  const base = scopedSystemsWhere(assigned);
  return { ok: true, where: explicitClauses.length > 0 ? { AND: [base, ...explicitClauses] } : base };
}
