import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { FrameworkManager } from "@/components/FrameworkManager";
import { loadCoverageSummaries } from "@/lib/framework-coverage";
import { canSeeDraftFrameworks } from "@/lib/frameworks";

export default async function FrameworksPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-rg-muted">Pick a user to act as first.</p>;
  }

  // A Compliance Manager or an Admin manages the whole catalog; a Framework Owner (#320) gets their own non-base
  // Frameworks, Drafts included, and the descriptive fields of each. Anyone else gets nothing.
  const catalogManager = canSeeDraftFrameworks(user);
  const frameworks = await prisma.framework.findMany({
    where: catalogManager ? {} : { ownerId: user.id, isBase: false },
    orderBy: [{ name: "asc" }, { version: "asc" }],
    include: { _count: { select: { requirements: true } } },
  });

  if (!catalogManager && frameworks.length === 0) {
    return <p className="p-6 text-rg-muted">Only Compliance Managers and Admins can manage the Framework catalog, and you don&apos;t own a Framework.</p>;
  }

  const summaries = await loadCoverageSummaries(frameworks.map((framework) => framework.id));

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl">Frameworks</h1>
      <FrameworkManager
        catalogManager={catalogManager}
        initialFrameworks={frameworks.map((framework) => ({
          id: framework.id,
          name: framework.name,
          version: framework.version,
          description: framework.description,
          strictComplianceRequired: framework.strictComplianceRequired,
          licensing: framework.licensing,
          supersedesId: framework.supersedesId,
          onboardingQuestion: framework.onboardingQuestion,
          onboardingHint: framework.onboardingHint,
          isBase: framework.isBase,
          status: framework.status,
          _count: framework._count,
          coverage: summaries[framework.id],
        }))}
      />
    </div>
  );
}
