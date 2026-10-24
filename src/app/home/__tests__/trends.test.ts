import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { countByWeek, longestWaitByWeek, weekEnds } from "../home-trends";
import { roleView } from "../role-view";

const DAY = 86_400_000;
const now = new Date("2026-10-24T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

describe("weekly trends for the stat cards (#226)", () => {
  it("has seven week ends, oldest first, the last being now", () => {
    const ends = weekEnds(now);
    expect(ends).toHaveLength(7);
    expect(ends[6].getTime()).toBe(now.getTime());
    expect(ends[0].getTime()).toBe(now.getTime() - 42 * DAY);
  });

  it("counts what existed at each week end", () => {
    // Week ends are 42, 35, 28, 21, 14, 7 and 0 days back.
    const trend = countByWeek([{ from: ago(50) }, { from: ago(30) }, { from: ago(10) }, { from: ago(1) }], now);
    expect(trend).toEqual([1, 1, 2, 2, 2, 3, 4]);
  });

  it("stops counting a span once it has ended", () => {
    const trend = countByWeek([{ from: ago(40), to: ago(20) }], now);
    expect(trend).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });

  it("reads the longest wait in days at each week end", () => {
    // Submitted 20 days ago: not yet waiting at the first four week ends, then 6, 13 and 20 days.
    expect(longestWaitByWeek([ago(20)], now)).toEqual([0, 0, 0, 0, 6, 13, 20]);
    expect(longestWaitByWeek([], now)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  describe("derived from the rows' timestamps", () => {
    const suffix = `${process.pid}-${Date.now()}`;
    const emails: string[] = [];
    const systemIds: string[] = [];

    afterAll(async () => {
      await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
    });

    it("rebuilds the Onboarded systems trend from onboardedAt", async () => {
      const email = `test-home-trend-${suffix}@example.com`;
      emails.push(email);
      const viewer = await prisma.user.create({ data: { email, name: "Test Trend viewer", role: "VIEWER" } });
      const real = new Date();
      for (const [name, days] of [["a", 30], ["b", 10]] as const) {
        const system = await prisma.system.create({
          data: { name: `Test Trend ${name} ${suffix}`, ownerId: viewer.id, status: "ONBOARDED", onboardedAt: new Date(real.getTime() - days * DAY) },
        });
        systemIds.push(system.id);
      }
      const view = await roleView(viewer, real);
      const trend = view.stats.find((stat) => stat.label === "Onboarded systems")?.trend as number[];
      expect(trend).toHaveLength(7);
      // 30 days back falls between the 5th and 4th week ends from now (35 and 28 days back); 10 days between 14 and 7.
      expect(trend[2] - trend[1]).toBeGreaterThanOrEqual(1);
      expect(trend[5] - trend[4]).toBeGreaterThanOrEqual(1);
      expect(trend[6]).toBeGreaterThanOrEqual(2);
    });
  });
});
