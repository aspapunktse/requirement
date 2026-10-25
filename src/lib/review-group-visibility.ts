import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { memberGroupIds } from "@/lib/approvals";

/**
 * MEMBER_VISIBILITY_IN_201: the Systems a Review Group member can see only because they are a member
 * (product-owner decision on #201, widening #199's): every System, in any status, that has a Framework
 * of one of the user's groups in its *declared* Framework Scope, whatever that Framework's own status.
 *
 * It is the one place this rule lives; `visibleSystemsWhere` adds it to what a role already shows.
 * A base Framework can never have a Review Group, so it never widens anything. Null when the user is
 * in no group (nothing to add).
 */
export async function reviewGroupScopeWhere(
  userId: string,
  // Pass a transaction client to read in the caller's snapshot.
  db: Pick<Prisma.TransactionClient, "reviewGroup"> = prisma,
): Promise<Prisma.SystemWhereInput | null> {
  const groupIds = await memberGroupIds(userId, db);
  if (groupIds.length === 0) return null;
  return { frameworkScopes: { some: { reviewGroupId: { in: groupIds } } } };
}
