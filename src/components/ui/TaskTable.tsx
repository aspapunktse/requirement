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

const TH =
  "whitespace-nowrap border-b border-rg-line bg-rg-paper px-3.5 py-2.5 text-left text-xs font-bold tracking-[0.07em] text-rg-accent uppercase";
const TD = "border-b border-rg-line px-3.5 py-2.5 align-top group-last:border-b-0";

/**
 * The "My tasks" section: one status-row table unifying every kind of thing
 * that needs this role's attention (Systems, Risks, Assessment Queries),
 * instead of a separate card per concern. See issue #57. The Register table
 * scrolls sideways inside its own frame, never the page.
 */
export function TaskTable({ rows }: { rows: TaskRow[] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--rg-radius-lg)] border border-rg-line bg-rg-surface">
      {rows.length === 0 ? (
        <p className="px-3.5 py-6 text-sm text-rg-muted">Nothing needs your attention.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={TH}>
                Task
              </th>
              <th scope="col" className={TH}>
                Status
              </th>
              <th scope="col" className={TH}>
                Updated
              </th>
              <th scope="col" className={`${TH} text-right`}>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="group">
                <td className={TD}>
                  <span className="mr-2 text-xs font-bold tracking-[0.07em] text-rg-muted uppercase">{row.kind}</span>
                  <span className="font-semibold">{row.title}</span>
                  {row.subtitle && <p className="text-[13px] text-rg-muted">{row.subtitle}</p>}
                </td>
                <td className={TD}>
                  <StatusChip tone={row.tone}>{row.status}</StatusChip>
                </td>
                <td className={`${TD} whitespace-nowrap text-[13px] text-rg-muted [font-variant-numeric:tabular-nums]`}>
                  {row.updatedAt ? relativeTime(row.updatedAt) : "—"}
                </td>
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <Link href={row.href} className="font-semibold text-rg-accent no-underline hover:underline">
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
