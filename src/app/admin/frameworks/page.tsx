import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { FrameworkManager } from "@/components/FrameworkManager";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";

export default async function FrameworksPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Only Compliance Managers and Admins can manage the Framework catalog.</p>;
  }

  const frameworks = await prisma.framework.findMany({
    orderBy: [{ name: "asc" }, { version: "asc" }],
    include: { _count: { select: { requirements: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl">Frameworks</h1>
      <FrameworkManager
        initialFrameworks={frameworks.map((framework) => ({
          id: framework.id,
          name: framework.name,
          version: framework.version,
          description: framework.description,
          strictComplianceRequired: framework.strictComplianceRequired,
          licensing: framework.licensing,
          supersedesId: framework.supersedesId,
          isBase: framework.isBase,
          status: framework.status,
          _count: framework._count,
        }))}
      />
    </div>
  );
}
