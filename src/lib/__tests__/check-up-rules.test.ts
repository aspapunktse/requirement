import { describe, expect, it } from "vitest";
import {
  defaultQuestionsFor,
  launchSummaryText,
  MAX_QUESTIONS_PER_CONTROL,
  MAX_QUESTION_LENGTH,
  planLaunch,
  validateQuestionList,
  type LaunchControl,
  type LaunchInputs,
  type LaunchSystem,
} from "@/lib/check-up-rules";

const NOW = new Date("2026-10-13T12:00:00Z");
const BASE = { id: "fw-base", status: "PUBLISHED", isBase: true };

function control(code: string, overrides: Partial<LaunchControl> = {}): LaunchControl {
  return {
    id: `c-${code}`,
    code,
    title: `Control ${code}`,
    applicability: "PER_SYSTEM",
    ownerId: "owner",
    questions: [`Is ${code} in place?`],
    minConfidentialityImpactLevel: null,
    minIntegrityImpactLevel: null,
    minAvailabilityImpactLevel: null,
    deploymentFacets: [],
    mappings: [{ requirement: { framework: BASE } }],
    ...overrides,
  };
}

function system(name: string, overrides: Partial<LaunchSystem> = {}): LaunchSystem {
  return {
    id: `s-${name}`,
    name,
    deploymentFacets: [],
    frameworkScopes: [],
    confidentialityImpactLevel: null,
    integrityImpactLevel: null,
    availabilityImpactLevel: null,
    ...overrides,
  };
}

function inputs(overrides: Partial<LaunchInputs> & { controls: LaunchControl[]; systems: LaunchSystem[] }): LaunchInputs {
  return { audit: { title: "Audit", dueDate: "2026-11-01", includeOrganization: false }, ...overrides };
}

describe("defaultQuestionsFor", () => {
  it("is the Self-Assessment Question, trimmed, or nothing", () => {
    expect(defaultQuestionsFor("  Is MFA on?  ")).toEqual(["Is MFA on?"]);
    expect(defaultQuestionsFor("   ")).toEqual([]);
    expect(defaultQuestionsFor(null)).toEqual([]);
    expect(defaultQuestionsFor(undefined)).toEqual([]);
  });
});

describe("validateQuestionList", () => {
  it("accepts an empty list and ordinary questions", () => {
    expect(validateQuestionList([])).toEqual([]);
    expect(validateQuestionList(["One?", "Two?"])).toEqual([]);
  });

  it("refuses a blank question, an over-long one and too many", () => {
    expect(validateQuestionList(["ok", "   "])).toEqual(["A question can't be blank"]);
    expect(validateQuestionList(["x".repeat(MAX_QUESTION_LENGTH + 1)])).toHaveLength(1);
    expect(validateQuestionList(["x".repeat(MAX_QUESTION_LENGTH)])).toEqual([]);
    expect(validateQuestionList(Array.from({ length: MAX_QUESTIONS_PER_CONTROL + 1 }, () => "q"))).toHaveLength(1);
  });
});

describe("planLaunch", () => {
  it("generates a System-level Check-up per applicable System and Control, with the Control's questions", () => {
    const plan = planLaunch(
      inputs({
        controls: [control("A.5.2", { questions: ["First?", "  Second?  "] }), control("A.5.10")],
        systems: [system("Zeta"), system("Alpha"), system("Mid")],
      }),
      NOW,
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.systemCheckUpCount).toBe(6);
    expect(plan.organizationCheckUpCount).toBe(0);
    expect(plan.skipped).toEqual([]);
    // Controls by numeric code, then Systems by name.
    expect(plan.checkUps.map((c) => `${c.controlId}/${c.systemId}`)).toEqual([
      "c-A.5.2/s-Alpha",
      "c-A.5.2/s-Mid",
      "c-A.5.2/s-Zeta",
      "c-A.5.10/s-Alpha",
      "c-A.5.10/s-Mid",
      "c-A.5.10/s-Zeta",
    ]);
    expect(plan.checkUps[0].questions).toEqual(["First?", "Second?"]);
  });

  it("skips and counts a System the Control doesn't apply to", () => {
    const needsCloud = control("A.8.1", { deploymentFacets: [{ id: "cloud" }] });
    const plan = planLaunch(
      inputs({
        controls: [needsCloud],
        systems: [system("OnPrem"), system("Cloudy", { deploymentFacets: [{ id: "cloud" }] })],
      }),
      NOW,
    );
    expect(plan.checkUps.map((c) => c.systemId)).toEqual(["s-Cloudy"]);
    expect(plan.skipped).toEqual([{ controlId: "c-A.8.1", systemId: "s-OnPrem" }]);
    expect(plan.blockers).toEqual([]);
  });

  it("gives an Organizational Control only an Organization-level Check-up", () => {
    const plan = planLaunch(
      inputs({
        audit: { title: "Audit", dueDate: "2026-11-01", includeOrganization: true },
        controls: [control("A.5.1", { applicability: "ORGANIZATIONAL" }), control("A.8.2", { applicability: "BOTH" }), control("A.8.3")],
        systems: [system("S1")],
      }),
      NOW,
    );
    expect(plan.checkUps.map((c) => `${c.controlId}/${c.systemId}`)).toEqual([
      "c-A.5.1/null",
      "c-A.8.2/s-S1",
      "c-A.8.2/null",
      "c-A.8.3/s-S1",
    ]);
    expect(plan.organizationCheckUpCount).toBe(2);
    expect(plan.systemCheckUpCount).toBe(2);
    // The Organizational Control doesn't apply to the System.
    expect(plan.skipped).toEqual([{ controlId: "c-A.5.1", systemId: "s-S1" }]);
  });

  it("generates no Organization-level Check-up when the Organization is not included", () => {
    const plan = planLaunch(inputs({ controls: [control("A.5.1", { applicability: "BOTH" })], systems: [system("S1")] }), NOW);
    expect(plan.organizationCheckUpCount).toBe(0);
    expect(plan.checkUps).toHaveLength(1);
  });

  it("blocks while an Organization-level Control has no Control Owner, naming it", () => {
    const plan = planLaunch(
      inputs({
        audit: { title: "Audit", dueDate: "2026-11-01", includeOrganization: true },
        controls: [control("A.5.1", { applicability: "ORGANIZATIONAL", ownerId: null }), control("A.5.2", { applicability: "BOTH" })],
        systems: [],
      }),
      NOW,
    );
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatchObject({ kind: "no-control-owner", controlIds: ["c-A.5.1"] });
    expect(plan.blockers[0].message).toContain("A.5.1");
    expect(plan.blockers[0].message).not.toContain("A.5.2");
  });

  it("does not need a Control Owner for a Control with no Organization-level Check-up", () => {
    const perSystemNoOwner = control("A.8.1", { ownerId: null });
    expect(
      planLaunch(inputs({ audit: { title: "A", dueDate: "2026-11-01", includeOrganization: true }, controls: [perSystemNoOwner, control("A.5.1", { applicability: "BOTH" })], systems: [system("S")] }), NOW)
        .blockers,
    ).toEqual([]);
    expect(planLaunch(inputs({ controls: [control("A.5.1", { applicability: "ORGANIZATIONAL", ownerId: null }), control("A.8.1")], systems: [system("S")] }), NOW).blockers).toEqual([]);
  });

  it("blocks a Control with no non-blank question, naming it", () => {
    const plan = planLaunch(
      inputs({ controls: [control("A.5.1", { questions: [] }), control("A.5.2", { questions: ["  "] }), control("A.5.3")], systems: [system("S")] }),
      NOW,
    );
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatchObject({ kind: "no-questions", controlIds: ["c-A.5.1", "c-A.5.2"] });
    expect(plan.blockers[0].message).toContain("A.5.1, A.5.2");
  });

  it("blocks a due date in the past but allows today", () => {
    const past = planLaunch(inputs({ audit: { title: "A", dueDate: "2026-10-12", includeOrganization: false }, controls: [control("A.5.1")], systems: [system("S")] }), NOW);
    expect(past.blockers.map((b) => b.kind)).toEqual(["past-due-date"]);
    const today = planLaunch(inputs({ audit: { title: "A", dueDate: "2026-10-13", includeOrganization: false }, controls: [control("A.5.1")], systems: [system("S")] }), NOW);
    expect(today.blockers).toEqual([]);
  });

  it("blocks an audit that is not valid", () => {
    const plan = planLaunch(inputs({ audit: { title: " ", dueDate: null, includeOrganization: false }, controls: [], systems: [] }), NOW);
    expect(plan.blockers.every((b) => b.kind === "invalid")).toBe(true);
    expect(plan.blockers.length).toBeGreaterThanOrEqual(3);
  });

  it("blocks a launch that would generate no Check-up at all", () => {
    const plan = planLaunch(
      inputs({ controls: [control("A.8.1", { deploymentFacets: [{ id: "cloud" }] }), control("A.5.1", { applicability: "ORGANIZATIONAL" })], systems: [system("OnPrem")] }),
      NOW,
    );
    expect(plan.checkUps).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.blockers.map((b) => b.kind)).toEqual(["nothing-to-generate"]);
  });
});

describe("launchSummaryText", () => {
  it("states the counts and what was skipped", () => {
    expect(launchSummaryText({ systemCheckUpCount: 5, organizationCheckUpCount: 1, skipped: [{ controlId: "a", systemId: "b" }] })).toBe(
      "6 Check-ups (5 System-level, 1 Organization-level); 1 System and Control pair skipped because the Control doesn't apply to the System",
    );
    expect(launchSummaryText({ systemCheckUpCount: 1, organizationCheckUpCount: 0, skipped: [] })).toBe(
      "1 Check-up (1 System-level, 0 Organization-level); none skipped",
    );
  });
});
