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

/**
 * Replaces the derived value of every past point of `trends` that has a snapshot for `userId`, in one query.
 * Only that User's own snapshots are read. Returns new arrays; `trends` is not changed.
 */
export async function withSnapshotTrends(userId: string, trends: Record<string, number[]>, now: Date): Promise<Record<string, number[]>> {
  const labels = Object.keys(trends);
  if (labels.length === 0) return trends;
  const days = weekEnds(now).map((end) => utcDay(end).getTime());
  const rows = await prisma.statSnapshot.findMany({
    where: { userId, statKey: { in: labels }, day: { in: days.slice(0, TREND_POINTS - 1).map((ms) => new Date(ms)) } },
    select: { statKey: true, day: true, value: true },
  });
  if (rows.length === 0) return trends;
  const out: Record<string, number[]> = {};
  for (const [label, points] of Object.entries(trends)) out[label] = [...points];
  for (const row of rows) {
    const index = days.indexOf(row.day.getTime());
    // The last point is the live value, never a snapshot.
    if (index >= 0 && index < TREND_POINTS - 1) out[row.statKey][index] = row.value;
  }
  return out;
}
