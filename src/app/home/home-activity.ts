import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { CHANGE_EVENT_ACTION_LABEL, CHANGE_EVENT_ACTION_TONE } from "@/lib/change-event-labels";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { ACTIVITY_DAYS, ACTIVITY_MAX, SHOW_ACTIVITY } from "./home-config";
import type { HomeActivity } from "./home-types";

/**
 * The roles that also see the System-less Change Events (requirement-database changes, the
 * Organization's own Control implementations, Check-up evaluations): the ones that curate or read
 * the whole catalog. Conservative by design (product-owner answer pending on #226): every other role
 * sees the events of the Systems it can see and nothing else.
 */
export const CATALOG_ACTIVITY_ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"];

const DAY_MS = 86_400_000;

/**
 * The last `ACTIVITY_DAYS` days of Change Events the user may see, newest first, at most
 * `ACTIVITY_MAX`: those of the Systems `visibleSystemsWhere` lets them read, plus the System-less ones
 * for `CATALOG_ACTIVITY_ROLES`. The reads share one RepeatableRead snapshot, every query on `tx`.
 */
export async function loadRecentActivity(user: { id: string; role: UserRole }, now = new Date()): Promise<HomeActivity[]> {
  if (!SHOW_ACTIVITY) return [];
  const visible = await visibleSystemsWhere(user);
  const scope: Prisma.ChangeEventWhereInput[] = [{ system: { is: visible } }];
  if (CATALOG_ACTIVITY_ROLES.includes(user.role)) scope.push({ systemId: null });
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS);

  return prisma.$transaction(
    async (tx) => {
      const events = await tx.changeEvent.findMany({
        where: { createdAt: { gte: since }, OR: scope },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ACTIVITY_MAX,
        include: { system: { select: { id: true, name: true } } },
      });
      const actorIds = [...new Set(events.map((event) => event.actorId).filter((id) => id !== SYSTEM_ACTOR && id !== user.id))];
      const actors = actorIds.length === 0 ? [] : await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
      const nameById = new Map(actors.map((actor) => [actor.id, actor.name]));

      return events.map(
        (event): HomeActivity => ({
          id: event.id,
          who: event.actorId === user.id ? "You" : event.actorId === SYSTEM_ACTOR ? "The system" : (nameById.get(event.actorId) ?? "Someone"),
          what: CHANGE_EVENT_ACTION_LABEL[event.action],
          ...(event.system && { target: event.system.name, href: `/systems/${event.system.id}` }),
          days: Math.max(0, Math.floor((now.getTime() - event.createdAt.getTime()) / DAY_MS)),
          tone: CHANGE_EVENT_ACTION_TONE[event.action],
        }),
      );
    },
    { isolationLevel: "RepeatableRead" },
  );
}
