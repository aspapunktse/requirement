import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { canCurateFramework, mappableControlsWhere, requirementInclude } from "@/lib/frameworks";
import { FrameworkRequirementsEditor } from "@/components/FrameworkRequirementsEditor";
import { FrameworkReviewGroup } from "@/components/FrameworkReviewGroup";
import { StatusChip } from "@/components/ui/StatusChip";

export default async function FrameworkDetailPage({ params }: PageProps<"/admin/frameworks/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  // The Framework's owner (non-base), a Compliance Manager or an Admin curates it (#320); for anyone else it does not exist here.
  const framework = await prisma.framework.findUnique({ where: { id } });
  if (!framework || !canCurateFramework(user, framework)) {
    return (
      <p className="p-6 text-rg-muted">
        Framework not found, or you can&apos;t author its Requirements: only its owner (not for the base Framework), a Compliance Manager or an Admin can.
      </p>
    );
  }

  const [requirements, controls, reviewGroups] = await Promise.all([
    prisma.requirement.findMany({
      where: { frameworkId: id },
      orderBy: [{ section: "asc" }, { code: "asc" }],
      include: requirementInclude,
    }),
    prisma.control.findMany({
      // A Framework Owner doesn't see the Supplementary Controls of other Draft Frameworks.
      where: mappableControlsWhere(user, id),
      orderBy: { code: "asc" },
      select: { id: true, code: true, title: true },
    }),
    prisma.reviewGroup.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="mb-2 text-sm">
        <Link href="/admin/frameworks" className="text-ems-blue hover:underline">
          &larr; Frameworks
        </Link>
      </p>
      <h1 className="mb-1 text-2xl">{frameworkLabel(framework)}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-rg-muted">
        <StatusChip tone={framework.status === "PUBLISHED" ? "success" : "warn"}>
          {framework.status === "PUBLISHED" ? "Published" : "Draft"}
        </StatusChip>
        {framework.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
        <span>{framework.licensing === "PARAPHRASE_ONLY" ? "Paraphrase only" : "Quotable"}</span>
        <span>· {requirements.length} Requirements</span>
      </p>
      {framework.status === "DRAFT" && (
        <p className="mb-4 text-sm text-rg-muted">
          This Framework is a Draft: only its owner, Compliance Managers and Admins can see it, and it can&apos;t be put in a
          System&apos;s Framework Scope until it is published from the Frameworks page.
        </p>
      )}
      <FrameworkReviewGroup
        frameworkId={framework.id}
        isBase={framework.isBase}
        groups={reviewGroups.map((group) => ({ id: group.id, name: group.name, memberCount: group._count.members }))}
        initialReviewGroupId={framework.reviewGroupId}
        canOpenGroup={user.role === "ADMIN"}
      />
      <FrameworkRequirementsEditor
        frameworkId={framework.id}
        licensing={framework.licensing}
        initialRequirements={requirements}
        controls={controls}
      />
    </div>
  );
}
