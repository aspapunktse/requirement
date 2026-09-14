import { getActingUser } from "@/lib/acting-user";
import { DeploymentFacetManager } from "@/components/DeploymentFacetManager";

export default async function DeploymentFacetsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Admins can manage the Deployment Facet catalog.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">Deployment Facets</h1>
      <DeploymentFacetManager />
    </div>
  );
}
