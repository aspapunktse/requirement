import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { canChangeBusinessSystemOwner } from "@/lib/system-permissions";
import { SYSTEM_CLOSED_REFUSAL } from "@/lib/system-closed";

/**
 * The Business System Owner (BSO) of a System (#321, PRD 0002 F-BSO, ADR 0014): the person who will decide its
 * evaluation gates. Optional for now (a later ticket requires one before OG1); any User, whatever their role, but
 * never the System's owner. The System's owner or an Admin sets, changes or clears it, at any Onboarding Status.
 * The BSO sees the System (`visibleSystemsWhere`) but gets no write rights on it.
 */

type Actor = { id: string; role: UserRole };

/**
 * May the BSO be cleared again once set? The product owner may decide a System must always have one after it is
 * set; flipping this to false makes `changeBusinessSystemOwner` refuse a null with 400.
 */
export const BSO_MAY_BE_CLEARED = true;

/** The 400 text when the chosen Business System Owner is the System's owner. */
export const BSO_IS_OWNER_REFUSAL = "The Business System Owner can't be the System's owner";
/** The 400 text when the chosen Business System Owner isn't a User. */
export const BSO_UNKNOWN_USER_REFUSAL = "The Business System Owner must be an existing user";
/** The 400 text when clearing is not allowed (see `BSO_MAY_BE_CLEARED`). */
export const BSO_CLEAR_REFUSAL = "A System's Business System Owner can't be cleared";

export type BusinessSystemOwnerResult =
  | { ok: true; changed: boolean; businessSystemOwner: { id: string; name: string } | null }
  | { ok: false; status: 400 | 403 | 409; error: string };

/**
 * Sets `systemId`'s Business System Owner to `businessSystemOwnerId` (null clears it). Reads and writes in one
 * transaction, every query on `tx`. A System the actor can't see, doesn't exist, or may not change is refused
 * alike (403, nothing written) so existence isn't leaked. The write is guarded on the value read (409 on a
 * concurrent change). Exactly one BUSINESS_SYSTEM_OWNER_CHANGED Change Event, in the same transaction, naming
 * the old and new Business System Owner; saving the value it already has writes nothing.
 */
export async function changeBusinessSystemOwner(
  actor: Actor,
  systemId: string,
  businessSystemOwnerId: string | null,
): Promise<BusinessSystemOwnerResult> {
  class Abort extends Error {
    constructor(readonly result: Extract<BusinessSystemOwnerResult, { ok: false }>) {
      super(result.error);
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const system = await tx.system.findFirst({
        where: { AND: [{ id: systemId }, await visibleSystemsWhere(actor, tx)] },
        select: { id: true, ownerId: true, evaluationClosedAt: true, businessSystemOwner: { select: { id: true, name: true } } },
      });
      if (!system || !canChangeBusinessSystemOwner(actor, system)) {
        throw new Abort({ ok: false, status: 403, error: "Only a System's owner or an Admin can change its Business System Owner" });
      }
      if (system.evaluationClosedAt) throw new Abort({ ok: false, status: 409, error: SYSTEM_CLOSED_REFUSAL });

      let next: { id: string; name: string } | null = null;
      if (businessSystemOwnerId === null) {
        if (!BSO_MAY_BE_CLEARED && system.businessSystemOwner) throw new Abort({ ok: false, status: 400, error: BSO_CLEAR_REFUSAL });
      } else {
        next = await tx.user.findUnique({ where: { id: businessSystemOwnerId }, select: { id: true, name: true } });
        if (!next) throw new Abort({ ok: false, status: 400, error: BSO_UNKNOWN_USER_REFUSAL });
        if (next.id === system.ownerId) throw new Abort({ ok: false, status: 400, error: BSO_IS_OWNER_REFUSAL });
      }

      const current = system.businessSystemOwner;
      if ((current?.id ?? null) === (next?.id ?? null)) return { ok: true as const, changed: false, businessSystemOwner: current };

      // Guarded on the BSO and the owner we read: a concurrent change of either in between (an owner change to
      // this very user, say) matches no row and aborts the request.
      const updated = await tx.system.updateMany({
        where: { id: system.id, businessSystemOwnerId: current?.id ?? null, ownerId: system.ownerId },
        data: { businessSystemOwnerId: next?.id ?? null },
      });
      if (updated.count !== 1) {
        throw new Abort({ ok: false, status: 409, error: "The System's owner or Business System Owner changed while saving; try again" });
      }
      await logChangeEvent(
        system.id,
        "BUSINESS_SYSTEM_OWNER_CHANGED",
        `Business System Owner changed from ${current?.name ?? "none"} to ${next?.name ?? "none"}`,
        actor.id,
        tx,
      );
      return { ok: true as const, changed: true, businessSystemOwner: next };
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

/** Every User who may be picked as a Business System Owner: any User, whatever the role. */
export function listBusinessSystemOwnerCandidates() {
  return prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
}
