import Link from "next/link";
import type { OnboardingStatus } from "@prisma/client";
import { getActingUser } from "@/lib/acting-user";
import { getVisibleSystems } from "@/lib/system-visibility";
import { getActionableQueryCountsBySystem } from "@/lib/requirement-queries";
import { StatusChip } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";

/**
 * Optional filters a caller (currently: landing-page shortcuts) can deep-link
 * with — `status` narrows to one OnboardingStatus, `owner=me` narrows to
 * Systems owned by the acting user. Both apply on top of the normal
 * visibility rules, never widening what a role can already see.
 */
export default async function SystemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; owner?: string }>;
}) {
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const { status, owner } = await searchParams;
  let systems = await getVisibleSystems(user);
  if (status) {
    systems = systems.filter((system) => system.status === (status as OnboardingStatus));
  }
  if (owner === "me") {
    systems = systems.filter((system) => system.ownerId === user.id);
  }

  const queryCounts = await getActionableQueryCountsBySystem(
    user,
    systems.map((s) => s.id),
  );

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
                {(queryCounts.get(system.id) ?? 0) > 0 && (
                  <StatusChip tone="warn">{queryCounts.get(system.id)} open question(s)</StatusChip>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
