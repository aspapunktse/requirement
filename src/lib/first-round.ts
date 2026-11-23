import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { frameworksInScopeOfSystem } from "@/lib/effective-framework-scope";

/**
 * First-round Controls (#319, PRD 0002 F-FO). A Framework's owner marks which of the Controls mapped to the
 * Framework are first round for it (`FrameworkFirstRoundControl`). A Control is first round on a System when the
 * owner of ANY Framework in the System's effective Framework Scope has marked it; everything else is second round.
 * Stored and shown only: nothing about Assessments, submission, applicability or compliance reads this yet.
 */

type Db = Pick<Prisma.TransactionClient, "frameworkFirstRoundControl" | "controlMapping" | "requirement" | "system" | "framework">;

/**
 * Removes the markings of `controlIds` for `frameworkId` that no longer have a Control Mapping to any Requirement of
 * that Framework. Call it on the caller's transaction client, after the mappings (or the Requirement) have been
 * deleted in the same transaction, so a removed mapping never leaves a marking behind. Returns how many it removed.
 */
export async function dropOrphanedFirstRoundMarkings(
  tx: Pick<Prisma.TransactionClient, "frameworkFirstRoundControl">,
  frameworkId: string,
  controlIds: string[],
) {
  if (controlIds.length === 0) return 0;
  const { count } = await tx.frameworkFirstRoundControl.deleteMany({
    where: { frameworkId, controlId: { in: controlIds }, control: { mappings: { none: { requirement: { frameworkId } } } } },
  });
  return count;
}

/**
 * The ids of the Frameworks in a System's effective Framework Scope that count for first round: the base Framework
 * (always in scope) plus the System's declared scope and the Frameworks of the Compliance Boundaries it is in (#419), only PUBLISHED ones, the same definition applicability uses
 * (APPLICABILITY_SCOPING). A declared row pointing at a Draft Framework is inert until it is published.
 */
export async function effectiveScopeFrameworkIds(systemId: string, db: Pick<Db, "framework"> = prisma) {
  const frameworks = await db.framework.findMany({
    where: { status: "PUBLISHED", OR: [{ isBase: true }, frameworksInScopeOfSystem(systemId)] },
    select: { id: true },
  });
  return frameworks.map((framework) => framework.id);
}

/**
 * The ids of the Controls that are first round on a System: marked by the owner of a Published Framework in its
 * effective scope, and still mapped to that Framework (a marking without a live mapping is ignored). Pass
 * `controlIds` to narrow the answer. Without `db` the reads (scope, markings, mappings, Requirements) run in one
 * RepeatableRead transaction so they agree even while a mapping is deleted; a caller's transaction client is used as is.
 */
export async function firstRoundControlIdsForSystem(systemId: string, options: { controlIds?: string[]; db?: Db } = {}) {
  if (options.db) return readFirstRoundControlIds(options.db, systemId, options.controlIds);
  return prisma.$transaction((tx) => readFirstRoundControlIds(tx, systemId, options.controlIds), { isolationLevel: "RepeatableRead" });
}

async function readFirstRoundControlIds(db: Db, systemId: string, controlIds: string[] | undefined) {
  const frameworkIds = await effectiveScopeFrameworkIds(systemId, db);
  const liveByFramework = await readLiveMarkingsByFramework(db, frameworkIds, controlIds);
  return unionOfFrameworks(frameworkIds, liveByFramework);
}

/**
 * The effective Framework Scope of many Systems in one query, by System id: the same definition as
 * `effectiveScopeFrameworkIds` (the base Framework plus the System's declared scope and its Boundaries' Frameworks, Published only), in a constant
 * number of queries however many Systems. Every id in `systemIds` has an entry, even if it matches no System.
 */
export async function effectiveScopeFrameworkIdsForSystems(systemIds: string[], db: Pick<Db, "framework"> = prisma) {
  const result = new Map<string, string[]>(systemIds.map((id) => [id, []]));
  if (systemIds.length === 0) return result;
  const frameworks = await db.framework.findMany({
    where: {
      status: "PUBLISHED",
      OR: [
        { isBase: true },
        { scopedSystems: { some: { id: { in: systemIds } } } },
        { boundaries: { some: { boundary: { systems: { some: { systemId: { in: systemIds } } } } } } },
      ],
    },
    select: {
      id: true,
      isBase: true,
      scopedSystems: { where: { id: { in: systemIds } }, select: { id: true } },
      boundaries: { select: { boundary: { select: { systems: { where: { systemId: { in: systemIds } }, select: { systemId: true } } } } } },
    },
  });
  for (const framework of frameworks) {
    for (const systemId of systemIds) {
      const viaBoundary = framework.boundaries.some(({ boundary }) => boundary.systems.some((member) => member.systemId === systemId));
      if (framework.isBase || framework.scopedSystems.some((system) => system.id === systemId) || viaBoundary) result.get(systemId)!.push(framework.id);
    }
  }
  return result;
}

/**
 * `firstRoundControlIdsForSystem` for many Systems in a constant number of queries (the same rule: it shares
 * `readLiveMarkingsByFramework`), by System id. `scopeBySystem` is the answer of `effectiveScopeFrameworkIdsForSystems`
 * when the caller already has it. Use a transaction client for a snapshot; the reads are sequential.
 */
export async function firstRoundControlIdsForSystems(
  systemIds: string[],
  options: { db?: Db; scopeBySystem?: Map<string, string[]> } = {},
) {
  const db = options.db ?? prisma;
  const scopeBySystem = options.scopeBySystem ?? (await effectiveScopeFrameworkIdsForSystems(systemIds, db));
  const allFrameworkIds = [...new Set([...scopeBySystem.values()].flat())];
  const liveByFramework = await readLiveMarkingsByFramework(db, allFrameworkIds, undefined);
  return new Map(systemIds.map((id) => [id, unionOfFrameworks(scopeBySystem.get(id) ?? [], liveByFramework)]));
}

function unionOfFrameworks(frameworkIds: string[], liveByFramework: Map<string, Set<string>>) {
  const result = new Set<string>();
  for (const frameworkId of frameworkIds) for (const controlId of liveByFramework.get(frameworkId) ?? []) result.add(controlId);
  return result;
}

/**
 * For each of `frameworkIds`, the Controls its owner marked first round that are still mapped to a Requirement of that
 * same Framework (a marking without a live mapping is ignored). Three reads, however many Frameworks or Controls.
 */
export async function readLiveMarkingsByFramework(db: Db, frameworkIds: string[], controlIds: string[] | undefined) {
  const live = new Map<string, Set<string>>();
  if (frameworkIds.length === 0) return live;
  const markings = await db.frameworkFirstRoundControl.findMany({
    where: { frameworkId: { in: frameworkIds }, ...(controlIds ? { controlId: { in: controlIds } } : {}) },
    select: { frameworkId: true, controlId: true },
  });
  if (markings.length === 0) return live;
  // A marking counts only while its Control is still mapped to a Requirement of the *same* Framework. Sequential
  // reads (one connection on a transaction client); the Requirements are read separately, not through a nested relation.
  const mappings = await db.controlMapping.findMany({
    where: { controlId: { in: [...new Set(markings.map((m) => m.controlId))] } },
    select: { controlId: true, requirementId: true },
  });
  const requirements = await db.requirement.findMany({
    where: { id: { in: [...new Set(mappings.map((m) => m.requirementId))] }, frameworkId: { in: frameworkIds } },
    select: { id: true, frameworkId: true },
  });
  const frameworkOfRequirement = new Map(requirements.map((r) => [r.id, r.frameworkId]));
  const mapped = new Set<string>();
  for (const mapping of mappings) {
    const frameworkId = frameworkOfRequirement.get(mapping.requirementId);
    if (frameworkId) mapped.add(`${frameworkId}:${mapping.controlId}`);
  }
  for (const marking of markings) {
    if (!mapped.has(`${marking.frameworkId}:${marking.controlId}`)) continue;
    const set = live.get(marking.frameworkId) ?? new Set<string>();
    set.add(marking.controlId);
    live.set(marking.frameworkId, set);
  }
  return live;
}

/** Is `controlId` first round on the System `systemId`? See `firstRoundControlIdsForSystem`. */
export async function isControlFirstRound(controlId: string, systemId: string, db?: Db) {
  return (await firstRoundControlIdsForSystem(systemId, { controlIds: [controlId], db })).has(controlId);
}
