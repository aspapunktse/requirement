import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import {
  canBeSystemOwner,
  canChangeOwner,
  isReadOnlySystemRole,
  NEW_OWNER_REFUSAL,
  ROLES_ALLOWED_TO_CREATE_SYSTEM,
} from "@/lib/system-permissions";

/**
 * Changing the owner of one or several Systems (#233). One function behind both the System page and the
 * Systems list's bulk bar, so they can't drift. All-or-nothing: if any System is refused, none changes.
 */

type Actor = { id: string; role: UserRole };

export type OwnerChangeResult =
  | { ok: true; changed: { id: string; name: string }[]; unchanged: { id: string; name: string }[] }
  | { ok: false; status: 400 | 403 | 409; error: string; refusedIds?: string[] };

/**
 * Hands every System in `systemIds` to `ownerId`. Reads and writes in one transaction (every query on
 * `tx`). A System the acting user can't see, or may not change, or that doesn't exist, is refused alike
 * (403, ids named, nothing written) so existence isn't leaked. A System already owned by `ownerId` is left
 * as it is and writes no event. Each changed System writes exactly one SYSTEM_OWNER_CHANGED Change Event.
 */
export async function changeSystemOwners(actor: Actor, systemIds: string[], ownerId: string): Promise<OwnerChangeResult> {
  const ids = [...new Set(systemIds)];
  class Abort extends Error {
    constructor(readonly result: Extract<OwnerChangeResult, { ok: false }>) {
      super(result.error);
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const newOwner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, name: true, role: true } });
      const systems = await tx.system.findMany({
        where: { AND: [{ id: { in: ids } }, await visibleSystemsWhere(actor, tx)] },
        select: { id: true, name: true, ownerId: true, owner: { select: { name: true } } },
      });
      const byId = new Map(systems.map((system) => [system.id, system]));
      const refusedIds = ids.filter((id) => {
        const system = byId.get(id);
        return !system || !canChangeOwner(actor, system);
      });
      if (refusedIds.length > 0) {
        throw new Abort({
          ok: false,
          status: 403,
          error: "Only a System's owner or an Admin can change its owner",
          refusedIds,
        });
      }
      if (!newOwner || !canBeSystemOwner(newOwner)) {
        throw new Abort({ ok: false, status: 400, error: NEW_OWNER_REFUSAL });
      }

      const changed: { id: string; name: string }[] = [];
      const unchanged: { id: string; name: string }[] = [];
      for (const id of ids) {
        const system = byId.get(id)!;
        if (system.ownerId === newOwner.id) {
          unchanged.push({ id, name: system.name });
          continue;
        }
        // Guarded on the owner we read: a concurrent change in between aborts the whole request.
        const updated = await tx.system.updateMany({ where: { id, ownerId: system.ownerId }, data: { ownerId: newOwner.id } });
        if (updated.count !== 1) {
          throw new Abort({ ok: false, status: 409, error: "A System's owner changed while saving; try again", refusedIds: [id] });
        }
        await logChangeEvent(
          id,
          "SYSTEM_OWNER_CHANGED",
          `Owner changed from ${system.owner.name} to ${newOwner.name}`,
          actor.id,
          tx,
        );
        changed.push({ id, name: system.name });
      }
      return { ok: true as const, changed, unchanged };
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

/**
 * May `actor` see the list of possible new owners? An Admin, or a user who owns at least one System (and
 * isn't a read-only role): exactly those who can change some System's owner. Deliberately not "any
 * signed-in user", as the list holds names and email addresses.
 */
export async function mayListOwnerCandidates(actor: Actor): Promise<boolean> {
  if (actor.role === "ADMIN") return true;
  if (isReadOnlySystemRole(actor)) return false;
  return (await prisma.system.count({ where: { ownerId: actor.id } })) > 0;
}

/** Users who may become a System's owner: those with a System-creating role. */
export function listOwnerCandidates() {
  return prisma.user.findMany({
    where: { role: { in: ROLES_ALLOWED_TO_CREATE_SYSTEM } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
