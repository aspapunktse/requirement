import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { classifyLane, taskAction } from "../role-view";
import { checkUpStateCounts, pipelineFlags, reviewWaitPicture, riskHeatPicture, REVIEW_TARGET_DAYS } from "../home-pictures";
import { roleLabel } from "../role-label";

describe("classifyLane: whose move a Home task is (#226)", () => {
  const lane = (kind: string, status: string) => classifyLane({ kind, status });

  it.each([
    ["System", "Rejected", "you"],
    ["System", "Needs assessment", "you"],
    ["System", "Awaiting review", "you"],
    ["System", "Stale assessment", "soon"],
    ["System", "In review", "waiting"],
    ["Query", "Awaiting your reply", "you"],
    ["Query", "Your turn", "you"],
    ["Risk", "Critical", "you"],
    ["Risk", "High", "you"],
    ["Risk", "Medium", "soon"],
    ["Risk", "Low", "soon"],
    ["Check-up", "Overdue", "you"],
    ["Check-up", "Open", "soon"],
    ["Control", "Not started", "you"],
    ["Control", "In progress", "you"],
    ["Audit", "3 to evaluate", "you"],
    ["Audit", "Ready to close", "you"],
    ["Audit", "Waiting on owners", "waiting"],
    ["Audit", "Draft", "soon"],
  ] as const)("puts %s / %s in the %s lane", (kind, status, expected) => {
    expect(lane(kind, status)).toBe(expected);
  });

  it("treats a row it does not know as the user's move", () => {
    expect(lane("Something new", "Whatever")).toBe("you");
  });
});

describe("taskAction: the one verb of a task row", () => {
  it.each([
    ["System", "Rejected", "Fix and resubmit"],
    ["System", "Needs assessment", "Assess"],
    ["System", "Awaiting review", "Review"],
    ["System", "In review", "View"],
    ["Query", "Awaiting your reply", "Reply"],
    ["Query", "Your turn", "Open"],
    ["Check-up", "Open", "Answer"],
    ["Control", "Not started", "Start"],
    ["Control", "In progress", "Continue"],
    ["Audit", "Draft", "Continue draft"],
    ["Audit", "Ready to close", "Close audit"],
    ["Audit", "Waiting on owners", "View"],
    ["Audit", "2 to evaluate", "Evaluate next"],
  ] as const)("%s / %s -> %s", (kind, status, expected) => {
    expect(taskAction({ kind, status }, "SYSTEM_OWNER")).toBe(expected);
  });

  it("offers a Risk for update to a role that manages it and only a view to one that cannot", () => {
    expect(taskAction({ kind: "Risk", status: "High" }, "RISK_OWNER")).toBe("Update");
    expect(taskAction({ kind: "Risk", status: "High" }, "ADMIN")).toBe("Update");
    for (const role of ["BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"] as const) {
      expect(taskAction({ kind: "Risk", status: "High" }, role), role).toBe("View");
    }
  });
});

describe("riskHeatPicture: likelihood by severity", () => {
  it("fits the 4x4 grid: rows from the highest likelihood, columns from the lowest severity", () => {
    const picture = riskHeatPicture([
      { likelihood: "CRITICAL", severity: "CRITICAL" },
      { likelihood: "CRITICAL", severity: "CRITICAL" },
      { likelihood: "LOW", severity: "LOW" },
      { likelihood: "HIGH", severity: "MEDIUM" },
    ]);
    if (picture.type !== "heat") throw new Error("not a heat map");
    expect(picture.rows).toEqual(["Critical", "High", "Medium", "Low"]);
    expect(picture.cols).toEqual(["Low", "Medium", "High", "Critical"]);
    expect(picture.cells).toEqual([
      [0, 0, 0, 2],
      [0, 1, 0, 0],
      [0, 0, 0, 0],
      [1, 0, 0, 0],
    ]);
    expect(picture.note).toBe("4 open");
  });

  it("is all zeros without Risks", () => {
    const picture = riskHeatPicture([]);
    if (picture.type !== "heat") throw new Error("not a heat map");
    expect(picture.cells.flat().every((n) => n === 0)).toBe(true);
  });
});

describe("reviewWaitPicture", () => {
  it("lists the longest wait first with the 7-day target", () => {
    const picture = reviewWaitPicture([
      { id: "a", name: "A", href: "/systems/a", days: 3 },
      { id: "b", name: "B", href: "/systems/b", days: 9 },
    ]);
    if (picture.type !== "bars") throw new Error("not bars");
    expect(picture.target).toBe(REVIEW_TARGET_DAYS);
    expect(picture.items.map((item) => [item.name, item.value])).toEqual([
      ["B", 9],
      ["A", 3],
    ]);
  });
});

describe("checkUpStateCounts", () => {
  it("counts evaluated, to evaluate, not answered and withdrawn, a withdrawn one only as withdrawn", () => {
    const yes = { id: "x" };
    expect(
      checkUpStateCounts([
        { response: yes, evaluation: yes, withdrawal: null },
        { response: yes, evaluation: null, withdrawal: null },
        { response: null, evaluation: null, withdrawal: null },
        { response: yes, evaluation: null, withdrawal: yes },
        { response: null, evaluation: null, withdrawal: yes },
      ]),
    ).toEqual([1, 1, 1, 2]);
  });
});

describe("pipelineFlags", () => {
  it("flags a System from its owner task rows, the first reason winning", () => {
    const row = (id: string) => ({ id, kind: "System", title: "t", tone: "warn" as const, status: "s", href: "/x" });
    const flags = pipelineFlags([row("s1:rejected"), row("s2:needs-assessment"), row("s2:stale"), row("q1")]);
    expect(flags.get("s1")).toBe("Rejected");
    expect(flags.get("s2")).toBe("Needs assessment");
    expect(flags.has("q1")).toBe(false);
  });
});

describe("roleLabel", () => {
  it("writes every role as words", () => {
    expect(roleLabel("BUSINESS_RISK_OWNER")).toBe("Business Risk Owner");
    for (const role of Object.values(UserRole)) expect(roleLabel(role), role).not.toMatch(/_|[A-Z]{2}/);
  });
});
