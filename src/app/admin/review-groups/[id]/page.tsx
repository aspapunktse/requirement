import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";
import { loadReviewGroup } from "@/lib/review-groups";
import { ReviewGroupEditor } from "@/components/ReviewGroupEditor";

export default async function ReviewGroupPage({ params }: PageProps<"/admin/review-groups/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_CATALOG.includes(user.role)) {
    return <p className="p-6 text-rg-muted">Only Admins can manage Review Groups.</p>;
  }

  const [group, users, frameworks] = await Promise.all([
    loadReviewGroup(id),
    // An Internal Auditor can't be a member, so they are not offered.
    prisma.user.findMany({
      where: { role: { not: "INTERNAL_AUDITOR" } },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    // The base Framework can't be tied.
    prisma.framework.findMany({
      where: { isBase: false },
      select: { id: true, name: true, version: true, reviewGroupId: true },
      orderBy: [{ name: "asc" }, { version: "asc" }],
    }),
  ]);

  if (!group) {
    return <p className="p-6 text-rg-muted">Review Group not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <p className="mb-2 text-sm">
        <Link href="/admin/review-groups" className="text-rg-accent hover:underline">
          &larr; Review Groups
        </Link>
      </p>
      <h1 className="mb-4 text-2xl">{group.name}</h1>
      <ReviewGroupEditor initialGroup={group} users={users} frameworks={frameworks} />
    </div>
  );
}
