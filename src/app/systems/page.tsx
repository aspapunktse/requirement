import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystems } from "@/lib/system-visibility";
import { StatusChip } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";

export default async function SystemsPage() {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const systems = await getVisibleSystems(user);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl">Systems</h1>
        <Link
          href="/systems/new"
          className="self-start rounded-[var(--ems-radius-2)] border border-ems-amber-hover bg-ems-amber px-3 py-1 text-sm font-medium text-ems-ink-0 hover:bg-ems-amber-hover"
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
              <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500">
                <StatusChip tone={onboardingStatusTone(system.status)}>{system.status}</StatusChip>
                <span>
                  {system.deploymentFacets.map((facet) => facet.name).join(" + ")} · owned by{" "}
                  {system.owner.name}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
