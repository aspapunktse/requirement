/**
 * The EMS "document brief" header: a mono breadcrumb, a mono page-id line, a
 * big sans title, a lede sentence, and an optional inline stat strip.
 * Ported pattern from aspapunktse/isms's Home · A prototype variant — see
 * issues #57 and #65. Reusable across future dashboard-style pages, not just
 * /home.
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
  return (
    <div className="mb-8 border-b border-zinc-300 pb-6 dark:border-zinc-700">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="ems-mono-label flex flex-wrap gap-x-2 text-ems-ink-3">
            {breadcrumb.map((crumb, index) => {
              const last = index === breadcrumb.length - 1;
              return (
                <li key={crumb} aria-current={last ? "page" : undefined} className={last ? "text-ems-ink-1" : ""}>
                  {index > 0 && <span aria-hidden> / </span>}
                  {crumb}
                </li>
              );
            })}
          </ol>
        </nav>
      )}
      <p className="ems-mono-label mb-3 text-ems-ink-3">{pageId}</p>
      <h1 className="mb-3 font-sans! text-4xl font-medium tracking-tight text-ems-ink-0 sm:text-[44px] sm:leading-[1.1]">
        {title}
      </h1>
      <p className="max-w-2xl text-ems-ink-2">{lede}</p>

      {stats && stats.length > 0 && (
        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-zinc-300 pt-4 dark:border-zinc-700">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="ems-mono-label text-ems-ink-4">{`// ${stat.label}`}</dt>
              <dd className="text-sm text-ems-ink-1">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
