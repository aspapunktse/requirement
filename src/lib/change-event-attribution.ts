import type { ChangeEventAction, UserRole } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { canSeeDecider, memberGroupIds, viewerAlwaysSeesPeople } from "@/lib/approvals";

/**
 * Who a Change Event is attributed to, for one viewer (CONTEXT.md, "A step decides as its group"). One
 * rule for every list of Change Events (the System page's Recent activity and timeline, Home's Recent
 * activity), so the same event reads the same everywhere.
 *
 *  - The viewer's own events: "You". The system's own: "The system".
 *  - An Approval decision is tied back to its Approval (same System, same person, decided within a
 *    minute, the closest wins) and judged by the Approval history's rule (`canSeeDecider`); unseen, it
 *    reads as the step's name. With no matching Approval only the roles that always see people get a name.
 *  - A Query action carries no attribution, so it can't be tied back to its message: only those roles,
 *    and the System's owner for their own (named) action, get a name; everyone else sees "A reviewer".
 *  - Anything else: the person's name ("Someone" if unknown).
 *
 * A System-less event (no System, so no owner) is only ever listed for the catalog roles, which always
 * see people; for anyone else it falls on the conservative side.
 */

const QUERY_ACTIONS: ChangeEventAction[] = ["QUERY_OPENED", "QUERY_REPLIED", "QUERY_RESOLVED"];
/** How close an Approval's decision time and its Change Event are (they are written in one transaction). */
const SAME_DECISION_MS = 60_000;

/** A Change Event plus the owner of its System (null for a System-less event). */
export type AttributableEvent = {
  action: ChangeEventAction;
  actorId: string;
  createdAt: Date;
  detail: string;
  systemId: string | null;
  systemOwnerId: string | null;
};

/** The client for the reads; pass the caller's transaction client so everything stays in its snapshot. */
export type AttributionDb = Pick<typeof prisma, "user" | "approval" | "reviewGroup">;

/** The pure part: what to call `event`'s actor, given the actor's name and the Approval it belongs to (if found). */
export function attributeEvent(
  viewer: { id: string; role: UserRole },
  event: AttributableEvent,
  actorName: string | undefined,
  viewerGroupIds: ReadonlySet<string>,
  approval: { reviewGroupId: string | null } | undefined,
): string {
  if (event.actorId === viewer.id) return "You";
  if (event.actorId === SYSTEM_ACTOR) return "The system";
  const named = actorName ?? "Someone";
  if (event.action === "APPROVAL_DECIDED") {
    const seen = approval && event.systemOwnerId !== null ? canSeeDecider(viewer, event.systemOwnerId, viewerGroupIds, approval) : viewerAlwaysSeesPeople(viewer.role);
    return seen ? named : event.detail.split(": ")[0];
  }
  if (QUERY_ACTIONS.includes(event.action)) {
    return viewerAlwaysSeesPeople(viewer.role) || event.actorId === event.systemOwnerId ? named : "A reviewer";
  }
  return named;
}

/**
 * Reads what the attribution needs (the actors' names, the Approvals behind the decisions, the viewer's
 * Review Groups, each once) and returns `who(event)`. Every query goes through `db`; the number of queries
 * doesn't depend on the number of events or Systems. `extraActorIds` are further people whose names the
 * caller wants in `nameOf` (the viewer's own is there too when `viewer.name` is given).
 */
export async function loadAttribution(
  viewer: { id: string; role: UserRole; name?: string },
  events: AttributableEvent[],
  db: AttributionDb,
  extraActorIds: string[] = [],
) {
  const personIds = [...new Set([...events.map((event) => event.actorId), ...extraActorIds].filter((id) => id !== SYSTEM_ACTOR && id !== viewer.id))];
  const people = personIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } });
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  if (viewer.name !== undefined) nameOf.set(viewer.id, viewer.name);

  const decisions = events.filter((event) => event.action === "APPROVAL_DECIDED" && event.actorId !== SYSTEM_ACTOR && event.systemId !== null);
  const decisionSystems = [...new Set(decisions.map((event) => event.systemId as string))];
  const decisionActors = [...new Set(decisions.map((event) => event.actorId))];
  const approvals =
    decisions.length === 0
      ? []
      : await db.approval.findMany({
          where: { systemId: { in: decisionSystems }, approverId: { in: decisionActors } },
          select: { systemId: true, approverId: true, reviewGroupId: true, decidedAt: true },
        });

  // The groups only matter to a non-owner who isn't one of the always-seeing roles, and only for decisions.
  const needsGroups = decisions.length > 0 && !viewerAlwaysSeesPeople(viewer.role) && decisions.some((event) => event.systemOwnerId !== viewer.id);
  const groups: ReadonlySet<string> = needsGroups ? new Set(await memberGroupIds(viewer.id, db)) : new Set<string>();

  const who = (event: AttributableEvent): string => {
    const approval =
      event.action === "APPROVAL_DECIDED"
        ? approvals
            .filter((candidate) => candidate.systemId === event.systemId && candidate.approverId === event.actorId && Math.abs(candidate.decidedAt.getTime() - event.createdAt.getTime()) <= SAME_DECISION_MS)
            .sort((a, b) => Math.abs(a.decidedAt.getTime() - event.createdAt.getTime()) - Math.abs(b.decidedAt.getTime() - event.createdAt.getTime()))[0]
        : undefined;
    return attributeEvent(viewer, event, nameOf.get(event.actorId), groups, approval);
  };
  return { who, nameOf };
}
