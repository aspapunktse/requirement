import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** The Review Groups `userId` is a member of. */
export async function memberGroupIds(userId: string, db: Pick<typeof prisma, "reviewGroup"> = prisma) {
  const groups = await db.reviewGroup.findMany({ where: { members: { some: { id: userId } } }, select: { id: true } });
  return groups.map((group) => group.id);
}

/**
 * Who decides a Review Step (CONTEXT.md): nobody on a System they own, even as an Admin; otherwise an
 * Admin any step, a Reviewer the base step (`reviewGroupId` null), a member of the group its step.
 * Being a Control Owner in the remit is no bar. Pure, given the user's group ids.
 */
export function userCanDecideStep(
  user: { id: string; role: UserRole },
  systemOwnerId: string,
  memberOf: Iterable<string>,
  reviewGroupId: string | null,
): boolean {
  if (user.id === systemOwnerId) return false;
  if (user.role === "ADMIN") return true;
  if (reviewGroupId === null) return user.role === "REVIEWER";
  return new Set(memberOf).has(reviewGroupId);
}

/** `userCanDecideStep`, looking up the user's groups. */
export async function canDecideStep(
  user: { id: string; role: UserRole },
  systemOwnerId: string,
  reviewGroupId: string | null,
  db: Pick<typeof prisma, "reviewGroup"> = prisma,
) {
  const groups = reviewGroupId === null ? [] : await memberGroupIds(user.id, db);
  return userCanDecideStep(user, systemOwnerId, groups, reviewGroupId);
}

/**
 * Whether `viewer` may see who decided an Approval. Only an Admin, an Internal Auditor or a
 * Compliance Manager always; otherwise the members of the deciding group for a group step and
 * Reviewers for the base step, but never the System's owner: the owner sees only the group
 * (CONTEXT.md, "A step decides as its group"). Return a function so the viewer's groups load once.
 */
export async function deciderVisibilityFor(
  viewer: { id: string; role: UserRole },
  systemOwnerId: string,
  // Pass a transaction client to read the viewer's groups in the caller's snapshot.
  db: Pick<typeof prisma, "reviewGroup"> = prisma,
) {
  const always = viewerAlwaysSeesPeople(viewer.role);
  const groups = always || viewer.id === systemOwnerId ? new Set<string>() : new Set(await memberGroupIds(viewer.id, db));
  return (approval: { reviewGroupId: string | null }): boolean => canSeeDecider(viewer, systemOwnerId, groups, approval);
}

/** The roles that see the person behind any attributed action (CONTEXT.md, "A step decides as its group"). */
export function viewerAlwaysSeesPeople(role: UserRole): boolean {
  return role === "ADMIN" || role === "INTERNAL_AUDITOR" || role === "COMPLIANCE_MANAGER";
}

/**
 * The pure rule behind `deciderVisibilityFor`, given the viewer's group ids, so a caller that spans
 * several Systems (different owners) can load the groups once and judge each Approval against its own
 * System's owner.
 */
export function canSeeDecider(
  viewer: { id: string; role: UserRole },
  systemOwnerId: string,
  viewerGroupIds: ReadonlySet<string>,
  approval: { reviewGroupId: string | null },
): boolean {
  if (viewerAlwaysSeesPeople(viewer.role)) return true;
  if (viewer.id === systemOwnerId) return false;
  return approval.reviewGroupId === null ? viewer.role === "REVIEWER" : viewerGroupIds.has(approval.reviewGroupId);
}
