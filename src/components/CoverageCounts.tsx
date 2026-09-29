import { StatusChip } from "@/components/ui/StatusChip";
import type { CoverageSummary } from "@/lib/coverage-state";

/**
 * The covered / gap / accepted counts of a Framework as one inline line, e.g.
 * "93/93 covered · 0 gaps · 0 accepted" (F-FW.6). Shared by both Framework lists.
 */
export function CoverageCounts({ summary }: { summary: CoverageSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
      <span>{`${summary.covered}/${summary.total} covered`}</span>
      <StatusChip tone={summary.gaps > 0 ? "danger" : "neutral"}>{`${summary.gaps} ${summary.gaps === 1 ? "gap" : "gaps"}`}</StatusChip>
      <span>{`${summary.accepted} accepted`}</span>
    </span>
  );
}
