import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const FULL_VISIBILITY_ROLES: UserRole[] = ["ADMIN", "RISK_OWNER", "REVIEWER"];

/**
 * The Prisma `where` clause for Systems a given user is allowed to see:
 * ADMIN/RISK_OWNER/REVIEWER see every System in every status; everyone
 * else sees Systems they own (any status) plus every ONBOARDED System.
 */
export function visibleSystemsWhere(user: { id: string; role: UserRole }): Prisma.SystemWhereInput {
  if (FULL_VISIBILITY_ROLES.includes(user.role)) {
    return {};
  }
  return { OR: [{ ownerId: user.id }, { status: "ONBOARDED" }] };
}

const SYSTEM_SUMMARY_INCLUDE = { deploymentFacets: true, owner: true } satisfies Prisma.SystemInclude;

/** Every System the given user is allowed to see, newest first. */
export function getVisibleSystems(user: { id: string; role: UserRole }) {
  return prisma.system.findMany({
    where: visibleSystemsWhere(user),
    include: SYSTEM_SUMMARY_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/** One System by id, or null if it doesn't exist or the user can't see it. */
export function getVisibleSystem(user: { id: string; role: UserRole }, id: string) {
  return prisma.system.findFirst({
    where: { id, ...visibleSystemsWhere(user) },
    include: SYSTEM_SUMMARY_INCLUDE,
  });
}
