import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { getAssignedScope, scopedSystemsWhere } from "@/lib/business-risk-owner";
import { getActionableQueryCountsBySystem } from "@/lib/assessment-queries";
import { getComplianceForSystems } from "@/lib/compliance";
import { frameworkLabel } from "@/lib/framework-label";
import { canCreateSystem } from "@/lib/system-permissions";
import { roleLabel } from "@/app/home/role-label";
import { readSystemsThresholds, type SystemsThresholds } from "@/lib/app-settings";
import { fulfilment, roleViewNeedsFulfilment, roleViewOf } from "./systems-logic";
import { loadSystemsTrends } from "./systems-trends";
import type { SystemRow, SystemsView } from "./systems-types";

/**
 * Everything the Systems list shows for the acting user (design proposal A, issue #232). Visibility is
 * the existing rule (`visibleSystemsWhere`); nothing here widens it. The list and every figure beside it
 * are read in one RepeatableRead transaction, every query on `tx`, so the counts, the rows and the trend
 * lines agree even while Systems change.
 */

const DAY_MS = 86_400_000;

type User = { id: string; role: UserRole };

/**
 * The rows the acting user sees, with their flags for the saved views. Runs on the caller's transaction.
 * `fulfilment: false` skips the base-Framework derivation, the heaviest read, for a caller that only
 * counts the saved views and whose role view does not need it (the daily snapshot job).
 */
export async function readSystemRows(
  tx: Prisma.TransactionClient,
  user: User,
  now: Date,
  options: { fulfilment?: boolean } = {},
): Promise<{ rows: SystemRow[]; where: Prisma.SystemWhereInput; baseFramework: string | null; thresholds: SystemsThresholds }> {
  // The Admin-set thresholds, read in the same snapshot as the Systems they are applied to.
  const thresholds = await readSystemsThresholds(tx);
  const where = await visibleSystemsWhere(user, tx);
  const systems = await tx.system.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      vendor: true,
      isProvider: true,
      status: true,
      ownerId: true,
      owner: { select: { name: true } },
      deploymentFacets: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      businessUnits: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      confidentialityImpactLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      updatedAt: true,
      _count: { select: { risks: { where: { status: "OPEN" } } } },
    },
  });
  const ids = systems.map((system) => system.id);

  const queryCounts = await getActionableQueryCountsBySystem(user, ids, tx);
  const withFulfilment = options.fulfilment ?? true;
  const compliance = withFulfilment ? await getComplianceForSystems(where, {}, tx) : null;
  const fulfilmentBySystem = new Map((compliance?.bySystem ?? []).map((row) => [row.systemId, row]));
  // A Business Risk Owner's own view is their assigned Business Units and Frameworks.
  const inScope =
    user.role === "BUSINESS_RISK_OWNER"
      ? new Set(
          (
            await tx.system.findMany({
              where: { AND: [where, scopedSystemsWhere(await getAssignedScope(user.id, tx))] },
              select: { id: true },
            })
          ).map((system) => system.id),
        )
      : new Set<string>();

  const rows = systems.map((system): SystemRow => {
    const measured = fulfilmentBySystem.get(system.id);
    const row: SystemRow = {
      id: system.id,
      name: system.name,
      vendor: system.vendor,
      isProvider: system.isProvider,
      status: system.status,
      ownerId: system.ownerId,
      ownerName: system.owner.name,
      facets: system.deploymentFacets,
      businessUnits: system.businessUnits,
      confidentiality: system.confidentialityImpactLevel,
      integrity: system.integrityImpactLevel,
      availability: system.availabilityImpactLevel,
      openQuestions: queryCounts.get(system.id) ?? 0,
      met: measured && measured.applicable > 0 ? measured.met : null,
      applicable: measured && measured.applicable > 0 ? measured.applicable : null,
      updatedAt: system.updatedAt.toISOString(),
      inRoleView: false,
      needsAttention: false,
    };
    row.needsAttention = needsAttention(row, now, thresholds.staleDraftDays);
    row.inRoleView = inRoleView(row, user, { openRisks: system._count.risks, inScope: inScope.has(system.id) }, thresholds.underFulfilledPercent);
    return row;
  });
  return { rows, where, baseFramework: compliance?.framework ? frameworkLabel(compliance.framework) : null, thresholds };
}

/**
 * Needs attention (product-owner decision 4a on #232): it has open Assessment Queries the user can act on,
 * or it is Rejected, or it is a Draft that has not changed for more than `staleDraftDays` days (an Admin setting).
 */
export function needsAttention(row: Pick<SystemRow, "openQuestions" | "status" | "updatedAt">, now: Date, staleDraftDays: number): boolean {
  if (row.openQuestions > 0 || row.status === "REJECTED") return true;
  return row.status === "DRAFT" && now.getTime() - Date.parse(row.updatedAt) > staleDraftDays * DAY_MS;
}

/**
 * Is the System in the acting role's own view (decision 3a on #232)? System Owner: owned by the user.
 * Reviewer: In Review. Risk Owner: has an open Risk. Business Risk Owner: in their assigned scope. Every
 * other role: not a Draft and with base-Framework fulfilment under `underFulfilledPercent`% (an Admin setting); a System
 * with nothing applicable to measure is not counted.
 */
export function inRoleView(
  row: Pick<SystemRow, "ownerId" | "status" | "met" | "applicable">,
  user: User,
  facts: { openRisks: number; inScope: boolean },
  underFulfilledPercent: number,
): boolean {
  switch (user.role) {
    case "SYSTEM_OWNER":
      return row.ownerId === user.id;
    case "REVIEWER":
      return row.status === "IN_REVIEW";
    case "RISK_OWNER":
      return facts.openRisks > 0;
    case "BUSINESS_RISK_OWNER":
      return facts.inScope;
    default: {
      const share = fulfilment(row);
      return row.status !== "DRAFT" && share !== null && share < underFulfilledPercent / 100;
    }
  }
}

/** The rows for a caller that only needs to count the saved views (the daily snapshot job). */
export async function loadSystemRowsForCounts(user: User, now: Date): Promise<SystemRow[]> {
  return prisma.$transaction(async (tx) => (await readSystemRows(tx, user, now, { fulfilment: roleViewNeedsFulfilment(user.role) })).rows, {
    isolationLevel: "RepeatableRead",
  });
}

/** What the Systems list page renders for `user`, all read in one snapshot. */
export async function loadSystemsView(user: User & { name: string }, now = new Date()): Promise<SystemsView> {
  const { rows, baseFramework, trends, thresholds } = await prisma.$transaction(
    async (tx) => {
      const read = await readSystemRows(tx, user, now);
      return { rows: read.rows, baseFramework: read.baseFramework, thresholds: read.thresholds, trends: await loadSystemsTrends(tx, user, read.rows, read.where, now) };
    },
    { isolationLevel: "RepeatableRead" },
  );
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    roleLabel: roleLabel(user.role),
    canCreate: canCreateSystem(user),
    now: now.toISOString(),
    rows,
    roleView: roleViewOf(user.role, thresholds.underFulfilledPercent),
    trends,
    baseFramework,
  };
}
