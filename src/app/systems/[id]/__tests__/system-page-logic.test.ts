import { describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { canMarkOnboarded } from "@/lib/onboarding";
import { canSubmit } from "@/lib/system-permissions";
import { buildAttention, controlIsDone, formatDay, lifecycleNote, lifecycleStages, nextStepFor, riskGridOf, sourceKeyOf, tabFromHash } from "../system-page-logic";
import type { DecisionStep } from "../system-page-types";

const STATUSES: OnboardingStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "ONBOARDED"];
const BASE: DecisionStep = { reviewGroupId: null, name: "Base review" };
const GROUP: DecisionStep = { reviewGroupId: "g1", name: "GDPR Review Group" };

describe("nextStepFor: the one action in the header (decision 2a on #243)", () => {
  it("offers Submit for review only on a Draft, and only to someone who may submit", () => {
    expect(nextStepFor({ status: "DRAFT", canSubmit: true, canMarkOnboarded: true, decidableSteps: [BASE] })).toEqual({ kind: "submit" });
    expect(nextStepFor({ status: "DRAFT", canSubmit: false, canMarkOnboarded: true, decidableSteps: [BASE] })).toEqual({ kind: "none" });
  });

  it("offers Approve / Reject on a System In Review, with exactly the open steps the user may decide", () => {
    expect(nextStepFor({ status: "IN_REVIEW", canSubmit: true, canMarkOnboarded: true, decidableSteps: [BASE, GROUP] })).toEqual({ kind: "decide", steps: [BASE, GROUP] });
    expect(nextStepFor({ status: "IN_REVIEW", canSubmit: true, canMarkOnboarded: true, decidableSteps: [] })).toEqual({ kind: "none" });
  });

  it("offers Mark Onboarded only on an Approved System, and only to someone who may", () => {
    expect(nextStepFor({ status: "APPROVED", canSubmit: false, canMarkOnboarded: true, decidableSteps: [] })).toEqual({ kind: "onboard" });
    expect(nextStepFor({ status: "APPROVED", canSubmit: true, canMarkOnboarded: false, decidableSteps: [BASE] })).toEqual({ kind: "none" });
  });

  it("offers nothing on a Rejected or an Onboarded System, whose APIs refuse every action", () => {
    for (const status of ["REJECTED", "ONBOARDED"] as const) {
      expect(nextStepFor({ status, canSubmit: true, canMarkOnboarded: true, decidableSteps: [BASE] })).toEqual({ kind: "none" });
    }
  });

  it("agrees with the API rules for every status and role: the System's owner, another user, an Admin, a read-only role", () => {
    const system = { ownerId: "owner" };
    const actors = [
      { id: "owner", role: "SYSTEM_OWNER" as const },
      { id: "owner", role: "RISK_OWNER" as const },
      { id: "other", role: "SYSTEM_OWNER" as const },
      { id: "admin", role: "ADMIN" as const },
      { id: "reviewer", role: "REVIEWER" as const },
      { id: "owner", role: "COMPLIANCE_MANAGER" as const },
      { id: "auditor", role: "INTERNAL_AUDITOR" as const },
    ];
    for (const status of STATUSES) {
      for (const actor of actors) {
        // The submit and onboard routes refuse (403) exactly when these say no.
        const step = nextStepFor({ status, canSubmit: canSubmit(actor, system), canMarkOnboarded: canMarkOnboarded(actor, system), decidableSteps: [] });
        expect(step.kind === "submit").toBe(status === "DRAFT" && canSubmit(actor, system));
        expect(step.kind === "onboard").toBe(status === "APPROVED" && canMarkOnboarded(actor, system));
      }
    }
  });
});

describe("lifecycleStages", () => {
  const states = (status: OnboardingStatus) => lifecycleStages(status).map((stage) => `${stage.label}:${stage.state}`);

  it("marks the steps before the current one as past", () => {
    expect(states("DRAFT")).toEqual(["Draft:now", "In review:todo", "Approved:todo", "Onboarded:todo"]);
    expect(states("IN_REVIEW")).toEqual(["Draft:past", "In review:now", "Approved:todo", "Onboarded:todo"]);
    expect(states("APPROVED")).toEqual(["Draft:past", "In review:past", "Approved:now", "Onboarded:todo"]);
  });

  it("shows a Rejected System as Rejected on the In review step", () => {
    expect(states("REJECTED")).toEqual(["Draft:past", "Rejected:now", "Approved:todo", "Onboarded:todo"]);
    expect(lifecycleStages("REJECTED")[1].tone).toBe("danger");
  });

  it("has finished all four steps once Onboarded", () => {
    expect(states("ONBOARDED")).toEqual(["Draft:past", "In review:past", "Approved:past", "Onboarded:past"]);
  });
});

describe("lifecycleNote", () => {
  const base = { ownerName: "Ola Owner", submittedAt: "2026-10-20T10:00:00.000Z", submittedBy: "Ola Owner", approvedAt: null, onboardedAt: null, hasEarlierRound: false, stepsApproved: 0, stepsTotal: 1 };

  it("says who submitted it and when, and what it waits for", () => {
    expect(lifecycleNote({ ...base, status: "IN_REVIEW" })).toBe("Submitted 20 Oct 2026 by Ola Owner · waiting for a Reviewer's decision");
    expect(lifecycleNote({ ...base, status: "IN_REVIEW", stepsApproved: 1, stepsTotal: 2 })).toContain("(1 of 2 Review Steps approved)");
  });

  it("names the owner's resubmission for a Draft that was returned, and for a Rejected System", () => {
    expect(lifecycleNote({ ...base, status: "DRAFT" })).toBe("Not submitted yet · Ola Owner is still assembling the System");
    expect(lifecycleNote({ ...base, status: "DRAFT", hasEarlierRound: true })).toBe("Returned to Draft after a review · waiting for Ola Owner's resubmission");
    expect(lifecycleNote({ ...base, status: "REJECTED" })).toContain("waiting for Ola Owner's resubmission");
  });

  it("names marking Onboarded for an Approved System, and the day for an Onboarded one", () => {
    expect(lifecycleNote({ ...base, status: "APPROVED", approvedAt: "2026-10-22T08:00:00.000Z" })).toBe("Approved 22 Oct 2026 · waiting for Ola Owner or an Admin to mark it Onboarded");
    expect(lifecycleNote({ ...base, status: "ONBOARDED", onboardedAt: "2026-10-25T08:00:00.000Z" })).toBe("Onboarded 25 Oct 2026");
  });

  it("prints a day in UTC", () => {
    expect(formatDay("2026-01-01T00:30:00.000Z")).toBe("1 Jan 2026");
  });
});

describe("buildAttention", () => {
  const control = (over: Partial<Parameters<typeof buildAttention>[0]["controls"][number]> & { id: string }) => ({
    code: "A.1",
    title: "Title",
    mandatory: true,
    status: "NOT_STARTED" as const,
    source: "system" as const,
    ...over,
  });

  it("lists open Queries, then mandatory Controls this System assesses itself that are Not started, then open Risks worst first", () => {
    const items = buildAttention({
      queries: [{ id: "q1", controlCode: "A.5", controlTitle: "Policies", body: "Where is the policy?" }],
      controls: [
        control({ id: "c1", code: "A.1", title: "Mandatory own" }),
        control({ id: "c2", code: "A.2", title: "Optional", mandatory: false }),
        control({ id: "c3", code: "A.3", title: "Inherited", source: "organization" }),
        control({ id: "c4", code: "A.4", title: "Started", status: "IN_PROGRESS" }),
      ],
      risks: [
        { id: "r1", title: "Low one", severity: "LOW", status: "OPEN" },
        { id: "r2", title: "Critical one", severity: "CRITICAL", status: "OPEN" },
        { id: "r3", title: "Closed", severity: "CRITICAL", status: "CLOSED" },
        { id: "r4", title: "Mitigated", severity: "HIGH", status: "MITIGATED" },
        { id: "r5", title: "High one", severity: "HIGH", status: "OPEN" },
      ],
    });
    expect(items.map((item) => item.title)).toEqual(["Where is the policy?", "A.1 Mandatory own", "Critical one", "High one", "Low one"]);
    expect(items.map((item) => item.kind)).toEqual(["query", "control", "risk", "risk", "risk"]);
    expect(items.map((item) => item.tab)).toEqual(["controls", "controls", "risks", "risks", "risks"]);
    expect(items.map((item) => item.tone)).toEqual(["warn", "danger", "danger", "danger", "warn"]);
  });

  it("shortens a long Query and falls back to the Control when it has no text", () => {
    const [long, empty] = buildAttention({
      queries: [
        { id: "q1", controlCode: "A.5", controlTitle: "Policies", body: "x".repeat(200) },
        { id: "q2", controlCode: "A.6", controlTitle: "Screening", body: "" },
      ],
      controls: [],
      risks: [],
    });
    expect(long.title.length).toBeLessThanOrEqual(90);
    expect(long.title.endsWith("…")).toBe(true);
    expect(empty.title).toBe("Question on A.6");
  });
});

describe("the small rules", () => {
  it("riskGridOf counts only open Risks, by severity and likelihood", () => {
    const grid = riskGridOf([
      { severity: "CRITICAL", likelihood: "LOW", status: "OPEN" },
      { severity: "CRITICAL", likelihood: "LOW", status: "OPEN" },
      { severity: "LOW", likelihood: "HIGH", status: "OPEN" },
      { severity: "LOW", likelihood: "HIGH", status: "ACCEPTED" },
    ]);
    expect(grid[3][0]).toBe(2);
    expect(grid[0][2]).toBe(1);
    expect(grid.flat().reduce((sum, n) => sum + n, 0)).toBe(3);
  });

  it("tabFromHash reads a known tab and falls back to the Overview", () => {
    expect(tabFromHash("#controls")).toBe("controls");
    expect(tabFromHash("activity")).toBe("activity");
    expect(tabFromHash("#nonsense")).toBe("overview");
    expect(tabFromHash("")).toBe("overview");
  });

  it("controlIsDone is Fulfilled, Waived or Not applicable", () => {
    expect(["FULFILLED", "WAIVED", "NOT_APPLICABLE", "IN_PROGRESS", "NOT_STARTED"].map((status) => controlIsDone(status as never))).toEqual([true, true, true, false, false]);
  });

  it("sourceKeyOf names where a status comes from", () => {
    expect(sourceKeyOf({ kind: "SYSTEM" })).toBe("system");
    expect(sourceKeyOf({ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" })).toBe("organization");
    expect(sourceKeyOf({ kind: "ORGANIZATION_DIRECT" })).toBe("organization");
    const provider = { kind: "PROVIDER" as const, status: "FULFILLED" as const, provider: { id: "p", name: "P" }, providerOnboarded: true, appliesToProvider: true, customerResponsibility: null };
    expect(sourceKeyOf({ ...provider, type: "FULL" })).toBe("provider-full");
    expect(sourceKeyOf({ ...provider, type: "SHARED" })).toBe("provider-shared");
  });
});
