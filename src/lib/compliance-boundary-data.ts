import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { memberState, type BoundaryDetail, type BoundaryListRow } from "@/lib/compliance-boundary";

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
