import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who can raise a Requirement Query, or resolve one — the same set for both.
 * The System Owner can never raise or resolve one on their own System (see
 * `canReplyToQuery`): a question is inherently a reviewer-side action, and
 * resolving it is an independent-party judgment call, the same pattern this
 * app already uses for Approval.
 */
export const ROLES_ALLOWED_TO_MANAGE_QUERIES: UserRole[] = ["REVIEWER", "RISK_OWNER", "ADMIN"];

/** Can `user` reply to (add a message on) a Requirement Query for `system`? */
export function canReplyToQuery(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return system.ownerId === user.id || ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role);
}

export const QUERY_INCLUDE = {
  messages: { include: { author: true }, orderBy: { createdAt: "asc" } },
  resolvedBy: true,
} as const;

/**
 * Raises a new Requirement Query on `assessmentId`, opening it with `body`
 * as the first Query Message. Creates the RequirementAssessment row first if
 * one doesn't exist yet (a Requirement can be queried before the System
 * Owner has touched it at all — same lazy-row pattern used elsewhere, e.g.
 * PATCH .../assessments/[requirementId]).
 */
export async function raiseQuery(
  system: { id: string },
  requirementId: string,
  raisedById: string,
  body: string,
) {
  const assessment = await prisma.requirementAssessment.upsert({
    where: { systemId_requirementId: { systemId: system.id, requirementId } },
    create: { systemId: system.id, requirementId },
    update: {},
  });

  return prisma.requirementQuery.create({
    data: {
      requirementAssessmentId: assessment.id,
      lastMessageAuthorId: raisedById,
      messages: { create: { authorId: raisedById, body } },
    },
    include: QUERY_INCLUDE,
  });
}

/**
 * Adds a reply to an existing Requirement Query. Posting on a resolved
 * thread automatically reopens it — no separate reopen action.
 */
export async function addQueryMessage(queryId: string, authorId: string, body: string) {
  return prisma.$transaction(async (tx) => {
    await tx.queryMessage.create({ data: { requirementQueryId: queryId, authorId, body } });
    return tx.requirementQuery.update({
      where: { id: queryId },
      data: { lastMessageAuthorId: authorId, resolved: false, resolvedById: null, resolvedAt: null },
      include: QUERY_INCLUDE,
    });
  });
}

/** Marks a Requirement Query resolved. */
export function resolveQuery(queryId: string, resolvedById: string) {
  return prisma.requirementQuery.update({
    where: { id: queryId },
    data: { resolved: true, resolvedById, resolvedAt: new Date() },
    include: QUERY_INCLUDE,
  });
}

/**
 * Is `query` currently awaiting the System's owner (someone on the reviewer
 * side spoke last), or awaiting the reviewer side (the owner just replied)?
 * The one piece of "whose turn is it" logic every open-Query counter below
 * shares — derived from `lastMessageAuthorId` vs. the System's `ownerId`
 * rather than a separate per-message role/side flag, since only the owner
 * can reply and only REVIEWER/RISK_OWNER/ADMIN can raise/reply/resolve.
 */
export function isAwaitingOwner(query: { lastMessageAuthorId: string }, system: { ownerId: string }) {
  return query.lastMessageAuthorId !== system.ownerId;
}

/**
 * Does an open Requirement Query on `system` currently need `user`'s
 * attention? True only for the System's own owner (when it's their turn) or
 * a REVIEWER/RISK_OWNER/ADMIN (when it's the reviewer side's turn) — nobody
 * else (a VIEWER, a SYSTEM_OWNER who doesn't own this System, a
 * BUSINESS_RISK_OWNER) can act on a Query, so they never see a count for it.
 */
export function isQueryActionableBy(
  query: { resolved: boolean; lastMessageAuthorId: string },
  system: { ownerId: string },
  user: { id: string; role: UserRole },
) {
  if (query.resolved) return false;
  const awaitingOwner = isAwaitingOwner(query, system);
  if (system.ownerId === user.id) return awaitingOwner;
  if (ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role)) return !awaitingOwner;
  return false;
}

/**
 * Open-Query counts actionable by `user`, grouped by System, across
 * `systemIds` — the shared source for the per-System rollup on `/systems`
 * and the landing-page dashboard card total (see #56). Fetches every
 * unresolved Query for those Systems and filters in application code, the
 * same style used elsewhere in this codebase for logic Prisma's `where`
 * can't express directly (comparing one row's field to another row's field).
 */
export async function getActionableQueryCountsBySystem(
  user: { id: string; role: UserRole },
  systemIds: string[],
) {
  if (systemIds.length === 0) return new Map<string, number>();

  const openQueries = await prisma.requirementQuery.findMany({
    where: { resolved: false, requirementAssessment: { systemId: { in: systemIds } } },
    select: {
      resolved: true,
      lastMessageAuthorId: true,
      requirementAssessment: { select: { systemId: true, system: { select: { ownerId: true } } } },
    },
  });

  const counts = new Map<string, number>();
  for (const query of openQueries) {
    const { systemId, system } = query.requirementAssessment;
    if (isQueryActionableBy(query, system, user)) {
      counts.set(systemId, (counts.get(systemId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Total open Requirement Queries actionable by `user` across `systemIds`. */
export async function getActionableQueryCount(user: { id: string; role: UserRole }, systemIds: string[]) {
  const counts = await getActionableQueryCountsBySystem(user, systemIds);
  return [...counts.values()].reduce((sum, n) => sum + n, 0);
}
