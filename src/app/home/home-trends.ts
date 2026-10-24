import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedSystemsWhere, getAssignedScope } from "@/lib/business-risk-owner";
import { visibleFrameworksWhere } from "@/lib/frameworks";
import { SYSTEM_RISK_WHERE } from "@/lib/risks";
import { SHOW_STAT_TRENDS } from "./home-config";

/**
 * Weekly trends for the stat cards' sparklines (product-owner decision on #226): seven points, the
 * oldest first and the last one "now", each the figure as it stood at the end of that week. No history
 * table exists, so every point is rebuilt from timestamps the rows already carry, and where a past value
 * cannot be known exactly the closest honest approximation is used. The rule of each figure is stated
 * beside it below; the pure helpers at the top are what the tests drive with controlled dates.
 */

export const TREND_POINTS = 7;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The seven week ends, oldest first, the last being `now`. */
export function weekEnds(now: Date): Date[] {
  return Array.from({ length: TREND_POINTS }, (_, i) => new Date(now.getTime() - (TREND_POINTS - 1 - i) * WEEK_MS));
}

/** How many of the spans exist at each week end: started on or before it and not ended by it. */
export function countByWeek(spans: { from: Date; to?: Date | null }[], now: Date): number[] {
  return weekEnds(now).map((end) => spans.filter((span) => span.from.getTime() <= end.getTime() && (!span.to || span.to.getTime() > end.getTime())).length);
}

/** The longest wait, in whole days, at each week end, among the starts on or before it. 0 when none was waiting. */
export function longestWaitByWeek(starts: Date[], now: Date): number[] {
  return weekEnds(now).map((end) =>
    starts.reduce((longest, start) => (start.getTime() <= end.getTime() ? Math.max(longest, Math.floor((end.getTime() - start.getTime()) / DAY_MS)) : longest), 0),
  );
}

/** A count that is re-asked at each week end (a `count` query on a creation timestamp). */
const perWeek = (now: Date, count: (end: Date) => Promise<number>) => Promise.all(weekEnds(now).map(count));

export type TrendInputs = {
  /** When each review the Reviewer is waiting on was submitted (latest Review Round). */
  reviewStarts?: Date[];
  /** The Systems the user owns that currently need attention. */
  attentionSystemIds?: string[];
  /** The Systems whose open Queries the "Open questions" figure counts; undefined means every System. */
  queryScope?: Prisma.SystemWhereInput;
};

/**
 * The trend of each headline figure that has one, by label. Approximations:
 * - Controls, Frameworks, Deployment facets, Users, Systems: rows that existed at the week end (by
 *   `createdAt`); a row deleted since is not counted back in.
 * - Onboarded systems: Systems currently Onboarded, by `onboardedAt` (`createdAt` when unset).
 * - Awaiting review: the reviews waiting now, by when their latest Review Round was submitted; a review
 *   decided since is not counted back in.
 * - Oldest waiting: the longest of those waits at each week end, same limitation.
 * - Needing attention: the Systems that need attention now, by when they were created. Whether they
 *   needed it earlier is not recorded.
 * - Open questions: Queries open at the week end (created by then, not resolved by then); this is every
 *   open Query on the figure's Systems, not only those where it is the user's turn.
 * - Open risks, Critical, Open risks in scope: Risks open now, by `createdAt`; a Risk closed since is
 *   not counted back in, so earlier points can only be too low.
 * - Draft Internal Audits: audits that are drafts now, by `createdAt` (one launched since is missed).
 * - Check-ups awaiting evaluation: exact, from the response, evaluation and withdrawal timestamps.
 */
export async function computeTrends(
  user: { id: string; role: UserRole },
  labels: string[],
  inputs: TrendInputs,
  now: Date,
): Promise<Record<string, number[]>> {
  if (!SHOW_STAT_TRENDS) return {};
  const wanted = new Set(labels);
  const out: Record<string, number[]> = {};
  const jobs: Promise<void>[] = [];
  const add = (label: string, make: () => Promise<number[]> | number[]) => {
    if (wanted.has(label)) jobs.push(Promise.resolve(make()).then((trend) => void (out[label] = trend)));
  };

  add("Controls", () => perWeek(now, (end) => prisma.control.count({ where: { createdAt: { lte: end } } })));
  add("Frameworks", () => perWeek(now, (end) => prisma.framework.count({ where: { AND: [visibleFrameworksWhere(user), { createdAt: { lte: end } }] } })));
  add("Deployment facets", () => perWeek(now, (end) => prisma.deploymentFacet.count({ where: { createdAt: { lte: end } } })));
  add("Users", () => perWeek(now, (end) => prisma.user.count({ where: { createdAt: { lte: end } } })));
  add("Systems", () => perWeek(now, (end) => prisma.system.count({ where: { createdAt: { lte: end } } })));
  add("Onboarded systems", () =>
    perWeek(now, (end) =>
      prisma.system.count({ where: { status: "ONBOARDED", OR: [{ onboardedAt: { lte: end } }, { onboardedAt: null, createdAt: { lte: end } }] } }),
    ),
  );
  add("Draft Internal Audits", async () =>
    countByWeek((await prisma.internalAudit.findMany({ where: { status: "DRAFT" }, select: { createdAt: true } })).map((audit) => ({ from: audit.createdAt })), now),
  );
  add("Check-ups awaiting evaluation", async () => {
    const checkUps = await prisma.checkUp.findMany({
      where: { internalAudit: { status: "LAUNCHED" }, response: { isNot: null } },
      select: { response: { select: { respondedAt: true } }, evaluation: { select: { evaluatedAt: true } }, withdrawal: { select: { withdrawnAt: true } } },
    });
    // Awaiting from the answer until the first of its evaluation or withdrawal.
    return countByWeek(
      checkUps.map((checkUp) => {
        const ends = [checkUp.evaluation?.evaluatedAt, checkUp.withdrawal?.withdrawnAt].filter((d): d is Date => !!d);
        return { from: checkUp.response!.respondedAt, to: ends.length > 0 ? new Date(Math.min(...ends.map((d) => d.getTime()))) : null };
      }),
      now,
    );
  });

  add("Awaiting review", () => countByWeek((inputs.reviewStarts ?? []).map((from) => ({ from })), now));
  add("Oldest waiting", () => longestWaitByWeek(inputs.reviewStarts ?? [], now));

  const attention = async () => {
    const systems = await prisma.system.findMany({ where: { id: { in: inputs.attentionSystemIds ?? [] } }, select: { createdAt: true } });
    return countByWeek(systems.map((system) => ({ from: system.createdAt })), now);
  };
  add("Needing attention", attention);
  add("Your Systems needing attention", attention);

  add("Open questions", async () => {
    const queries = await prisma.assessmentQuery.findMany({
      where: { controlAssessment: { system: inputs.queryScope ?? {} } },
      select: { createdAt: true, resolved: true, resolvedAt: true },
    });
    return countByWeek(queries.map((query) => ({ from: query.createdAt, to: query.resolved ? (query.resolvedAt ?? query.createdAt) : null })), now);
  });

  const openRisks = async (where: Prisma.RiskWhereInput) =>
    (await prisma.risk.findMany({ where: { status: "OPEN", ...where }, select: { createdAt: true } })).map((risk) => ({ from: risk.createdAt }));
  add("Open risks", async () => countByWeek(await openRisks({}), now));
  add("Critical", async () => countByWeek(await openRisks({ severity: "CRITICAL" }), now));
  add("Open risks in scope", async () => {
    const scope = await getAssignedScope(user.id);
    return countByWeek(await openRisks({ ...SYSTEM_RISK_WHERE, system: scopedSystemsWhere(scope) }), now);
  });

  await Promise.all(jobs);
  return out;
}
