import { describe, expect, it } from "vitest";
import { answerSummary, groupCheckUps, isDone, matchesStateFilter, pickedCheckUp, type GroupableCheckUp } from "../internal-audit-detail-rules";

const cu = (id: string, state: GroupableCheckUp["state"], code: string, target: GroupableCheckUp["target"], recipient: GroupableCheckUp["recipient"]): GroupableCheckUp => ({
  id,
  state,
  control: { code, title: `Title ${code}` },
  target,
  recipient,
});
const sys = (id: string, name: string) => ({ kind: "system" as const, id, name });
const ana = { id: "u1", name: "Ana" };
const bo = { id: "u2", name: "Bo" };

const all = [
  cu("1", "evaluated", "A.5.10", sys("s2", "Wiki"), bo),
  cu("2", "notAnswered", "A.5.2", sys("s1", "Payroll"), ana),
  cu("3", "withdrawn", "A.5.2", { kind: "organization" }, null),
  cu("4", "overdue", "A.5.10", sys("s1", "Payroll"), ana),
];

describe("internal audit detail rules (#399)", () => {
  it("treats evaluated and withdrawn as done, the rest as open", () => {
    expect(all.map(isDone)).toEqual([true, false, true, false]);
  });

  it("filters to exactly one state, or keeps everything", () => {
    expect(all.filter((c) => matchesStateFilter(c, null))).toHaveLength(4);
    expect(all.filter((c) => matchesStateFilter(c, "overdue")).map((c) => c.id)).toEqual(["4"]);
  });

  it("groups by Control in numeric code order, with done of total", () => {
    const groups = groupCheckUps(all, "control");
    expect(groups.map((g) => [g.key, g.done, g.total])).toEqual([
      ["A.5.2", 1, 2],
      ["A.5.10", 1, 2],
    ]);
    expect(groups[0].control).toEqual({ code: "A.5.2", title: "Title A.5.2" });
  });

  it("groups by System by name with the Organization last", () => {
    expect(groupCheckUps(all, "system").map((g) => g.title)).toEqual(["Payroll", "Wiki", "Organization"]);
  });

  it("groups by recipient by name with 'No Control Owner' last", () => {
    expect(groupCheckUps(all, "recipient").map((g) => [g.title, g.total])).toEqual([
      ["Ana", 2],
      ["Bo", 1],
      ["No Control Owner", 1],
    ]);
  });

  it("gives no groups for no Check-ups", () => {
    expect(groupCheckUps([], "control")).toEqual([]);
  });

  it("picks the chosen Check-up, else the first open one shown, else the first", () => {
    expect(pickedCheckUp(all, all, "3")!.id).toBe("3");
    expect(pickedCheckUp(all, all, null)!.id).toBe("2");
    expect(pickedCheckUp(all, all, "gone")!.id).toBe("2");
    const done = [all[0], all[2]];
    expect(pickedCheckUp(all, done, null)!.id).toBe("1");
    expect(pickedCheckUp(all, [], null)).toBeNull();
  });

  it("summarises answers as one label, Mixed, or nothing", () => {
    expect(answerSummary([])).toBeNull();
    expect(answerSummary(["YES", "YES"])).toBe("Yes");
    expect(answerSummary(["NO"])).toBe("No");
    expect(answerSummary(["NA"])).toBe("N/A");
    expect(answerSummary(["YES", "NO"])).toBe("Mixed");
  });
});
