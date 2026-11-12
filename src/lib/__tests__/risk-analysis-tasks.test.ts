import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationStage, EvaluationTrack, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleView } from "@/app/home/role-view";
import { dueRiskAnalysisStep, getRiskAnalysisTasks, riskAnalysisTaskRelation, riskAnalysisTaskId, systemRiskAnalysesHref } from "../risk-analysis-tasks";

const SUFFIX = `${process.pid}-${Date.now()}`;
const T0 = new Date("2026-11-01T10:00:00Z");
const AFTER = new Date("2026-11-02T10:00:00Z");
const BEFORE = new Date("2026-10-30T10:00:00Z");

describe("dueRiskAnalysisStep (#361)", () => {
  const sys = (evaluationStage: EvaluationStage | null, evaluationTrack: EvaluationTrack | null, over: { closed?: boolean; entered?: Date | null } = {}) => ({
    evaluationStage,
    evaluationTrack,
    evaluationClosedAt: over.closed ? T0 : null,
    evaluationStageEnteredAt: over.entered === undefined ? T0 : over.entered,
  });

  it("is due in the first round (no Track yet) until a Risk Analysis is completed since it began", () => {
    expect(dueRiskAnalysisStep(sys("FIRST_ROUND", null), false)).toBe("FIRST_ROUND");
    expect(dueRiskAnalysisStep(sys("FIRST_ROUND", null), true)).toBeNull();
  });

  it.each(["SELF", "FULL"] as const)("is due before OG3 on the %s Track until one is completed since the stage began", (track) => {
    expect(dueRiskAnalysisStep(sys("RISK_ANALYSIS_2", track), false)).toBe("BEFORE_OG3");
    expect(dueRiskAnalysisStep(sys("RISK_ANALYSIS_2", track), true)).toBeNull();
  });

  it.each(["OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "OAG_REVIEW_2", "OG3"] as const)("is not due at %s", (stage) => {
    expect(dueRiskAnalysisStep(sys(stage, "SELF"), false)).toBeNull();
  });

  it("is never due for a legacy System, a closed one, or one with no stage-entered time", () => {
    expect(dueRiskAnalysisStep(sys(null, null), false)).toBeNull();
    expect(dueRiskAnalysisStep(sys("FIRST_ROUND", null, { closed: true }), false)).toBeNull();
    expect(dueRiskAnalysisStep(sys("RISK_ANALYSIS_2", "SELF", { entered: null }), false)).toBeNull();
  });
});

describe("riskAnalysisTaskRelation (#361)", () => {
  it("is the lead's own task, and is everybody's only while there is no lead and the fallback is on", () => {
    expect(riskAnalysisTaskRelation({ id: "a" }, "a")).toBe("lead");
    expect(riskAnalysisTaskRelation({ id: "b" }, "a")).toBeNull();
    expect(riskAnalysisTaskRelation({ id: "b" }, null)).toBe("none");
    expect(riskAnalysisTaskRelation({ id: "b" }, null, false)).toBeNull();
    expect(riskAnalysisTaskRelation({ id: "a" }, "a", false)).toBe("lead");
  });
});

describe("Risk Analysis tasks (#361)", { timeout: 30_000 }, () => {
  const userIds: string[] = [];
  const systemIds: string[] = [];
  let counter = 0;
  let sysOwner: { id: string; role: UserRole };

  async function makeUser(role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-rat-${role}-${++counter}-${SUFFIX}@example.com`, name: `Test RAT ${role} ${counter}`, role } });
    userIds.push(user.id);
    return user;
  }
  async function makeSystem(over: Record<string, unknown> = {}) {
    const system = await prisma.system.create({
      data: { name: `Test RAT System ${++counter} ${SUFFIX}`, ownerId: sysOwner.id, status: "DRAFT", evaluationStage: "FIRST_ROUND", evaluationStageEnteredAt: T0, ...over },
    });
    systemIds.push(system.id);
    return system;
  }
  const rowsFor = async (user: { id: string; role: UserRole }, systemId: string) => (await getRiskAnalysisTasks(user)).filter((row) => row.href === systemRiskAnalysesHref(systemId));

  beforeAll(async () => {
    sysOwner = await makeUser("SYSTEM_OWNER");
  });
  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("with no lead named, gives every Risk Owner and Risk Facilitator the row in the first round, asking for a lead, linking to the Risks tab", async () => {
    const system = await makeSystem();
    for (const role of ["RISK_OWNER", "RISK_FACILITATOR"] as const) {
      const user = await makeUser(role);
      const rows = await rowsFor(user, system.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: riskAnalysisTaskId(system.id, "FIRST_ROUND"),
        kind: "Risk Analysis",
        title: `Name a lead and conduct the Risk Analysis for ${system.name}`,
        status: "Due",
        href: `/systems/${system.id}#risks`,
      });
      expect(rows[0].subtitle).toContain("no analysis recorded yet");
    }
  });

  it("with a lead named, gives the row to the lead alone, as a plain Conduct task", async () => {
    const lead = await makeUser("RISK_FACILITATOR");
    const other = await makeUser("RISK_OWNER");
    const system = await makeSystem({ riskAnalysisLeadId: lead.id });
    const [row] = await rowsFor(lead, system.id);
    expect(row.title).toBe(`Conduct the Risk Analysis for ${system.name}`);
    expect(await rowsFor(other, system.id)).toHaveLength(0);
  });

  it("keeps the lead across both steps", async () => {
    const lead = await makeUser("RISK_OWNER");
    const system = await makeSystem({ riskAnalysisLeadId: lead.id, evaluationStage: "RISK_ANALYSIS_2", evaluationTrack: "SELF" });
    expect((await rowsFor(lead, system.id)).map((row) => row.id)).toEqual([riskAnalysisTaskId(system.id, "BEFORE_OG3")]);
  });

  it("treats a lead who lost the role, or became the System's owner, as no lead, and keeps the stored value", async () => {
    const other = await makeUser("RISK_OWNER");
    const demoted = await makeUser("VIEWER");
    const demotedSystem = await makeSystem({ riskAnalysisLeadId: demoted.id });
    expect(await rowsFor(other, demotedSystem.id)).toHaveLength(1);
    expect(await rowsFor(demoted, demotedSystem.id)).toHaveLength(0);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: demotedSystem.id } })).riskAnalysisLeadId).toBe(demoted.id);
    const nowOwner = await makeUser("RISK_OWNER");
    const ownedSystem = await makeSystem({ riskAnalysisLeadId: nowOwner.id, ownerId: nowOwner.id });
    expect(await rowsFor(nowOwner, ownedSystem.id)).toHaveLength(0);
    expect(await rowsFor(other, ownedSystem.id)).toHaveLength(1);
  });

  it("drops the row once a Risk Analysis is completed since the first round began, but not for one completed before", async () => {
    const system = await makeSystem();
    const user = await makeUser("RISK_OWNER");
    await prisma.riskAnalysis.create({ data: { systemId: system.id, heldOn: BEFORE, completedAt: BEFORE } });
    expect(await rowsFor(user, system.id)).toHaveLength(1);
    await prisma.riskAnalysis.create({ data: { systemId: system.id, heldOn: AFTER, completedAt: AFTER } });
    expect(await rowsFor(user, system.id)).toHaveLength(0);
  });

  it("gives a row for the analysis before OG3, on either Track", async () => {
    const user = await makeUser("RISK_FACILITATOR");
    for (const track of ["SELF", "FULL"] as const) {
      const system = await makeSystem({ evaluationStage: "RISK_ANALYSIS_2", evaluationTrack: track });
      const rows = await rowsFor(user, system.id);
      expect(rows.map((row) => row.id)).toEqual([riskAnalysisTaskId(system.id, "BEFORE_OG3")]);
      expect(rows[0].subtitle).toContain("Before OG3");
    }
  });

  it("shows an analysis in progress with the Open Risks that still lack an owner", async () => {
    const system = await makeSystem();
    const user = await makeUser("RISK_OWNER");
    await prisma.riskAnalysis.create({ data: { systemId: system.id, heldOn: AFTER } });
    const risk = (status: "OPEN" | "ACCEPTED" | "CLOSED", ownerId: string | null) =>
      prisma.risk.create({ data: { systemId: system.id, ownerId, status, severity: "HIGH", likelihood: "LOW", title: `Test RAT Risk ${++counter} ${SUFFIX}`, description: "d" } });
    await risk("OPEN", null);
    await risk("OPEN", null);
    await risk("OPEN", user.id);
    await risk("ACCEPTED", null);
    await risk("CLOSED", null);
    const [row] = await rowsFor(user, system.id);
    expect(row).toMatchObject({ status: "In progress", tone: "accent" });
    expect(row.subtitle).toContain("analysis in progress, 2 Open Risks without an owner");
  });

  it("gives nothing to the System's owner, an Admin, a role outside the list, or a read-only role", async () => {
    const system = await makeSystem();
    const owner = await makeUser("RISK_OWNER");
    const ownedSystem = await makeSystem({ ownerId: owner.id });
    expect(await rowsFor(owner, ownedSystem.id)).toHaveLength(0);
    for (const role of ["ADMIN", "SYSTEM_OWNER", "VIEWER", "REVIEWER", "BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"] as const) {
      const user = await makeUser(role);
      expect(await rowsFor(user, system.id), role).toHaveLength(0);
    }
  });

  it("gives nothing for a legacy System, a closed one, or one in another stage", async () => {
    const user = await makeUser("RISK_OWNER");
    const legacy = await makeSystem({ evaluationStage: null, evaluationStageEnteredAt: null });
    const closed = await makeSystem({ evaluationStage: "RISK_ANALYSIS_2", evaluationTrack: "SELF", evaluationClosedAt: T0, status: "REJECTED" });
    const og1 = await makeSystem({ evaluationStage: "OG1" });
    for (const system of [legacy, closed, og1]) expect(await rowsFor(user, system.id)).toHaveLength(0);
  });

  it("reaches Home's My tasks for a Risk Owner and not for an Admin", async () => {
    const system = await makeSystem();
    const riskOwner = await makeUser("RISK_OWNER");
    const admin = await makeUser("ADMIN");
    const ownerView = await roleView({ id: riskOwner.id, name: riskOwner.name, role: "RISK_OWNER" });
    expect(ownerView.tasks?.some((task) => task.id === riskAnalysisTaskId(system.id, "FIRST_ROUND"))).toBe(true);
    const adminView = await roleView({ id: admin.id, name: admin.name, role: "ADMIN" });
    expect(adminView.tasks?.some((task) => task.id === riskAnalysisTaskId(system.id, "FIRST_ROUND"))).toBeFalsy();
  });
});
