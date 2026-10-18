import { prisma } from "@/lib/prisma";
import { groupsWithRemit } from "@/lib/review-steps";

/**
 * MEMBER_VISIBILITY_IN_199: the Systems a Review Group member can see only because they are a member
 * (product-owner decision on #199): each System In Review whose live Review Steps include a step of
 * one of the user's groups (an open step, or one already decided in the current round).
 *
 * This is deliberately the narrowest rule that lets a member decide their step. #201 widens it to every
 * System with one of the group's Frameworks in scope, in any status; change it here and nowhere else.
 */
export async function systemIdsWithLiveStepFor(userId: string): Promise<string[]> {
  const groups = await prisma.reviewGroup.findMany({ where: { members: { some: { id: userId } } }, select: { id: true } });
  if (groups.length === 0) return [];
  const groupIds = new Set(groups.map((group) => group.id));
  return prisma.$transaction(
    async (tx) => {
      // A live step needs one of the group's Frameworks in the System's declared scope: a cheap pre-filter.
      const candidates = await tx.system.findMany({
        where: { status: "IN_REVIEW", frameworkScopes: { some: { reviewGroupId: { in: [...groupIds] } } } },
        include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
      });
      const ids: string[] = [];
      for (const system of candidates) {
        const live = await groupsWithRemit(tx, system);
        if ([...live.keys()].some((id) => groupIds.has(id))) ids.push(system.id);
      }
      return ids;
    },
    { isolationLevel: "RepeatableRead" },
  );
}
