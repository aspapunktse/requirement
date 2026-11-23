import type { Prisma } from "@prisma/client";
import { logChangeEvent } from "@/lib/change-events";
import { beginScopeChange, finishScopeChange, type ScopeBefore } from "@/lib/framework-scope";

/**
 * A Compliance Boundary's changes to its member Systems' effective Framework Scope (#419, ADR 0016). Each one is a scope change
 * like a declared one: it recomputes applicability (Control Assessments are added Not Started; untouched ones of Controls that
 * stop applying are removed, touched ones are kept and show as stale), logs a Change Event on each System whose applicable
 * Controls changed, and starts or widens a Change Review on an Onboarded System when Controls are added. It all runs on the
 * caller's transaction `tx` (the change and its recompute commit together), through the same `beginScopeChange` and
 * `finishScopeChange` a declared change uses. The caller reconciles Review Steps after the commit (the returned ids) and wraps
 * the transaction in `recordProviderChanges` for member Systems that are Providers.
 */

/** Long enough for a fan-out over hundreds of member Systems, each recomputed on the one transaction. */
export const BOUNDARY_FAN_OUT_TRANSACTION = { timeout: 120_000, maxWait: 10_000 } as const;

/**
 * Takes the Boundary's row lock. Every transaction that changes a Boundary's members or Frameworks (a join, a leave, a Framework
 * change with its fan-out) calls it first, before locking any System, so the lock order is always Boundary, then Systems. Without
 * it, a join racing a Framework change could compute its "after" from the old Framework list while the fan-out's member list
 * misses the joining System, which would then never get the new Framework's Controls (or keep a dropped one's).
 */
export async function lockBoundary(tx: Prisma.TransactionClient, boundaryId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "ComplianceBoundary" WHERE "id" = ${boundaryId} FOR UPDATE`;
}

/** The Change Event wording of a System joining or leaving: its scope changes by this Boundary's Frameworks. */
const describeMembership = (verb: "joining" | "leaving", boundaryName: string) => (added: number, removed: number) =>
  `Framework Scope changed by ${verb} Compliance Boundary "${boundaryName}" (+${added}/-${removed} Control Assessment(s))`;

/**
 * Adds the System to the Boundary. The caller has checked the permission, that the System exists and is open and that it isn't
 * a member yet. Writes the membership, the membership Change Event and the recompute. Returns the System's id if its effective scope
 * may have changed (for the Review Steps), else an empty list.
 */
export async function joinBoundaryIn(
  tx: Prisma.TransactionClient,
  boundary: { id: string; name: string },
  systemId: string,
  actorId: string,
): Promise<string[]> {
  const before = await beginScopeChange(tx, systemId);
  await tx.complianceBoundarySystem.create({ data: { boundaryId: boundary.id, systemId, addedById: actorId } });
  await logChangeEvent(systemId, "BOUNDARY_MEMBERSHIP_CHANGED", `Added to Compliance Boundary "${boundary.name}"`, actorId, tx);
  await finishScopeChange(tx, systemId, before, actorId, { describe: describeMembership("joining", boundary.name), logUnchanged: false });
  return [systemId];
}

/** Removes the membership `membershipId` of the System; otherwise as `joinBoundaryIn`. */
export async function leaveBoundaryIn(
  tx: Prisma.TransactionClient,
  boundary: { id: string; name: string },
  membershipId: string,
  systemId: string,
  actorId: string,
): Promise<string[]> {
  const before = await beginScopeChange(tx, systemId);
  await tx.complianceBoundarySystem.delete({ where: { id: membershipId } });
  await logChangeEvent(systemId, "BOUNDARY_MEMBERSHIP_CHANGED", `Removed from Compliance Boundary "${boundary.name}"`, actorId, tx);
  await finishScopeChange(tx, systemId, before, actorId, { describe: describeMembership("leaving", boundary.name), logUnchanged: false });
  return [systemId];
}

const names = (frameworks: { name: string; version: string }[]) => frameworks.map((framework) => `${framework.name} ${framework.version}`).join(", ");

/**
 * Makes `frameworkIds` the Boundary's whole Framework list (the caller has validated them), and fans the change out to every
 * member System, closed ones included (a recompute keeps their Assessments true to their scope, like the catalog recompute does):
 * one Change Event on each System whose applicable Controls changed, and a Change Review where an Onboarded System gains
 * Controls. Systems are locked in id order, so two overlapping fan-outs can't deadlock. A System that is in another Boundary
 * holding the same Framework, or declares it, keeps it in scope and so changes nothing. Returns the ids of the member Systems whose
 * Review Steps to reconcile after the commit (all members when a Framework was added or dropped, else none).
 */
export async function setBoundaryFrameworksIn(
  tx: Prisma.TransactionClient,
  boundary: { id: string; name: string },
  frameworkIds: string[],
  actorId: string,
): Promise<string[]> {
  const held = await tx.complianceBoundaryFramework.findMany({ where: { boundaryId: boundary.id }, select: { frameworkId: true } });
  const heldIds = new Set(held.map((row) => row.frameworkId));
  const added = frameworkIds.filter((id) => !heldIds.has(id));
  const dropped = [...heldIds].filter((id) => !frameworkIds.includes(id));
  if (added.length === 0 && dropped.length === 0) return [];

  const changed = await tx.framework.findMany({ where: { id: { in: [...added, ...dropped] } }, select: { id: true, name: true, version: true } });
  const nameOf = (ids: string[]) => names(changed.filter((framework) => ids.includes(framework.id)));
  const wording = [added.length > 0 && `added ${nameOf(added)}`, dropped.length > 0 && `dropped ${nameOf(dropped)}`].filter(Boolean).join("; ");

  const members = await tx.complianceBoundarySystem.findMany({ where: { boundaryId: boundary.id }, select: { systemId: true }, orderBy: { systemId: "asc" } });
  // Sequential: one connection. Every member is locked and read before the write, so each one's "before" is the locked state.
  const befores: { systemId: string; before: ScopeBefore }[] = [];
  for (const { systemId } of members) befores.push({ systemId, before: await beginScopeChange(tx, systemId) });

  await tx.complianceBoundaryFramework.deleteMany({ where: { boundaryId: boundary.id, frameworkId: { notIn: frameworkIds } } });
  await tx.complianceBoundaryFramework.createMany({
    data: added.map((frameworkId) => ({ boundaryId: boundary.id, frameworkId, addedById: actorId })),
    skipDuplicates: true,
  });

  for (const { systemId, before } of befores) {
    await finishScopeChange(tx, systemId, before, actorId, {
      describe: (addedCount, removedCount) =>
        `Framework Scope changed: Compliance Boundary "${boundary.name}" ${wording} (+${addedCount}/-${removedCount} Control Assessment(s))`,
      logUnchanged: false,
    });
  }
  return members.map((member) => member.systemId);
}
