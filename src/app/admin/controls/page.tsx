import { getActingUser } from "@/lib/acting-user";
import { ControlLibraryManager } from "@/components/ControlLibraryManager";

export default async function ControlLibraryPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (user.role !== "ADMIN") {
    return (
      <p className="p-6 text-zinc-600 dark:text-zinc-400">
        Only Admins can author Controls and map them to Deployment Facets, Regulatory
        Overlays, Impact Levels, and Capabilities.
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
