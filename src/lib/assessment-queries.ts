import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { isReadOnlySystemRole } from "@/lib/system-permissions";
import { deciderVisibilityFor, memberGroupIds } from "@/lib/approvals";
import {
  BASE_REVIEW_STEP_NAME,
  groupsWhoseRemitIncludes,
  remitGroupsByControl,
  SYSTEM_FOR_STEPS,
} from "@/lib/review-steps";
import type { SystemClassification } from "@/lib/control-applicability";
import { QUERY_INCLUDE } from "@/lib/assessment-query-include";

export { QUERY_INCLUDE };

/**
 * Who can raise an Assessment Query, or resolve one, by role: the same set for both. A member of
 * a Review Group can too, of any role, but only for a Control in the group's remit on that System
 * (`queryRightsFor`, #201). The System Owner can never raise or resolve one on their own System
 * (see `canReplyToQuery`): a question is inherently a reviewer-side action, and resolving it is an
 * independent-party judgment call, the same pattern this app already uses for Approval.
 */
export const ROLES_ALLOWED_TO_MANAGE_QUERIES: UserRole[] = ["REVIEWER", "RISK_OWNER", "ADMIN"];

/** Can `user` reply to (add a message on) an Assessment Query for `system`, by role or as its owner? A Review Group member's right is `queryRightsFor`'s. */
export function canReplyToQuery(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (isReadOnlySystemRole(user)) return false;
  return system.ownerId === user.id || ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role);
}

/*
 * QUERY_ATTRIBUTION_IN_201 (product-owner decisions on #201; change them here and in `queryRightsFor`):
 *  1. Attribution is fixed when a Query Message is posted (or a Query resolved) and stored on the row,
 *     so later membership or remit changes never rewrite an old thread. The name shown is a snapshot.
 *  2. An Admin's messages stay named.
 *  3. When posting: the Control is in the remit of a group the author is a member of, the group (even
 *     for a Reviewer); otherwise a Reviewer posts as "Base review"; a Risk Owner, an Admin and the
 *     System's owner post named. With two such groups the one whose name sorts first is used.
 *  4. A Compliance Manager who is a member may raise, reply and resolve in the group's remit
 *     (the read-only guard is lifted only for that, and only through membership).
 *  5. "Resolved by" follows the same attribution and redaction as messages.
 *  6. Membership never gives Query rights on a System the member owns.
 *  7. An open Query on a remit Control counts toward a member's tasks like it does for the reviewer side.
 * Who sees the person behind a group or "Base review" attribution is `deciderVisibilityFor`'s rule
 * (the same as for Approvals); a group deleted since is seen through only by Admin, Internal Auditor
 * and Compliance Manager.
 */

/** Who a Query Message (or a resolution) is attributed to; both null means shown named. */
export type QueryAttribution = { reviewGroupId: string | null; attributedTo: string | null };

/** Shown by name: the author is visible to everyone who can see the thread. */
export const NAMED: QueryAttribution = { reviewGroupId: null, attributedTo: null };

export type QueryAction = "raise" | "reply" | "resolve";

/** An Internal Auditor is strictly read-only and is never given Query rights through membership. */
function canActThroughMembership(user: { role: UserRole }) {
  return user.role !== "INTERNAL_AUDITOR";
}

/** Is `user` a member of any Review Group, and so possibly entitled to act in a group's remit? Cheap pre-check before a System is loaded. */
export async function mayActThroughMembership(user: { id: string; role: UserRole }) {
  return canActThroughMembership(user) && (await memberGroupIds(user.id)).length > 0;
}

/**
 * Whether `user` may take `action` on the Assessment of `controlId` on `system`, and who the
 * message or resolution is attributed to. Allowed by role (Reviewer, Risk Owner, Admin; and the
 * System's owner for a reply) or through membership of a Review Group whose remit on the System
 * includes the Control (never on a System the user owns, and never for a base Control, which is
 * in no group's remit). The membership reads are one RepeatableRead snapshot, every read on `tx`.
 */
export async function queryRightsFor(
  user: { id: string; role: UserRole },
  system: SystemClassification & { id: string; ownerId: string },
  controlId: string,
  action: QueryAction,
): Promise<{ allowed: boolean; attribution: QueryAttribution }> {
  const isOwner = system.ownerId === user.id;
  const byRole = !isReadOnlySystemRole(user) && ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role);
  const asOwner = action === "reply" && isOwner && !isReadOnlySystemRole(user);

  let group: { id: string; name: string } | null = null;
  if (!isOwner && canActThroughMembership(user)) {
    group = await prisma.$transaction(
      async (tx) => {
        const memberOf = new Set(await memberGroupIds(user.id, tx));
        if (memberOf.size === 0) return null;
        const remit = await groupsWhoseRemitIncludes(tx, system, controlId);
        const mine = [...remit].filter(([id]) => memberOf.has(id)).sort(([, a], [, b]) => a.localeCompare(b));
        return mine[0] ? { id: mine[0][0], name: mine[0][1] } : null;
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  const allowed = byRole || asOwner || group !== null;
  if (!allowed) return { allowed, attribution: NAMED };
  if (isOwner || user.role === "ADMIN") return { allowed, attribution: NAMED };
  if (group) return { allowed, attribution: { reviewGroupId: group.id, attributedTo: group.name } };
  if (user.role === "REVIEWER") return { allowed, attribution: { reviewGroupId: null, attributedTo: BASE_REVIEW_STEP_NAME } };
  return { allowed, attribution: NAMED };
}

/** What a read with `QUERY_INCLUDE` returns: raw, with the people behind every attribution. */
export type RawQuery = Prisma.AssessmentQueryGetPayload<{ include: typeof QUERY_INCLUDE }>;

export type QueryMessageView = {
  id: string;
  body: string;
  createdAt: Date;
  /** The group's name, or "Base review"; null when the message is shown named. */
  attributedTo: string | null;
  /** Absent when the viewer may not see who wrote it (no author id or name leaves the server then). */
  author?: { id: string; name: string; role: UserRole };
};

export type QueryView = {
  id: string;
  controlAssessmentId: string;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  /** Who the resolution is attributed to, as for a message; null when named (or not resolved). */
  resolvedAttributedTo: string | null;
  /** Absent when not resolved, or when the viewer may not see who resolved it. */
  resolvedBy?: { id: string; name: string };
  messages: QueryMessageView[];
};

/** Delimits a group that no longer exists: matches no member, so only the always-seeing roles see through it. */
const DELETED_GROUP = "";

/**
 * Whether `viewer` may see the person behind an attribution. A name shown named is visible to all.
 * Otherwise the Approval decider rule (`deciderVisibilityFor`): Admin, Internal Auditor and Compliance
 * Manager always; members of the group for a group's, Reviewers for "Base review"; never the System's
 * owner. A group deleted since (a name but no group id, other than the base step's) only for the
 * always-seeing roles. A function is returned so the viewer's groups load once.
 */
export async function attributionVisibilityFor(viewer: { id: string; role: UserRole }, systemOwnerId: string) {
  const canSeeDecider = await deciderVisibilityFor(viewer, systemOwnerId);
  return (attribution: QueryAttribution): boolean => {
    if (attribution.attributedTo === null) return true;
    if (attribution.reviewGroupId !== null) return canSeeDecider({ reviewGroupId: attribution.reviewGroupId });
    if (attribution.attributedTo === BASE_REVIEW_STEP_NAME) return canSeeDecider({ reviewGroupId: null });
    return canSeeDecider({ reviewGroupId: DELETED_GROUP });
  };
}

/**
 * The Queries as `viewer` may see them: a message's author (id, name, role), and who resolved a
 * Query, only where `attributionVisibilityFor` allows it, omitted (not nulled) otherwise. Builds the
 * views field by field, so the scalar ids on the rows (`authorId`, `lastMessageAuthorId`,
 * `resolvedById`) never reach a client. Every response that carries Queries goes through this.
 */
export async function redactQueries(
  queries: RawQuery[],
  viewer: { id: string; role: UserRole },
  systemOwnerId: string,
): Promise<QueryView[]> {
  if (queries.length === 0) return [];
  const canSee = await attributionVisibilityFor(viewer, systemOwnerId);
  return queries.map((query) => {
    const resolution = { reviewGroupId: query.resolvedByReviewGroupId, attributedTo: query.resolvedAttributedTo };
    return {
      id: query.id,
      controlAssessmentId: query.controlAssessmentId,
      resolved: query.resolved,
      resolvedAt: query.resolvedAt,
      createdAt: query.createdAt,
      resolvedAttributedTo: query.resolvedAttributedTo,
      ...(query.resolvedBy && canSee(resolution) ? { resolvedBy: { id: query.resolvedBy.id, name: query.resolvedBy.name } } : {}),
      messages: query.messages.map((message) => ({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt,
        attributedTo: message.attributedTo,
        ...(canSee(message) ? { author: { id: message.author.id, name: message.author.name, role: message.author.role } } : {}),
      })),
    };
  });
}

/**
 * For `viewer` on `system`: whether they may raise and resolve Queries on a given Control's Assessment
 * (what the UI offers; the routes enforce it with `queryRightsFor`). By role for a Reviewer, Risk Owner
 * or Admin; otherwise only through a Review Group whose remit includes the Control, never on a System
 * the viewer owns. One RepeatableRead snapshot for the membership and remit reads.
 */
export async function queryManagementFor(
  viewer: { id: string; role: UserRole },
  system: SystemClassification & { ownerId: string },
): Promise<(controlId: string) => boolean> {
  if (!isReadOnlySystemRole(viewer) && ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(viewer.role)) return () => true;
  if (system.ownerId === viewer.id || !canActThroughMembership(viewer)) return () => false;
  const inRemit = await prisma.$transaction(
    async (tx) => {
      const memberOf = new Set(await memberGroupIds(viewer.id, tx));
      if (memberOf.size === 0) return new Set<string>();
      const remit = await remitGroupsByControl(tx, system);
      return new Set([...remit].filter(([, groups]) => [...groups.keys()].some((id) => memberOf.has(id))).map(([controlId]) => controlId));
    },
    { isolationLevel: "RepeatableRead" },
  );
  return (controlId) => inRemit.has(controlId);
}

/**
 * The System's Assessment rows as `viewer` may receive them: Queries redacted (`redactQueries`), and a
 * `canManageQueries` flag per row. Everything that sends `getSystemAssessments`, `getSystemAssessmentRow`
 * or `getStaleAssessments` output to a client passes through here or `presentStaleAssessments`.
 */
export async function presentAssessmentRows<A extends { queries: RawQuery[] }>(
  rows: { control: { id: string }; assessment: A | null }[],
  viewer: { id: string; role: UserRole },
  system: SystemClassification & { ownerId: string },
) {
  const canManage = await queryManagementFor(viewer, system);
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      canManageQueries: canManage(row.control.id),
      assessment: row.assessment && {
        ...row.assessment,
        queries: await redactQueries(row.assessment.queries, viewer, system.ownerId),
      },
    })),
  );
}

/** `presentAssessmentRows` for stale Assessments (rows of the Assessment itself, with its Control). */
export async function presentStaleAssessments<A extends { controlId: string; queries: RawQuery[] }>(
  assessments: A[],
  viewer: { id: string; role: UserRole },
  system: SystemClassification & { ownerId: string },
) {
  const canManage = await queryManagementFor(viewer, system);
  return Promise.all(
    assessments.map(async (assessment) => ({
      ...assessment,
      canManageQueries: canManage(assessment.controlId),
      queries: await redactQueries(assessment.queries, viewer, system.ownerId),
    })),
  );
}

/**
 * Raises a new Assessment Query on `assessmentId`, opening it with `body`
 * as the first Query Message, attributed as `attribution` says (`queryRightsFor`).
 * Creates the ControlAssessment row first if
 * one doesn't exist yet (a Control can be queried before the System
 * Owner has touched it at all — same lazy-row pattern used elsewhere, e.g.
 * PATCH .../assessments/[controlId]).
 */
export async function raiseQuery(
  system: { id: string },
  controlId: string,
  raisedById: string,
  body: string,
  attribution: QueryAttribution,
) {
  const assessment = await prisma.controlAssessment.upsert({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    create: { systemId: system.id, controlId },
    update: {},
  });

  const query = await prisma.assessmentQuery.create({
    data: {
      controlAssessmentId: assessment.id,
      lastMessageAuthorId: raisedById,
      messages: { create: { authorId: raisedById, body, ...attribution } },
    },
    include: QUERY_INCLUDE,
  });
  await logChangeEvent(system.id, "QUERY_OPENED", `Query raised: "${body.slice(0, 80)}"`, raisedById);
  return query;
}

/**
 * Adds a reply to an existing Assessment Query. Posting on a resolved
 * thread automatically reopens it — no separate reopen action.
 */
export async function addQueryMessage(queryId: string, authorId: string, body: string, attribution: QueryAttribution) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.assessmentQuery.findUniqueOrThrow({
      where: { id: queryId },
      select: { controlAssessment: { select: { systemId: true } } },
    });
    await tx.queryMessage.create({ data: { assessmentQueryId: queryId, authorId, body, ...attribution } });
    const query = await tx.assessmentQuery.update({
      where: { id: queryId },
      data: {
        lastMessageAuthorId: authorId,
        resolved: false,
        resolvedById: null,
        resolvedAt: null,
        resolvedByReviewGroupId: null,
        resolvedAttributedTo: null,
      },
      include: QUERY_INCLUDE,
    });
    await tx.changeEvent.create({
      data: {
        systemId: existing.controlAssessment.systemId,
        action: "QUERY_REPLIED",
        detail: `Reply: "${body.slice(0, 80)}"`,
        actorId: authorId,
      },
    });
    return query;
  });
}

/** Marks an Assessment Query resolved, attributed as `attribution` says (`queryRightsFor`). */
export async function resolveQuery(queryId: string, resolvedById: string, attribution: QueryAttribution) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.assessmentQuery.findUniqueOrThrow({
      where: { id: queryId },
      select: { controlAssessment: { select: { systemId: true } } },
    });
    const query = await tx.assessmentQuery.update({
      where: { id: queryId },
      data: {
        resolved: true,
        resolvedById,
        resolvedAt: new Date(),
        resolvedByReviewGroupId: attribution.reviewGroupId,
        resolvedAttributedTo: attribution.attributedTo,
      },
      include: QUERY_INCLUDE,
    });
    await tx.changeEvent.create({
      data: {
        systemId: existing.controlAssessment.systemId,
        action: "QUERY_RESOLVED",
        detail: "Query resolved",
        actorId: resolvedById,
      },
    });
    return query;
  });
}

/**
 * Is `query` currently awaiting the System's owner (someone on the reviewer
 * side spoke last), or awaiting the reviewer side (the owner just replied)?
 * The one piece of "whose turn is it" logic every open-Query counter below
 * shares — derived from `lastMessageAuthorId` vs. the System's `ownerId`
 * rather than a separate per-message role/side flag, since only the owner
 * can reply and only REVIEWER/RISK_OWNER/ADMIN (or a Review Group member in
 * the group's remit) can raise/reply/resolve.
 */
export function isAwaitingOwner(query: { lastMessageAuthorId: string }, system: { ownerId: string }) {
  return query.lastMessageAuthorId !== system.ownerId;
}

/**
 * Does an open Assessment Query on `system` currently need `user`'s
 * attention? True only for the System's own owner (when it's their turn) or
 * a REVIEWER/RISK_OWNER/ADMIN (when it's the reviewer side's turn), or a Review
 * Group member for a Control in the group's remit (`viaMembership`, which
 * the caller computes, and never for the System's owner) — nobody
 * else (a VIEWER, a SYSTEM_OWNER who doesn't own this System, a
 * BUSINESS_RISK_OWNER) can act on a Query, so they never see a count for it.
 */
export function isQueryActionableBy(
  query: { resolved: boolean; lastMessageAuthorId: string },
  system: { ownerId: string },
  user: { id: string; role: UserRole },
  viaMembership = false,
) {
  if (query.resolved) return false;
  // A read-only System role can never act on a Query, even one on a System recorded as its own (#147),
  // except a Compliance Manager through a Review Group's remit (#201).
  if (isReadOnlySystemRole(user) && !viaMembership) return false;
  const awaitingOwner = isAwaitingOwner(query, system);
  if (system.ownerId === user.id) return awaitingOwner;
  if (ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role) || viaMembership) return !awaitingOwner;
  return false;
}

type OpenQueryForMembership = {
  controlAssessment: { systemId: string; controlId: string; system: { ownerId: string } };
};

/**
 * The `systemId:controlId` of each open Query that `user` may act on only through Review Group
 * membership (#201): a Control in the remit of one of their groups, on a System they don't own.
 * Empty for a user whose role already acts on every Query, one in no group, or an Internal Auditor.
 * The user's groups load once and a remit is computed only for a System that has an open Query and
 * one of the groups' Frameworks in its declared scope: no per-Query reads.
 */
async function membershipQueryKeys(user: { id: string; role: UserRole }, queries: OpenQueryForMembership[]) {
  const keys = new Set<string>();
  if (!canActThroughMembership(user) || ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(user.role)) return keys;
  const groupIds = await memberGroupIds(user.id);
  if (groupIds.length === 0) return keys;
  const systemIds = [
    ...new Set(queries.filter((q) => q.controlAssessment.system.ownerId !== user.id).map((q) => q.controlAssessment.systemId)),
  ];
  if (systemIds.length === 0) return keys;
  await prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: { id: { in: systemIds }, frameworkScopes: { some: { reviewGroupId: { in: groupIds } } } },
        include: SYSTEM_FOR_STEPS,
      });
      for (const system of systems) {
        const remit = await remitGroupsByControl(tx, system);
        for (const query of queries) {
          const { systemId, controlId } = query.controlAssessment;
          if (systemId !== system.id) continue;
          if ([...(remit.get(controlId)?.keys() ?? [])].some((id) => groupIds.includes(id))) keys.add(`${systemId}:${controlId}`);
        }
      }
    },
    { isolationLevel: "RepeatableRead" },
  );
  return keys;
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

  const openQueries = await prisma.assessmentQuery.findMany({
    where: { resolved: false, controlAssessment: { systemId: { in: systemIds } } },
    select: {
      resolved: true,
      lastMessageAuthorId: true,
      controlAssessment: { select: { systemId: true, controlId: true, system: { select: { ownerId: true } } } },
    },
  });

  const viaMembership = await membershipQueryKeys(user, openQueries);
  const counts = new Map<string, number>();
  for (const query of openQueries) {
    const { systemId, controlId, system } = query.controlAssessment;
    if (isQueryActionableBy(query, system, user, viaMembership.has(`${systemId}:${controlId}`))) {
      counts.set(systemId, (counts.get(systemId) ?? 0) + 1);
    }
  }
  return counts;
}

/** Total open Assessment Queries actionable by `user` across `systemIds`. */
export async function getActionableQueryCount(user: { id: string; role: UserRole }, systemIds: string[]) {
  const counts = await getActionableQueryCountsBySystem(user, systemIds);
  return [...counts.values()].reduce((sum, n) => sum + n, 0);
}

export type ActionableQuery = {
  id: string;
  systemId: string;
  systemName: string;
  controlTitle: string;
  updatedAt: Date;
};

/**
 * The actual open Assessment Query rows actionable by `user` across
 * `systemIds` — same filtering as `getActionableQueryCountsBySystem`, but
 * returning enough per-row detail (System, Control, most recent message
 * time) for the landing page's unified task table, not just a count.
 */
export async function getActionableQueries(
  user: { id: string; role: UserRole },
  systemIds: string[],
): Promise<ActionableQuery[]> {
  if (systemIds.length === 0) return [];

  const openQueries = await prisma.assessmentQuery.findMany({
    where: { resolved: false, controlAssessment: { systemId: { in: systemIds } } },
    include: {
      controlAssessment: {
        include: {
          system: { select: { id: true, name: true, ownerId: true } },
          control: { select: { title: true } },
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
  });

  const viaMembership = await membershipQueryKeys(user, openQueries);
  const rows: ActionableQuery[] = [];
  for (const query of openQueries) {
    const { system, control } = query.controlAssessment;
    if (!isQueryActionableBy(query, system, user, viaMembership.has(`${system.id}:${query.controlAssessment.controlId}`))) continue;
    rows.push({
      id: query.id,
      systemId: system.id,
      systemName: system.name,
      controlTitle: control.title,
      updatedAt: query.messages[0]?.createdAt ?? query.createdAt,
    });
  }
  return rows;
}
