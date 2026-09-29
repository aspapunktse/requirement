import Link from "next/link";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { relativeTime } from "@/lib/format";

export type TaskRow = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  tone: ChipTone;
  status: string;
  updatedAt?: Date;
  href: string;
};

/**
 * The "My tasks" section: one status-row table unifying every kind of thing
 * that needs this role's attention (Systems, Risks, Assessment Queries),
 * instead of a separate card per concern. See issue #57.
 */
export function TaskTable({ rows }: { rows: TaskRow[] }) {
  return (
    <div className="overflow-hidden rounded-[var(--ems-radius-2)] border border-zinc-200 dark:border-zinc-800">
      <div className="ems-mono-label hidden grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-zinc-200 bg-ems-paper-2 px-4 py-2 text-ems-ink-3 sm:grid dark:border-zinc-800">
        <span>Task</span>
        <span>Status</span>
        <span>Updated</span>
        <span className="text-right">Action</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-zinc-500">Nothing needs your attention.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-1 items-center gap-2 border-b border-zinc-200 px-4 py-3 last:border-b-0 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-4 dark:border-zinc-800"
            >
              <div>
                <span className="ems-mono-label mr-2 text-ems-ink-4">{row.kind}</span>
                <span className="font-medium">{row.title}</span>
                {row.subtitle && <p className="text-sm text-zinc-500">{row.subtitle}</p>}
              </div>
              <span>
                <StatusChip tone={row.tone}>{row.status}</StatusChip>
              </span>
              <span className="text-sm text-zinc-500">
                {row.updatedAt ? relativeTime(row.updatedAt) : "—"}
              </span>
              <Link href={row.href} className="text-sm font-medium text-ems-brand-blue hover:underline sm:text-right">
                View →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
