import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
 * (always in scope) plus the System's declared scope, only PUBLISHED ones, the same definition applicability uses
 * (APPLICABILITY_SCOPING). A declared row pointing at a Draft Framework is inert until it is published.
 */
export async function effectiveScopeFrameworkIds(systemId: string, db: Pick<Db, "framework"> = prisma) {
  const frameworks = await db.framework.findMany({
    where: { status: "PUBLISHED", OR: [{ isBase: true }, { scopedSystems: { some: { id: systemId } } }] },
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
  if (frameworkIds.length === 0) return new Set<string>();
  const markings = await db.frameworkFirstRoundControl.findMany({
    where: { frameworkId: { in: frameworkIds }, ...(controlIds ? { controlId: { in: controlIds } } : {}) },
    select: { frameworkId: true, controlId: true },
  });
  if (markings.length === 0) return new Set<string>();
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
  const live = new Set<string>();
  for (const mapping of mappings) {
    const frameworkId = frameworkOfRequirement.get(mapping.requirementId);
    if (frameworkId) live.add(`${frameworkId}:${mapping.controlId}`);
  }
  return new Set(markings.filter((m) => live.has(`${m.frameworkId}:${m.controlId}`)).map((m) => m.controlId));
}

/** Is `controlId` first round on the System `systemId`? See `firstRoundControlIdsForSystem`. */
export async function isControlFirstRound(controlId: string, systemId: string, db?: Db) {
  return (await firstRoundControlIdsForSystem(systemId, { controlIds: [controlId], db })).has(controlId);
}
