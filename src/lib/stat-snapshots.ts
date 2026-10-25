import { prisma } from "@/lib/prisma";
import { roleView } from "@/app/home/role-view";
import { statNumber, utcDay } from "@/app/home/home-snapshots";
import { loadSystemRowsForCounts } from "@/app/systems/systems-data";
import { systemsSnapshotRows } from "@/app/systems/systems-trends";

/**
 * Recording the daily stat snapshots (#227). Run once a day by the Vercel cron at
 * `/api/cron/stat-snapshots`; read back by `withSnapshotTrends` in `src/app/home/home-snapshots.ts`.
 *
 * Product-owner defaults, each in one place so it can flip:
 * - The job runs from Vercel cron (see `vercel.json`).
 * - A snapshot is per User, because the figures differ by role and scope.
 * - Retention: every row is kept. If pruning is wanted, delete `StatSnapshot` rows whose `day` is older
 *   than `STAT_SNAPSHOT_RETENTION_DAYS`; a trend only reads the last 36 days, so 400 is generous.
 * - A day is the UTC date. Recording twice on one day keeps the first values (`skipDuplicates`).
 *
 * The Systems list (#232) has its own stat cards, recorded here too under `systems:<view>` keys (see
 * `src/app/systems/systems-trends.ts`), counted over the Systems that User sees, exactly as the page does.
 */
export const STAT_SNAPSHOT_RETENTION_DAYS: number | null = null;

export type StatSnapshotRun = { day: string; users: number; recorded: number; failedUsers: number };

/**
 * Records today's (UTC) figures for every User, exactly as `/home` computes them (`roleView`). A User
 * whose figures cannot be computed is skipped and counted; the others are still recorded. A second run on
 * the same day inserts nothing and changes nothing. `only` limits the run to those Users (tests).
 */
export async function recordStatSnapshots(now = new Date(), only?: { userIds: string[] }): Promise<StatSnapshotRun> {
  const day = utcDay(now);
  const users = await prisma.user.findMany({ ...(only && { where: { id: { in: only.userIds } } }), select: { id: true, name: true, role: true } });
  let recorded = 0;
  let failedUsers = 0;
  // One User at a time: roleView is a dozen queries and the serverless pool is small.
  for (const user of users) {
    let failed = false;
    try {
      const view = await roleView(user, now);
      const result = await prisma.statSnapshot.createMany({
        data: view.stats.map((stat) => ({ userId: user.id, role: user.role, statKey: stat.label, value: statNumber(stat), day })),
        skipDuplicates: true,
      });
      recorded += result.count;
    } catch (error) {
      failed = true;
      console.error(`stat snapshot failed for user ${user.id}`, error);
    }
    // A failure here must not lose the Home figures above, nor the other way round.
    try {
      const rows = await loadSystemRowsForCounts(user, now);
      const result = await prisma.statSnapshot.createMany({
        data: systemsSnapshotRows(rows).map(({ statKey, value }) => ({ userId: user.id, role: user.role, statKey, value, day })),
        skipDuplicates: true,
      });
      recorded += result.count;
    } catch (error) {
      failed = true;
      console.error(`systems stat snapshot failed for user ${user.id}`, error);
    }
    if (failed) failedUsers += 1;
  }
  return { day: day.toISOString().slice(0, 10), users: users.length, recorded, failedUsers };
}
