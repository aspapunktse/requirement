import Link from "next/link";

/**
 * A single shortcut on the role-differentiated landing page: a title, an
 * optional count (rendered even when 0, so the page's shape stays constant
 * across visits — see issue #54), a short description, and a link into the
 * relevant view. Generic enough to be reused by future dashboard-style pages.
 * Same tile look as TileNav.
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
      className="grid content-start gap-1.5 rounded-[var(--rg-radius-lg)] border border-rg-line bg-rg-surface px-3.5 py-3 text-rg-ink no-underline hover:border-rg-accent"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {count !== undefined && (
          <span className="text-2xl font-bold text-rg-accent [font-variant-numeric:tabular-nums]">{count}</span>
        )}
      </div>
      <p className="text-[13px] text-rg-muted">{description}</p>
    </Link>
  );
}
