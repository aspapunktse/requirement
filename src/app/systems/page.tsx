import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystems } from "@/lib/system-visibility";

export default async function SystemsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const systems = await getVisibleSystems(user);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Systems</h1>
        <Link
          href="/systems/new"
          className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          New System
        </Link>
      </div>

      {systems.length === 0 ? (
        <p className="text-sm text-zinc-500">No Systems to show yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {systems.map((system) => (
            <li key={system.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <Link href={`/systems/${system.id}`} className="font-medium hover:underline">
                {system.name}
              </Link>
              <div className="text-sm text-zinc-500">
                {system.status} · {system.systemType.name} · owned by {system.owner.name}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
