import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { controlIncludeFor } from "@/lib/frameworks";

/**
 * Every Control with `controlIncludeFor(user)`, ordered by code, as the raw rows (the Draft origin
 * not yet redacted: callers apply `redactDraftOrigin`), for `GET /api/controls`. The Control Library page
 * (`loadControlLibraryView`, `src/app/controls/library-data.ts`) reads the same include in its own snapshot.
 *
 * One REPEATABLE READ snapshot: the include nests mappings -> requirement -> framework, and
 * Prisma runs it as several statements. A Requirement deleted between them would otherwise leave a
 * mapping whose required Requirement is gone and throw "Inconsistent query result" (#279). Read-only,
 * so there is nothing to retry.
 */
export async function loadControlsFor(user: { role: UserRole }) {
  return prisma.$transaction(
    (tx) => tx.control.findMany({ orderBy: { code: "asc" }, include: controlIncludeFor(user) }),
    { isolationLevel: "RepeatableRead" },
  );
}

/** One Control with `controlIncludeFor(user)` in a REPEATABLE READ snapshot (see `loadControlsFor`); null when it doesn't exist. */
export async function loadControlFor(user: { role: UserRole }, id: string) {
  return prisma.$transaction(
    (tx) => tx.control.findUnique({ where: { id }, include: controlIncludeFor(user) }),
    { isolationLevel: "RepeatableRead" },
  );
}

/** Whether `user` gets the link to the Control Library editor: those who can author Controls. */
export function canEditControlLibrary(user: { role: UserRole }): boolean {
  return ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role);
}
