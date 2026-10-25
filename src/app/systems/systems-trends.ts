import type { Prisma, UserRole } from "@prisma/client";
import { countByWeek, TREND_POINTS, weekEnds } from "@/app/home/home-trends";
import { readSnapshotPoints } from "@/app/home/home-snapshots";
import { SHOW_STAT_TRENDS } from "./systems-config";
import { viewCounts } from "./systems-logic";
import { VIEW_KEYS, type SystemRow, type ViewKey } from "./systems-types";

/**
 * The trend lines on the Systems list's stat cards (decision 2b on #232): the daily snapshots of
 * `recordStatSnapshots`, one per saved view and User, read back as Home reads its own
 * (`readSnapshotPoints`). The `statKey` carries a `systems:` prefix, which no Home stat label has, so the
 * two never collide.
 *
 * Before the first snapshot a point is derived from timestamps only where that is exact: All Systems for a
 * role that sees every System (the Systems that existed at the week end, by `createdAt`; one deleted since
 * is not counted back in, as for Home's own "Systems"). The other views, and All Systems for a role whose
 * visibility depends on a System's status or owner at the time, have no history to rebuild, so their line
 * starts at the first snapshot. The last point is always the live count.
 */

export const SYSTEMS_STAT_PREFIX = "systems:";

/** The `StatSnapshot.statKey` of a saved view's count. */
export const systemsStatKey = (view: ViewKey) => `${SYSTEMS_STAT_PREFIX}${view}`;

/** The numbers the daily job stores for a User: the saved views' counts under their own keys. */
export function systemsSnapshotRows(rows: SystemRow[]): { statKey: string; value: number }[] {
  const counts = viewCounts(rows);
  return VIEW_KEYS.map((view) => ({ statKey: systemsStatKey(view), value: counts[view] }));
}

/**
 * The lines to draw, by saved view: points oldest to newest ending at the live count, with the weeks that
 * have no value left out; a view with fewer than two points has no line. Runs on the caller's transaction.
 */
export async function loadSystemsTrends(
  tx: Prisma.TransactionClient,
  user: { id: string; role: UserRole },
  rows: SystemRow[],
  where: Prisma.SystemWhereInput,
  now: Date,
): Promise<Partial<Record<ViewKey, number[]>>> {
  if (!SHOW_STAT_TRENDS) return {};
  const live = viewCounts(rows);
  const snapshots = await readSnapshotPoints(user, VIEW_KEYS.map(systemsStatKey), now, tx);
  const recorded = new Map(snapshots.map((point) => [`${point.statKey}:${point.index}`, point.value]));

  // All Systems can be rebuilt from `createdAt` only when the role sees every System, whatever its status.
  const sawEverySystem = Object.keys(where).length === 0;
  const derivedAll = sawEverySystem
    ? countByWeek((await tx.system.findMany({ select: { createdAt: true } })).map((system) => ({ from: system.createdAt })), now)
    : null;

  const trends: Partial<Record<ViewKey, number[]>> = {};
  for (const view of VIEW_KEYS) {
    const points: (number | null)[] = weekEnds(now).map((_, index) => {
      if (index === TREND_POINTS - 1) return live[view];
      return recorded.get(`${systemsStatKey(view)}:${index}`) ?? (view === "all" ? (derivedAll?.[index] ?? null) : null);
    });
    const known = points.filter((value): value is number => value !== null);
    if (known.length >= 2) trends[view] = known;
  }
  return trends;
}
