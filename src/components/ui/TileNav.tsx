import Link from "next/link";

export type NavTile = {
  title: string;
  description: string;
  href: string;
  foot?: string;
  /** A tile for something that is not built yet: shown, never a link. */
  disabled?: boolean;
};

/**
 * The "Where to start" tile grid: pure navigation shortcuts (no count —
 * counted items belong in TaskTable instead). See issue #57.
 */
export function TileNav({ tiles }: { tiles: NavTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((tile, index) => {
        const content = (
          <>
            <span className="ems-mono-label text-ems-ink-4">{String(index + 1).padStart(2, "0")}</span>
            <span className="font-medium">{tile.title}</span>
            <p className="text-sm text-zinc-500">{tile.description}</p>
            {tile.foot && <p className="ems-mono-label mt-auto pt-2 text-ems-ink-4">{tile.foot}</p>}
          </>
        );
        if (tile.disabled) {
          return (
            <div
              key={tile.title}
              aria-disabled="true"
              className="flex flex-col gap-2 rounded-[var(--ems-radius-2)] border border-dashed border-zinc-200 p-4 opacity-60 dark:border-zinc-800"
            >
              {content}
            </div>
          );
        }
        return (
          <Link
            key={tile.href}
            href={tile.href}
            className="flex flex-col gap-2 rounded-[var(--ems-radius-2)] border border-zinc-200 p-4 hover:border-ems-amber-hover dark:border-zinc-800"
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}
