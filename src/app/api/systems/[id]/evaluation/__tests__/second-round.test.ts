import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { POST as submitSecondRound } from "../submit-second-round/route";
import { POST as submitFirstRound } from "../submit-first-round/route";
import { GET as getEvaluation } from "../route";
import { POST as completeAnalysis } from "../../risk-analyses/[analysisId]/complete/route";
import { PATCH as patchAssessment } from "../../assessments/[controlId]/route";
import { POST as raiseQuery } from "../../assessments/[controlId]/queries/route";

/**
 * The Self track's second round and Risk Analysis stage (#329). Fixtures only (CI's database is migrated, not seeded): one non-base
 * Framework with one mandatory Control scoped to a fixture Deployment Facet, one second-round Document Requirement for the Self
 * track, Systems that declare the Framework, and a user per role that matters.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, { method: init?.method, headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Self track: second round and Risk Analysis (#329)", { timeout: 60_000 }, () => {
  const users: Record<string, { id: string }> = {};
  const systemIds: string[] = [];
  let facetId: string;
  let frameworkId: string;
  let controlId: string;
  let requirementId: string;

  async function makeUser(key: string, role: UserRole) {
    users[key] = await prisma.user.create({ data: { email: `test-329-${key}-${SUFFIX}@example.com`, name: `Test 329 ${key} ${SUFFIX}`, role } });
  }

  async function makeSystem(stage: "FIRST_ROUND" | "OG1" | "SECOND_ROUND" | "RISK_ANALYSIS_2" | "OG3", track: "SELF" | "FULL" | null = "SELF") {
    const system = await prisma.system.create({
      data: {
        name: `Test 329 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users.owner.id,
        sensitivityLevel: 3,
        evaluationStage: stage,
        evaluationTrack: track,
        evaluationStageEnteredAt: new Date(Date.now() - 60_000),
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: [{ id: frameworkId }] },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  /**
   * Answers every mandatory Control that applies to the System (a seeded database has more than this file's one), the fixture one
   * through the route.
   */
  const assess = async (systemId: string) => {
    const patched = await patchAssessment(
      requestAs(users.owner.id, `/api/systems/${systemId}/assessments/${controlId}`, { method: "PATCH", body: { status: "FULFILLED", evidence: "Done" } }),
      { params: Promise.resolve({ id: systemId, controlId }) },
    );
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } } });
    for (const control of await getUnaddressedMandatoryControls(system)) {
      await prisma.controlAssessment.upsert({
        where: { systemId_controlId: { systemId, controlId: control.id } },
        update: { status: "FULFILLED" },
        create: { systemId, controlId: control.id, status: "FULFILLED" },
      });
    }
    return patched;
  };
  /** Marks every second-round Document Requirement on the Self track provided (a seeded database has more than this file's one). */
  const provide = async (systemId: string) => {
    for (const requirement of await prisma.documentRequirement.findMany({ where: { stage: "SECOND_ROUND", tracks: { has: "SELF" } }, select: { id: true } })) {
      await prisma.systemDocument.create({ data: { systemId, documentRequirementId: requirement.id, link: "https://example.com/doc", provided: true, updatedById: users.owner.id } });
    }
  };
  const submit = (systemId: string, userKey = "owner") => submitSecondRound(requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation/submit-second-round`, { method: "POST" }), ctxFor(systemId));
  const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId }, select: { evaluationStage: true, evaluationTrack: true, evaluationStageEnteredAt: true } });
  const stageEvents = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId, action: "EVALUATION_STAGE_CHANGED" }, orderBy: { createdAt: "asc" } });
  const analysis = (systemId: string) => prisma.riskAnalysis.create({ data: { systemId, heldOn: new Date(), recordedById: users.risk.id } });
  const complete = (systemId: string, analysisId: string, userKey = "risk") =>
    completeAnalysis(requestAs(users[userKey].id, `/api/systems/${systemId}/risk-analyses/${analysisId}/complete`, { method: "POST" }), {
      params: Promise.resolve({ id: systemId, analysisId }),
    });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("other", "SYSTEM_OWNER");
    await makeUser("admin", "ADMIN");
    await makeUser("risk", "RISK_OWNER");
    await makeUser("reviewer", "REVIEWER");
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 329 Facet ${SUFFIX}` } })).id;
    frameworkId = (await createFixtureFramework("329 f")).id;
    const control = await prisma.control.create({
      data: {
        code: `T329-${SUFFIX}`,
        title: "Test 329 Second round",
        description: "Test",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: true,
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlId = control.id;
    await mapControlsToFramework(frameworkId, [controlId]);
    requirementId = (await prisma.documentRequirement.create({ data: { name: `Test 329 Document ${SUFFIX}`, stage: "SECOND_ROUND", tracks: ["SELF"] } })).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // assessments, documents, Risks, Risk Analyses cascade
    await prisma.documentRequirement.deleteMany({ where: { id: requirementId } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("submitting the second round", () => {
    it("refuses a missing mandatory Assessment, naming the Control, and changes nothing", async () => {
      const system = await makeSystem("SECOND_ROUND");
      await provide(system.id);
      const events = (await stageEvents(system.id)).length;
      const response = await submit(system.id);
      expect(response.status).toBe(409);
      const error = (await response.json()).error as string;
      expect(error).toContain(`T329-${SUFFIX}`);
      expect(error).not.toContain("Document Requirements");
      expect((await stateOf(system.id)).evaluationStage).toBe("SECOND_ROUND");
      expect(await stageEvents(system.id)).toHaveLength(events);
    });

    it("refuses an unprovided Document Requirement, naming it, and changes nothing", async () => {
      const system = await makeSystem("SECOND_ROUND");
      expect((await assess(system.id)).status).toBe(200);
      const events = (await stageEvents(system.id)).length;
      const response = await submit(system.id);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain(`Test 329 Document ${SUFFIX}`);
      expect((await stateOf(system.id)).evaluationStage).toBe("SECOND_ROUND");
      expect(await stageEvents(system.id)).toHaveLength(events);
      const view = await (await getEvaluation(requestAs(users.owner.id, `/api/systems/${system.id}/evaluation`), ctxFor(system.id))).json();
      expect(view.evaluation.secondRound).toMatchObject({ ready: false, mandatoryMissing: [] });
      expect(view.evaluation.secondRound.documentsMissing.map((d: { name: string }) => d.name)).toContain(`Test 329 Document ${SUFFIX}`);
    });

    it("names both when both are missing", async () => {
      const system = await makeSystem("SECOND_ROUND");
      const error = (await (await submit(system.id)).json()).error as string;
      expect(error).toContain(`T329-${SUFFIX}`);
      expect(error).toContain(`Test 329 Document ${SUFFIX}`);
    });

    it("refuses wrong people (403 or 404) and out-of-stage Systems (409), changing nothing", async () => {
      const system = await makeSystem("SECOND_ROUND");
      await assess(system.id);
      await provide(system.id);
      for (const key of ["other", "risk", "reviewer"]) expect([403, 404]).toContain((await submit(system.id, key)).status);
      expect((await stateOf(system.id)).evaluationStage).toBe("SECOND_ROUND");
      for (const stage of ["FIRST_ROUND", "OG1", "RISK_ANALYSIS_2", "OG3"] as const) {
        const staged = await makeSystem(stage);
        expect((await submit(staged.id)).status).toBe(409);
        expect((await stateOf(staged.id)).evaluationStage).toBe(stage);
      }
    });

    it("moves a ready System to the Risk Analysis stage with a Change Event, for the owner or an Admin, and not twice", async () => {
      for (const key of ["owner", "admin"]) {
        const system = await makeSystem("SECOND_ROUND");
        await assess(system.id);
        await provide(system.id);
        const before = (await stateOf(system.id)).evaluationStageEnteredAt!;
        const response = await submit(system.id, key);
        expect(response.status).toBe(200);
        const after = await stateOf(system.id);
        expect(after.evaluationStage).toBe("RISK_ANALYSIS_2");
        expect(after.evaluationStageEnteredAt!.getTime()).toBeGreaterThan(before.getTime());
        expect((await stageEvents(system.id)).map((e) => e.detail)).toContain("Second round submitted: moved to Risk Analysis");
        expect((await submit(system.id, key)).status).toBe(409);
      }
    });
  });

  describe("the Risk Analysis stage", () => {
    it("moves a Self System to OG3 when a Risk Analysis is completed, with a Change Event in the same step", async () => {
      const system = await makeSystem("RISK_ANALYSIS_2");
      const row = await analysis(system.id);
      expect((await complete(system.id, row.id)).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("OG3");
      const details = (await stageEvents(system.id)).map((e) => e.detail);
      expect(details).toContain("Risk Analysis completed: moved to OG3");
      expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "RISK_ANALYSIS_COMPLETED" } })).toBe(1);
    });

    it("counts an Admin who isn't the owner, but not the owner's own attempt (403, nothing changes)", async () => {
      const system = await makeSystem("RISK_ANALYSIS_2");
      const row = await analysis(system.id);
      expect((await complete(system.id, row.id, "owner")).status).toBe(403);
      expect((await stateOf(system.id)).evaluationStage).toBe("RISK_ANALYSIS_2");
      expect((await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: row.id } })).completedAt).toBeNull();
      expect((await complete(system.id, row.id, "admin")).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("OG3");
    });

    it("does not count an analysis completed before the second round was submitted", async () => {
      const system = await makeSystem("SECOND_ROUND");
      await prisma.riskAnalysis.create({
        data: { systemId: system.id, heldOn: new Date(), recordedById: users.risk.id, completedAt: new Date(Date.now() - 3_600_000), completedById: users.risk.id },
      });
      await assess(system.id);
      await provide(system.id);
      expect((await submit(system.id)).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("RISK_ANALYSIS_2");
    });

    it("leaves a System in any other stage where it is when an analysis is completed", async () => {
      for (const stage of ["SECOND_ROUND", "OG3"] as const) {
        const system = await makeSystem(stage);
        const row = await analysis(system.id);
        expect((await complete(system.id, row.id)).status).toBe(200);
        expect((await stateOf(system.id)).evaluationStage).toBe(stage);
      }
    });

    it("does not move a Full-track System (its next stage is #332's)", async () => {
      const system = await makeSystem("RISK_ANALYSIS_2", "FULL");
      const row = await analysis(system.id);
      expect((await complete(system.id, row.id)).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("RISK_ANALYSIS_2");
    });

    it("does not move the System when the completion is refused for an ownerless Risk", async () => {
      const system = await makeSystem("RISK_ANALYSIS_2");
      await prisma.risk.create({ data: { systemId: system.id, title: `Test 329 Risk ${SUFFIX}`, description: "Test", severity: "MEDIUM", likelihood: "MEDIUM", status: "OPEN" } });
      const row = await analysis(system.id);
      expect((await complete(system.id, row.id)).status).toBe(409);
      expect((await stateOf(system.id)).evaluationStage).toBe("RISK_ANALYSIS_2");
      expect(await stageEvents(system.id)).toHaveLength(0);
    });
  });

  describe("the first-round submit", () => {
    it("still refuses a System that is in its second round", async () => {
      const system = await makeSystem("SECOND_ROUND");
      const response = await submitFirstRound(requestAs(users.owner.id, `/api/systems/${system.id}/evaluation/submit-first-round`, { method: "POST" }), ctxFor(system.id));
      expect(response.status).toBe(409);
    });
  });

  describe("Assessment Queries keep working", () => {
    it("lets a Reviewer raise a query on a Control in the second round and at the Risk Analysis stage", async () => {
      for (const stage of ["SECOND_ROUND", "RISK_ANALYSIS_2"] as const) {
        const system = await makeSystem(stage);
        const response = await raiseQuery(requestAs(users.reviewer.id, `/api/systems/${system.id}/assessments/${controlId}/queries`, { method: "POST", body: { body: "Why?" } }), {
          params: Promise.resolve({ id: system.id, controlId }),
        });
        expect(response.status).toBe(201);
        expect(await prisma.assessmentQuery.count({ where: { controlAssessment: { systemId: system.id } } })).toBe(1);
      }
    });
  });
});
