import { getActingUser } from "@/lib/acting-user";
import { ControlLibraryManager } from "@/components/ControlLibraryManager";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";

export default async function ControlLibraryPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role)) {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Compliance Managers and Admins can author Controls and map them to Deployment
        Facets, Impact Levels, and Capabilities.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-4 text-2xl">Control Library</h1>
      <ControlLibraryManager />
    </div>
  );
}
