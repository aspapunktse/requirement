import { getActingUser } from "@/lib/acting-user";
import { prisma } from "@/lib/prisma";
import { BusinessRiskOwnerDashboard } from "@/components/BusinessRiskOwnerDashboard";

export default async function BusinessRiskOwnerPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (user.role !== "BUSINESS_RISK_OWNER" && user.role !== "ADMIN") {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Business Risk Owners and Admins can view this dashboard.
      </p>
    );
  }

  const scoped = await prisma.user.findUnique({
    where: { id: user.id },
    include: { businessUnitScopes: true, frameworkScopes: true },
  });

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-2xl">Business Risk Owner Dashboard</h1>
      <p className="mb-4 text-sm text-zinc-500">
        Risks and compliance percentage for Systems within your assigned Business Unit(s) and Framework(s).
      </p>
      <BusinessRiskOwnerDashboard
        businessUnits={scoped?.businessUnitScopes ?? []}
        frameworks={scoped?.frameworkScopes ?? []}
      />
    </div>
  );
}
