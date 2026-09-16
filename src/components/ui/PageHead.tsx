/**
 * The EMS "document brief" header: a mono page-id line, a big serif title, a
 * lede sentence, and an optional stat strip of up to 4 headline numbers.
 * Ported pattern from aspapunktse/isms's Home · A prototype variant — see
 * issue #57. Reusable across future dashboard-style pages, not just /home.
 */
export function PageHead({
  pageId,
  title,
  lede,
  stats,
}: {
  pageId: string;
  title: string;
  lede: string;
  stats?: { label: string; value: number | string }[];
}) {
  return (
    <div className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
      <p className="ems-mono-label mb-3 text-ems-ink-3">{pageId}</p>
      <h1 className="mb-2 font-[family-name:var(--ems-font-serif)] text-3xl text-ems-ink-0 dark:text-ems-ink-0">
        {title}
      </h1>
      <p className="max-w-2xl text-sm text-ems-ink-3">{lede}</p>

      {stats && stats.length > 0 && (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <p className="ems-mono-label text-ems-ink-4">{stat.label}</p>
              <p className="text-2xl text-ems-ink-0">{stat.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
