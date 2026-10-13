import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, visibleFrameworksWhere } from "@/lib/frameworks";
import { buildLineages } from "@/lib/framework-lineage";
import { FrameworkLineage } from "@/components/FrameworkLineage";
import { loadCoverageSummaries } from "@/lib/framework-coverage";
import { CoverageCounts } from "@/components/CoverageCounts";
import { StatusChip } from "@/components/ui/StatusChip";

/** Read-only Framework list for every signed-in user, with covered/gap counts and a link to each Coverage view. */
export default async function FrameworksOverviewPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  // Draft Frameworks only show up for Compliance Managers and Admins.
  const frameworks = await prisma.framework.findMany({
    where: visibleFrameworksWhere(user),
    orderBy: [{ name: "asc" }, { version: "asc" }],
  });
  const summaries = await loadCoverageSummaries(frameworks.map((framework) => framework.id));
  // The lineage follows supersedes links through Drafts this user can't see before filtering them out (#146);
  // only the filtered result is rendered, so a hidden Draft's name and version never leave the server.
  const lineages = buildLineages(
    await prisma.framework.findMany({ select: { id: true, name: true, version: true, status: true, supersedesId: true } }),
    canSeeDraftFrameworks(user),
  );

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl">Frameworks</h1>
      <p className="mb-4 text-sm text-zinc-500">
        How well the Control Library covers each Framework&apos;s Requirements.
      </p>
      {frameworks.length === 0 ? (
        <p className="text-sm text-zinc-500">No Frameworks yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {frameworks.map((framework) => (
            <li key={framework.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{frameworkLabel(framework)}</span>
                <StatusChip tone={framework.status === "PUBLISHED" ? "success" : "warn"}>
                  {framework.status === "PUBLISHED" ? "Published" : "Draft"}
                </StatusChip>
                {framework.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
                <Link
                  href={`/frameworks/${framework.id}/coverage`}
                  className="ml-auto text-ems-blue hover:underline"
                  aria-label={`Coverage of ${frameworkLabel(framework)}`}
                >
                  Coverage &rarr;
                </Link>
              </div>
              <div className="mt-1">
                <CoverageCounts summary={summaries[framework.id]} />
              </div>
              {lineages.has(framework.id) && (
                <div className="mt-1">
                  <FrameworkLineage paths={lineages.get(framework.id)!} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
