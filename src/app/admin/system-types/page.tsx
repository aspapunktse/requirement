import { getActingUser } from "@/lib/acting-user";
import { SystemTypeManager } from "@/components/SystemTypeManager";

export default async function SystemTypesPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Admins can manage the System Type catalog.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl">System Types</h1>
      <SystemTypeManager />
    </div>
  );
}
