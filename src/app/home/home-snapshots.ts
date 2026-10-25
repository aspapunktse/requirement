import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { HomeStat } from "./home-types";
import { TREND_POINTS, weekEnds } from "./home-trends";

/**
 * Reading the daily stat snapshots (#227) into the stat cards' trends. A past week-end point uses the
 * snapshot of that User and stat on exactly that UTC day when one was recorded, and otherwise keeps the
 * value `computeTrends` derived from timestamps. The last point is always the live value.
 */

/** The UTC calendar day of an instant, as the midnight-UTC Date stored in `StatSnapshot.day`. */
export function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The number a stat card's snapshot stores: its value, or for "Oldest waiting" its days ("none" is 0). */
export function statNumber(stat: Pick<HomeStat, "value">): number {
  if (typeof stat.value === "number") return Math.round(stat.value);
  const days = Number.parseInt(stat.value, 10);
  return Number.isFinite(days) ? days : 0;
}

/** What the snapshot reads go through: the shared client, or a transaction client for one snapshot. */
type SnapshotDb = Pick<Prisma.TransactionClient, "statSnapshot">;

/**
 * The recorded snapshots of `user` under the keys `statKeys` for the past week-end days of a trend, in one
 * query: `index` is the position in the seven-point trend (0 is the oldest; the last point is the live value,
 * never read here). Only that User's own snapshots taken under their current role are read: a role change can
 * change what a figure counts.
 */
export async function readSnapshotPoints(
  user: { id: string; role: UserRole },
  statKeys: string[],
  now: Date,
  db: SnapshotDb = prisma,
): Promise<{ statKey: string; index: number; value: number }[]> {
  if (statKeys.length === 0) return [];
  const days = weekEnds(now).map((end) => utcDay(end).getTime());
  const rows = await db.statSnapshot.findMany({
    where: { userId: user.id, role: user.role, statKey: { in: statKeys }, day: { in: days.slice(0, TREND_POINTS - 1).map((ms) => new Date(ms)) } },
    select: { statKey: true, day: true, value: true },
  });
  return rows.flatMap((row) => {
    const index = days.indexOf(row.day.getTime());
    return index >= 0 && index < TREND_POINTS - 1 ? [{ statKey: row.statKey, index, value: row.value }] : [];
  });
}

/**
 * Replaces the derived value of every past point of `trends` that has a snapshot for `userId`, in one query.
 * Returns new arrays; `trends` is not changed.
 */
export async function withSnapshotTrends(user: { id: string; role: UserRole }, trends: Record<string, number[]>, now: Date): Promise<Record<string, number[]>> {
  const labels = Object.keys(trends);
  if (labels.length === 0) return trends;
  const points = await readSnapshotPoints(user, labels, now);
  if (points.length === 0) return trends;
  const out: Record<string, number[]> = {};
  for (const [label, values] of Object.entries(trends)) out[label] = [...values];
  for (const point of points) out[point.statKey][point.index] = point.value;
  return out;
}
