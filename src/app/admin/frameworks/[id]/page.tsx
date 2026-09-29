import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { frameworkLabel } from "@/lib/framework-label";
import { requirementInclude } from "@/lib/frameworks";
import { FrameworkRequirementsEditor } from "@/components/FrameworkRequirementsEditor";
import { StatusChip } from "@/components/ui/StatusChip";

export default async function FrameworkDetailPage({ params }: PageProps<"/admin/frameworks/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role)) {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Compliance Managers and Admins can author a Framework&apos;s Requirements.
      </p>
    );
  }

  const [framework, requirements, controls] = await Promise.all([
    prisma.framework.findUnique({ where: { id } }),
    prisma.requirement.findMany({
      where: { frameworkId: id },
      orderBy: [{ section: "asc" }, { code: "asc" }],
      include: requirementInclude,
    }),
    prisma.control.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, title: true } }),
  ]);

  if (!framework) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Framework not found.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="mb-2 text-sm">
        <Link href="/admin/frameworks" className="text-ems-blue hover:underline">
          &larr; Frameworks
        </Link>
      </p>
      <h1 className="mb-1 text-2xl">{frameworkLabel(framework)}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
        <StatusChip tone={framework.status === "PUBLISHED" ? "success" : "warn"}>
          {framework.status === "PUBLISHED" ? "Published" : "Draft"}
        </StatusChip>
        {framework.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
        <span>{framework.licensing === "PARAPHRASE_ONLY" ? "Paraphrase only" : "Quotable"}</span>
        <span>· {requirements.length} Requirements</span>
      </p>
      {framework.status === "DRAFT" && (
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          This Framework is a Draft: only Compliance Managers and Admins can see it, and it can&apos;t be put in a
          System&apos;s Framework Scope until it is published from the Frameworks page.
        </p>
      )}
      <FrameworkRequirementsEditor
        frameworkId={framework.id}
        licensing={framework.licensing}
        initialRequirements={requirements}
        controls={controls}
      />
    </div>
  );
}
