/**
 * The Register page head: a mono eyebrow in accent that names the place, a
 * display title, a muted lede, and an optional strip of headline figures.
 * The eyebrow is the breadcrumb joined with " / "; a page with no breadcrumb
 * shows its `pageId` there instead. Reusable across dashboard-style pages,
 * not just /home (issues #57, #65, #181).
 */
export function PageHead({
  breadcrumb,
  pageId,
  title,
  lede,
  stats,
}: {
  breadcrumb?: string[];
  pageId: string;
  title: string;
  lede: string;
  stats?: { label: string; value: number | string }[];
}) {
  const eyebrow = breadcrumb && breadcrumb.length > 0 ? breadcrumb.join(" / ") : pageId;

  return (
    <div className="mb-8 grid gap-2" data-page-id={pageId}>
      <p className="font-mono text-[12.5px] leading-[18px] font-bold tracking-[0.06em] text-rg-accent">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="max-w-[68ch] text-[17px] leading-[27px] text-rg-muted">{lede}</p>

      {stats && stats.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-7 gap-y-2">
          {stats.map((stat) => (
            <div key={stat.label} className="grid">
              <dd className="order-first text-[26px] leading-[30px] font-bold text-rg-accent [font-variant-numeric:tabular-nums]">
                {stat.value}
              </dd>
              <dt className="text-[13px] text-rg-muted">{stat.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
