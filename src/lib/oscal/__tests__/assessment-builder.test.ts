import { describe, expect, it } from "vitest";
import { oscalUuid } from "@/lib/oscal/ids";
import { buildAssessmentDocuments, type AssessmentContext } from "@/lib/oscal/assessment-builder";

const who = { id: "u1", name: "Test Owner" };
const date = (s: string) => new Date(s);

function context(selfControlId: string): AssessmentContext {
  return {
    audit: {
      id: "a1",
      title: "Test audit",
      scopeDescription: "",
      dueDate: date("2026-11-30T00:00:00Z"),
      launchedAt: date("2026-11-01T00:00:00Z"),
      closedAt: date("2026-11-20T00:00:00Z"),
      checkUps: [],
      risks: [],
      selfAssessments: [{ assessmentId: "ca1", controlId: selfControlId, answer: "YES", question: "Is it in place?" }],
    },
    system: { id: "s1", name: "Test System", owner: who },
    controls: new Map([["c1", { id: "c1", code: "TEST-1", title: "Test control" }]]),
    referencedRiskIds: new Set(),
    exporter: [],
    now: date("2026-12-01T00:00:00Z"),
    newUuid: () => "00000000-0000-4000-8000-000000000000",
    metadata: () => ({}),
  };
}

describe("the self-assessment result (#454)", () => {
  it("is made from the current answers, credited to the System owner and collected when the document is made, whether or not the Control is among the audit's Check-ups", () => {
    const { assessmentResults } = buildAssessmentDocuments(context("c1"));
    const results = (assessmentResults["assessment-results"] as { results: { title: string; findings?: unknown; observations: unknown[] }[] }).results;
    expect(results.map((r) => r.title)).toContain("System Owner self-assessment");
    const self = results.find((r) => r.title === "System Owner self-assessment")!;
    expect(self.observations).toHaveLength(1);
    expect(self.findings).toBeUndefined();
    const o = self.observations[0] as { collected: string; origins: { actors: { "actor-uuid": string }[] }[] };
    expect(o.collected).toBe("2026-12-01T00:00:00.000Z");
    expect(JSON.stringify(o.origins)).toContain(oscalUuid("User", "u1"));
  });

  it("is left out when no answer was recorded, and an answer on an unknown Control is skipped", () => {
    expect(
      (buildAssessmentDocuments(context("unknown")).assessmentResults["assessment-results"] as { results: unknown[] }).results,
    ).toHaveLength(1);
  });
});
