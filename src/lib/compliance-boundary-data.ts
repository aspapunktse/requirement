import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { countedMembersWhere, memberState, type BoundaryDetail, type BoundaryFrameworkCompliance, type BoundaryListRow, type JoinPreview, type PreparedCandidate } from "@/lib/compliance-boundary";
import { previewScopeAddition } from "@/lib/framework-scope";
import { remitPairsAdded } from "@/lib/change-review";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { inheritanceSourcesFor, resolveEffectiveStatus } from "@/lib/effective-status";
import { getComplianceForSystems } from "@/lib/compliance";

type Db = Prisma.TransactionClient | typeof prisma;

const FRAMEWORK_ORDER = [{ framework: { name: "asc" as const } }, { framework: { version: "asc" as const } }];

const LIST_SELECT = {
  id: true,
  name: true,
  description: true,
  businessUnit: { select: { id: true, name: true } },
  boundaryOwner: { select: { id: true, name: true } },
  frameworks: { select: { framework: { select: { id: true, name: true, version: true } } }, orderBy: FRAMEWORK_ORDER },
  _count: { select: { systems: true } },
} satisfies Prisma.ComplianceBoundarySelect;

const DETAIL_SELECT = {
  id: true,
  name: true,
  description: true,
  businessUnit: { select: { id: true, name: true } },
  boundaryOwner: { select: { id: true, name: true } },
  frameworks: { select: { framework: { select: { id: true, name: true, version: true } } }, orderBy: FRAMEWORK_ORDER },
  systems: {
    select: {
      addedAt: true,
      addedBy: { select: { name: true } },
      system: { select: { id: true, name: true, status: true, evaluationClosedAt: true } },
    },
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ComplianceBoundarySelect;

/** Every Boundary by name, with its Frameworks and member count. Pass the transaction client from inside a transaction. */
export async function listBoundaries(db: Db = prisma): Promise<BoundaryListRow[]> {
  const rows = await db.complianceBoundary.findMany({ select: LIST_SELECT });
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      businessUnit: row.businessUnit,
      boundaryOwner: row.boundaryOwner,
      frameworks: row.frameworks.map((entry) => entry.framework),
      systemCount: row._count.systems,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/** One Boundary with its members (by name), or null. Members: operating first, then not yet operating, then closed; by name within each. */
export async function getBoundary(id: string, db: Db = prisma): Promise<BoundaryDetail | null> {
  const row = await db.complianceBoundary.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!row) return null;
  const rank = { OPERATING: 0, NOT_YET_OPERATING: 1, CLOSED: 2 } as const;
  const members = row.systems
    .map((entry) => ({
      systemId: entry.system.id,
      name: entry.system.name,
      state: memberState(entry.system),
      status: entry.system.status,
      addedAt: entry.addedAt.toISOString(),
      addedByName: entry.addedBy?.name ?? null,
    }))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    businessUnit: row.businessUnit,
    boundaryOwner: row.boundaryOwner,
    frameworks: row.frameworks.map((entry) => entry.framework),
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The pooled Compliance Percentage of each of a Boundary's Frameworks over its counted Systems (#422): total Met / total
 * applicable, strict Frameworks and Organizational Requirements as for a Business Unit scope (`getComplianceForSystems`). Not yet
 * operating and closed members are left out. Pass the caller's transaction so all Frameworks share its snapshot; with none, one
 * RepeatableRead transaction is opened here. Per Framework: the Systems read plus the derivation's reads, so the count is bounded
 * by the number of Frameworks.
 */
export async function getBoundaryCompliance(boundaryId: string, frameworkIds: string[], db?: Prisma.TransactionClient): Promise<BoundaryFrameworkCompliance[]> {
  const run = async (tx: Prisma.TransactionClient) => {
    const result: BoundaryFrameworkCompliance[] = [];
    for (const frameworkId of frameworkIds) {
      const scope = await getComplianceForSystems(countedMembersWhere(boundaryId), { frameworkId }, tx);
      result.push({ frameworkId, met: scope.met, applicable: scope.applicable, percentage: scope.percentage });
    }
    return result;
  };
  return db ? run(db) : prisma.$transaction(run, READ_SNAPSHOT);
}

/** The Boundary whose name matches ignoring case (other than `exceptId`), or null. */
export function findBoundaryNamed(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
  return tx.complianceBoundary.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  });
}

/** What the create and edit forms offer: Published Frameworks, Business Units and Users, by name. */
export async function loadBoundaryChoices(db: Db = prisma) {
  const [frameworks, businessUnits, users] = await Promise.all([
    db.framework.findMany({ where: { status: "PUBLISHED" }, select: { id: true, name: true, version: true }, orderBy: [{ name: "asc" }, { version: "asc" }] }),
    db.businessUnit.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { frameworks, businessUnits, users };
}
export type BoundaryChoices = Awaited<ReturnType<typeof loadBoundaryChoices>>;

/** The open Systems (not Rejected or Not selected) not yet in the Boundary: what the add picker offers. Names and states only. */
export async function loadMemberCandidates(boundaryId: string, db: Db = prisma) {
  const systems = await db.system.findMany({
    where: { evaluationClosedAt: null, boundaryMemberships: { none: { boundaryId } } },
    select: { id: true, name: true, status: true, evaluationClosedAt: true },
    orderBy: { name: "asc" },
  });
  return systems.map((system) => ({ id: system.id, name: system.name, state: memberState(system) }));
}

/**
 * The candidates for a Boundary (#423): open Systems not in it that are prepared for (have declared) one or more of its non-base
 * Frameworks, each with which ones. The base Framework is in every System's scope, so it never makes a System a candidate; closed
 * Systems are left out. By name.
 */
export async function loadPreparedCandidates(boundaryId: string, db: Db = prisma): Promise<PreparedCandidate[]> {
  const held = await db.complianceBoundaryFramework.findMany({
    where: { boundaryId, framework: { isBase: false } },
    select: { framework: { select: { id: true, name: true, version: true } } },
  });
  if (held.length === 0) return [];
  const heldIds = held.map((entry) => entry.framework.id);
  const systems = await db.system.findMany({
    where: { evaluationClosedAt: null, boundaryMemberships: { none: { boundaryId } }, frameworkScopes: { some: { id: { in: heldIds } } } },
    select: { id: true, name: true, status: true, evaluationClosedAt: true, frameworkScopes: { where: { id: { in: heldIds } }, select: { id: true, name: true, version: true } } },
    orderBy: { name: "asc" },
  });
  return systems.map((system) => ({
    id: system.id,
    name: system.name,
    state: memberState(system),
    preparedFor: [...system.frameworkScopes].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.version.localeCompare(b.version)),
  }));
}

/**
 * What adding the System to the Boundary would do (#423), or null when either is missing. Read-only, and the Controls come from
 * `previewScopeAddition`, the applicability code `joinBoundaryIn` recomputes with, given the Boundary's Frameworks added. A Control
 * counts as Fulfilled by its effective status (`resolveEffectiveStatus`: the System's own Assessment if a person set it, else the
 * Organization's and the Providers' Full or Shared credit), so inheritance counts. Pass the caller's RepeatableRead transaction.
 */
export async function previewJoin(boundaryId: string, systemId: string, db: Prisma.TransactionClient): Promise<JoinPreview | null> {
  const boundary = await db.complianceBoundary.findUnique({ where: { id: boundaryId }, select: { frameworks: { select: { frameworkId: true } } } });
  const system = await db.system.findUnique({ where: { id: systemId }, select: { id: true, name: true, status: true, evaluationClosedAt: true } });
  if (!boundary || !system) return null;

  const { before, afterClassification, newlyApplicable } = await previewScopeAddition(db, systemId, boundary.frameworks.map((entry) => entry.frameworkId));
  const ids = newlyApplicable.map((control) => control.id);
  const [assessments, organizationStatuses, providerSources] = await Promise.all([
    ids.length === 0 ? [] : db.controlAssessment.findMany({ where: { systemId, controlId: { in: ids } }, select: { controlId: true, status: true, assessedById: true } }),
    loadOrganizationStatuses(newlyApplicable.filter((control) => control.applicability === "BOTH").map((control) => control.id), db),
    loadProviderSources([systemId], ids, db),
  ]);
  const own = new Map(assessments.map((assessment) => [assessment.controlId, toOwnAssessment(assessment)]));
  const newControls = newlyApplicable.map((control) => ({
    id: control.id,
    code: control.code,
    title: control.title,
    fulfilled:
      resolveEffectiveStatus(own.get(control.id) ?? null, inheritanceSourcesFor(control, organizationStatuses.get(control.id), providerSources.get(systemId)?.get(control.id))).status === "FULFILLED",
  }));
  const open = system.evaluationClosedAt === null;
  const onboarded = system.status === "ONBOARDED" && open;
  return {
    systemId: system.id,
    systemName: system.name,
    state: memberState(system),
    onboarded,
    startsChangeReview: onboarded && (await remitPairsAdded(db, before.classification, afterClassification)).length > 0,
    newControls,
  };
}

/** The Boundaries a System is in, for its page: name and Frameworks. */
export async function listBoundariesOfSystem(systemId: string, db: Db = prisma) {
  const rows = await db.complianceBoundary.findMany({
    where: { systems: { some: { systemId } } },
    select: {
      id: true,
      name: true,
      boundaryOwner: { select: { name: true } },
      frameworks: { select: { framework: { select: { id: true, name: true, version: true } } }, orderBy: FRAMEWORK_ORDER },
    },
  });
  return rows
    .map((row) => ({ id: row.id, name: row.name, ownerName: row.boundaryOwner?.name ?? null, frameworks: row.frameworks.map((entry) => entry.framework) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}
export type SystemBoundaryRow = Awaited<ReturnType<typeof listBoundariesOfSystem>>[number];

/** Drafts are refused, unknown ids reported: the ids of `ids` that aren't Frameworks, and those that aren't Published. */
export async function checkFrameworks(tx: Prisma.TransactionClient, ids: string[]) {
  const found = await tx.framework.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  const known = new Map(found.map((framework) => [framework.id, framework.status]));
  return {
    missing: ids.filter((id) => !known.has(id)),
    unpublished: ids.filter((id) => known.has(id) && known.get(id) !== "PUBLISHED"),
  };
}
