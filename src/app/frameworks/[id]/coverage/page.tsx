import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, visibleFrameworksWhere } from "@/lib/frameworks";
import { loadFrameworkCoverage } from "@/lib/framework-coverage";
import { FrameworkCoverageView } from "@/components/FrameworkCoverageView";
import { StatusChip } from "@/components/ui/StatusChip";

export default async function FrameworkCoveragePage({ params }: PageProps<"/frameworks/[id]/coverage">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  // A Draft Framework is invisible (same as not found) to anyone but Compliance Managers and Admins.
  const framework = await prisma.framework.findFirst({ where: { id, ...visibleFrameworksWhere(user) } });
  if (!framework) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Framework not found.</p>;
  }

  const coverage = await loadFrameworkCoverage(id);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="mb-2 text-sm">
        <Link href="/frameworks" className="text-ems-blue hover:underline">
          &larr; Frameworks
        </Link>
      </p>
      <h1 className="mb-1 text-2xl">{`${frameworkLabel(framework)} coverage`}</h1>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
        <StatusChip tone={framework.status === "PUBLISHED" ? "success" : "warn"}>
          {framework.status === "PUBLISHED" ? "Published" : "Draft"}
        </StatusChip>
        {framework.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
        <span>Which Requirements the Control Library covers, and which it doesn&apos;t.</span>
      </p>
      <FrameworkCoverageView
        framework={{ id: framework.id, name: framework.name, version: framework.version }}
        initialSummary={coverage.summary}
        initialRequirements={coverage.requirements}
        canCurate={canSeeDraftFrameworks(user)}
      />
    </div>
  );
}
