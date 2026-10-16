import Link from "next/link";

export type NavTile = {
  title: string;
  description: string;
  href: string;
  foot?: string;
  /** A tile for something that is not built yet: shown, never a link. */
  disabled?: boolean;
};

const TILE =
  "grid content-start gap-1.5 rounded-[var(--rg-radius-lg)] border border-rg-line bg-rg-surface px-3.5 py-3 text-rg-ink no-underline";

/**
 * The "Where to start" tile grid: pure navigation shortcuts (no count —
 * counted items belong in TaskTable instead). See issue #57.
 */
export function TileNav({ tiles }: { tiles: NavTile[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2">
      {tiles.map((tile) => {
        const content = (
          <>
            <span className="font-semibold">{tile.title}</span>
            <p className="text-[13px] text-rg-muted">{tile.description}</p>
            {tile.foot && <p className="text-[13px] text-rg-muted">{tile.foot}</p>}
          </>
        );
        if (tile.disabled) {
          return (
            <div key={tile.title} aria-disabled="true" className={`${TILE} border-dashed opacity-60`}>
              {content}
            </div>
          );
        }
        return (
          <Link key={tile.href} href={tile.href} className={`${TILE} hover:border-rg-accent`}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}
