import Link from "next/link";

/**
 * A single shortcut on the role-differentiated landing page: a title, an
 * optional count (rendered even when 0, so the page's shape stays constant
 * across visits — see issue #54), a short description, and a link into the
 * relevant view. Generic enough to be reused by future dashboard-style pages.
 */
export function DashboardCard({
  title,
  description,
  count,
  href,
}: {
  title: string;
  description: string;
  count?: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-[var(--ems-radius-2)] border border-zinc-200 p-4 hover:border-ems-amber-hover dark:border-zinc-800"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{title}</span>
        {count !== undefined && <span className="text-2xl">{count}</span>}
      </div>
      <p className="text-sm text-zinc-500">{description}</p>
    </Link>
  );
}
