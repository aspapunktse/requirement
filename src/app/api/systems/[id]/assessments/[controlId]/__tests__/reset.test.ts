import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getComplianceForSystems } from "@/lib/compliance";
import {
  describeResetAssessment,
  getUnaddressedMandatoryControls,
  REMOVED_ASSESSMENT_TEXT_LIMIT,
  UNTOUCHED_ASSESSMENT_WHERE,
} from "@/lib/control-assessments";
import { deriveFrameworkStatusesForSystems, type DerivationSystem } from "@/lib/requirement-status";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { PATCH as patchSystem } from "../../../route";
import { GET as listAssessments } from "../../route";
import { POST } from "../reset/route";

/**
 * Resetting a Control Assessment to inherited (#129). Self-contained fixtures (CI's DB is migrated,
 * not seeded): BOTH and PER_SYSTEM Controls scoped to a fixture Deployment Facet and mapped to a
 * fixture Published Framework that only the fixture Systems declare, so nothing here applies to a
 * seeded System. Every System is Onboarded, so every role can see it and the 403s are real 403s.
 * The Organization's implementation is set directly; the route that does it is tested elsewhere.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"];

function requestAs(systemId: string, controlId: string, userId: string | null, method = "POST") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/systems/${systemId}/assessments/${controlId}/reset`, { method, headers });
}
const ctxFor = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) });
const reset = (systemId: string, controlId: string, userId: string | null) =>
  POST(requestAs(systemId, controlId, userId), ctxFor(systemId, controlId));

describe("POST /api/systems/[id]/assessments/[controlId]/reset (#129)", { timeout: 30_000 }, () => {
  const users = {} as Record<
    "owner" | "otherOwner" | "reviewer" | "riskOwner" | "complianceManager" | "viewer" | "businessRiskOwner" | "admin",
    string
  >;
  const systemIds: string[] = [];
  let facetLive: string;
  let facetStale: string;
  let frameworkId: string;
  const control = {} as Record<"both" | "perSystem" | "stale", { id: string; code: string }>;
  let requirementId: string;

  const classification = (id: string): Promise<DerivationSystem> =>
    prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });

  const setOrganization = (status: ControlAssessmentStatus) =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId: control.both.id },
      create: { controlId: control.both.id, status, description: status === "WAIVED" || status === "NOT_APPLICABLE" ? "Because" : null },
      update: { status, description: status === "WAIVED" || status === "NOT_APPLICABLE" ? "Because" : null },
    });

  /** An Onboarded System in the fixture Framework's scope that declares `facets` (default: the live Facet only). */
  async function makeSystem(options: { ownerId?: string; status?: "ONBOARDED" | "DRAFT"; facets?: string[] } = {}) {
    const system = await prisma.system.create({
      data: {
        name: `Test Reset System ${SUFFIX}-${systemIds.length}`,
        ownerId: options.ownerId ?? users.owner,
        status: options.status ?? "ONBOARDED",
        deploymentFacets: { connect: (options.facets ?? [facetLive]).map((id) => ({ id })) },
        frameworkScopes: { connect: [{ id: frameworkId }] },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }

  /** A System with a person-set Assessment of the Both Control. */
  async function makePersonSetSystem(
    assessment: {
      status?: ControlAssessmentStatus;
      evidence?: string | null;
      notes?: string | null;
      selfAssessmentAnswer?: "YES" | "NO" | "NA" | null;
    } = {},
    systemOptions: Parameters<typeof makeSystem>[0] = {},
  ) {
    const systemId = await makeSystem(systemOptions);
    await prisma.controlAssessment.create({
      data: {
        systemId,
        controlId: control.both.id,
        status: assessment.status ?? "IN_PROGRESS",
        evidence: assessment.evidence === undefined ? "https://example.com/evidence" : assessment.evidence,
        notes: assessment.notes === undefined ? "Checked in 2025" : assessment.notes,
        selfAssessmentAnswer: assessment.selfAssessmentAnswer ?? null,
        assessedById: users.owner,
        assessedAt: new Date("2026-01-15T10:00:00Z"),
      },
    });
    return systemId;
  }

  const assessmentOf = (systemId: string, controlId = control.both.id) =>
    prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId, controlId } } });
  const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId } });

  /** Everything a refused reset could have touched. */
  async function snapshot(systemId: string) {
    return {
      assessments: await prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } }),
      queries: await prisma.assessmentQuery.findMany({ where: { controlAssessment: { systemId } }, orderBy: { id: "asc" } }),
      risks: await prisma.risk.findMany({ where: { systemId }, orderBy: { id: "asc" } }),
      changeEvents: await prisma.changeEvent.count({ where: { systemId } }),
    };
  }

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "SYSTEM_OWNER"],
      ["otherOwner", "SYSTEM_OWNER"],
      ["reviewer", "REVIEWER"],
      ["riskOwner", "RISK_OWNER"],
      ["complianceManager", "COMPLIANCE_MANAGER"],
      ["viewer", "VIEWER"],
      ["businessRiskOwner", "BUSINESS_RISK_OWNER"],
      ["admin", "ADMIN"],
    ] as const) {
      users[key] = (
        await prisma.user.create({ data: { email: `test-reset-${key}-${SUFFIX}@example.com`, name: `Test Reset ${key}`, role } })
      ).id;
    }
    facetLive = (await prisma.deploymentFacet.create({ data: { name: `Test Reset Facet Live ${SUFFIX}` } })).id;
    facetStale = (await prisma.deploymentFacet.create({ data: { name: `Test Reset Facet Stale ${SUFFIX}` } })).id;

    const makeControl = async (key: keyof typeof control, applicability: "BOTH" | "PER_SYSTEM", facetId: string) => {
      const created = await prisma.control.create({
        data: {
          code: `TEST-RESET-${key}-${SUFFIX}`,
          title: `Test Reset ${key}`,
          description: "d",
          category: "Test",
          applicability,
          mandatory: true,
          question: "Does it?",
          deploymentFacets: { connect: { id: facetId } },
        },
      });
      control[key] = { id: created.id, code: created.code };
    };
    await makeControl("both", "BOTH", facetLive);
    await makeControl("perSystem", "PER_SYSTEM", facetLive);
    await makeControl("stale", "BOTH", facetStale);

    frameworkId = (await createFixtureFramework("Reset")).id;
    requirementId = await mapControlsToFramework(frameworkId, [control.both.id]);
    await mapControlsToFramework(frameworkId, [control.perSystem.id, control.stale.id]);
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Assessments, Queries and Risks cascade
    await prisma.control.deleteMany({ where: { id: { in: Object.values(control).map((c) => c.id) } } }); // implementations cascade
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetLive, facetStale] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("what a reset does", () => {
    it.each(STATUSES)(
      "returns a person-set %s Assessment to untouched, so a Fulfilled Organization is inherited",
      async (status) => {
        await setOrganization("FULFILLED");
        const systemId = await makePersonSetSystem({ status });

        const response = await reset(systemId, control.both.id, users.owner);

        expect(response.status).toBe(200);
        const row = await assessmentOf(systemId);
        expect(row).toMatchObject({
          status: "NOT_STARTED",
          assessedById: null,
          assessedAt: null,
          evidence: null,
          notes: null,
          selfAssessmentAnswer: null,
        });
        // The row satisfies the one definition of untouched, and it is the row we started with.
        expect(await prisma.controlAssessment.count({ where: { id: row!.id, ...UNTOUCHED_ASSESSMENT_WHERE } })).toBe(1);

        // The response is the row as GET /assessments shows it.
        const body = await response.json();
        expect(Object.keys(body).sort()).toEqual(["assessment", "canManageQueries", "control", "effective"]);
        expect(body.control).toMatchObject({ id: control.both.id, code: control.both.code });
        expect(body.assessment).toMatchObject({ id: row!.id, status: "NOT_STARTED", assessedById: null, assessedBy: null, queries: [] });
        expect(body.effective).toEqual({
          status: "FULFILLED",
          source: { kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" },
          sources: [{ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED", givesCredit: true }],
          overridesInherited: false,
        });
      },
    );

    it("returns exactly the row GET /assessments shows for that Control", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "WAIVED" });

      const body = await (await reset(systemId, control.both.id, users.owner)).json();

      const listed = await listAssessments(
        new NextRequest(`http://localhost/api/systems/${systemId}/assessments`, {
          headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${users.owner}` }),
        }),
        { params: Promise.resolve({ id: systemId }) },
      );
      const rows = (await listed.json()).assessments as { control: { id: string } }[];
      expect(body).toEqual(rows.find((row) => row.control.id === control.both.id));
    });

    it("clears a Self-Assessment answer and returns the Control to what the Organization gives", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "IN_PROGRESS", selfAssessmentAnswer: "NO" });

      expect((await reset(systemId, control.both.id, users.owner)).status).toBe(200);

      expect((await assessmentOf(systemId))!.selfAssessmentAnswer).toBeNull();
      const [event] = await events(systemId);
      expect(event.detail).toContain("Self-Assessment answer: No");
    });

    it("leaves the Control Not Started when the Organization doesn't give credit, and it is a task again", async () => {
      await setOrganization("WAIVED");
      const systemId = await makePersonSetSystem({ status: "FULFILLED" });
      const unaddressed = async () => (await getUnaddressedMandatoryControls(await classification(systemId))).map((c) => c.id);
      expect(await unaddressed()).not.toContain(control.both.id);

      const response = await reset(systemId, control.both.id, users.owner);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.effective).toMatchObject({ status: "NOT_STARTED", source: { kind: "SYSTEM" }, overridesInherited: false });
      expect(body.effective.sources).toEqual([{ kind: "ORGANIZATION", type: "FULL", status: "WAIVED", givesCredit: false }]);
      expect(await unaddressed()).toContain(control.both.id);
      const [event] = await events(systemId);
      expect(event.detail).toMatch(/; now Not Started$/);
    });

    it("counts a Fulfilled Organization as addressed after the reset, which a person-set Not Started row did not", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "NOT_STARTED" });
      const unaddressed = async () => (await getUnaddressedMandatoryControls(await classification(systemId))).map((c) => c.id);
      expect(await unaddressed()).toContain(control.both.id);

      await reset(systemId, control.both.id, users.owner);

      expect(await unaddressed()).not.toContain(control.both.id);
    });

    it("moves the derived Requirement status and the Compliance Percentage", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "IN_PROGRESS" });
      const statusOf = async () => {
        const derived = await deriveFrameworkStatusesForSystems(frameworkId, [await classification(systemId)]);
        return derived!.bySystem.get(systemId)!.find((row) => row.requirementId === requirementId)!.status;
      };
      const compliance = async () => (await getComplianceForSystems({ id: systemId }, { frameworkId })).bySystem[0];

      // Person-set In Progress overrides the Fulfilled Organization.
      expect(await statusOf()).toBe("NOT_MET");
      expect(await compliance()).toMatchObject({ met: 0 });

      await reset(systemId, control.both.id, users.owner);

      expect(await statusOf()).toBe("MET");
      expect(await compliance()).toMatchObject({ met: 1 });

      // And back the other way when the Organization stops being Fulfilled.
      await setOrganization("IN_PROGRESS");
      expect(await statusOf()).toBe("NOT_MET");
      expect(await compliance()).toMatchObject({ met: 0 });
    });

    it("works for an Admin who doesn't own the System, with the Admin as the actor", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem();

      expect((await reset(systemId, control.both.id, users.admin)).status).toBe(200);

      expect((await assessmentOf(systemId))!.assessedById).toBeNull();
      expect((await events(systemId)).map((e) => e.actorId)).toEqual([users.admin]);
    });

    it("works for a Risk Owner on a System they own, whatever the source's status", async () => {
      await setOrganization("NOT_APPLICABLE");
      const systemId = await makePersonSetSystem({}, { ownerId: users.riskOwner });

      expect((await reset(systemId, control.both.id, users.riskOwner)).status).toBe(200);
    });
  });

  describe("the Change Event", () => {
    it("is one ASSESSMENT_STATUS_CHANGED event on the System, attributed to the User who reset it, with what was cleared", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "IN_PROGRESS" });

      await reset(systemId, control.both.id, users.owner);

      const list = await events(systemId);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ systemId, action: "ASSESSMENT_STATUS_CHANGED", actorId: users.owner });
      expect(list[0].detail).toBe(
        `Assessment for ${control.both.code} reset to inherited (was In Progress; evidence: "https://example.com/evidence"; notes: "Checked in 2025"); now Fulfilled, inherited from the Organization`,
      );
    });

    it("omits empty evidence and notes, and truncates long ones with an ellipsis", async () => {
      await setOrganization("NOT_STARTED");
      const bare = await makePersonSetSystem({ status: "WAIVED", evidence: null, notes: "   " });
      await reset(bare, control.both.id, users.owner);
      expect((await events(bare))[0].detail).toBe(
        `Assessment for ${control.both.code} reset to inherited (was Waived); now Not Started`,
      );

      const long = "x".repeat(REMOVED_ASSESSMENT_TEXT_LIMIT + 300);
      const verbose = await makePersonSetSystem({ status: "FULFILLED", evidence: long, notes: long, selfAssessmentAnswer: "YES" });
      await reset(verbose, control.both.id, users.owner);
      const kept = `${"x".repeat(REMOVED_ASSESSMENT_TEXT_LIMIT)}…`;
      expect((await events(verbose))[0].detail).toBe(
        `Assessment for ${control.both.code} reset to inherited (was Fulfilled; evidence: "${kept}"; notes: "${kept}"; Self-Assessment answer: Yes); now Not Started`,
      );
    });

    it("has one wording function for both outcomes", () => {
      const was = { status: "IN_PROGRESS" as const, evidence: null, notes: null, selfAssessmentAnswer: null };
      expect(describeResetAssessment("A.1", was, { status: "FULFILLED", source: { kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" } })).toBe(
        "Assessment for A.1 reset to inherited (was In Progress); now Fulfilled, inherited from the Organization",
      );
      expect(describeResetAssessment("A.1", was, { status: "NOT_STARTED", source: { kind: "SYSTEM" } })).toBe(
        "Assessment for A.1 reset to inherited (was In Progress); now Not Started",
      );
    });
  });

  describe("Assessment Queries and Risks", () => {
    it("leaves open and resolved Queries and a linked Risk exactly as they are, and doesn't refuse over an open Query", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({ status: "IN_PROGRESS", selfAssessmentAnswer: "NO" });
      const assessment = (await assessmentOf(systemId))!;
      for (const resolved of [false, true]) {
        await prisma.assessmentQuery.create({
          data: {
            controlAssessmentId: assessment.id,
            lastMessageAuthorId: users.reviewer,
            resolved,
            resolvedById: resolved ? users.reviewer : null,
            resolvedAt: resolved ? new Date("2026-02-01T00:00:00Z") : null,
            messages: { create: { authorId: users.reviewer, body: resolved ? "Resolved one" : "Open one" } },
          },
        });
      }
      await prisma.risk.create({
        data: {
          systemId,
          title: `Test Reset Risk ${SUFFIX}`,
          description: "d",
          severity: "MEDIUM",
          likelihood: "MEDIUM",
          ownerId: users.owner,
          controlAssessmentId: assessment.id,
        },
      });
      const before = await snapshot(systemId);
      const messagesBefore = await prisma.queryMessage.count({ where: { assessmentQuery: { controlAssessment: { systemId } } } });

      const response = await reset(systemId, control.both.id, users.owner);

      expect(response.status).toBe(200);
      const after = await snapshot(systemId);
      expect(after.queries).toEqual(before.queries);
      expect(after.risks).toEqual(before.risks);
      expect(after.risks).toHaveLength(1);
      expect(after.risks[0].controlAssessmentId).toBe(assessment.id);
      expect(await prisma.queryMessage.count({ where: { assessmentQuery: { controlAssessment: { systemId } } } })).toBe(messagesBefore);
      // The same row, with its Queries still on it, comes back in the response.
      const body = await response.json();
      expect(body.assessment.id).toBe(assessment.id);
      expect(body.assessment.queries).toHaveLength(2);
    });
  });

  describe("after a reset the row is untouched", () => {
    it("is removed by a recompute that stops the Control applying, where a person-set row is kept as stale", async () => {
      await setOrganization("FULFILLED");
      const both = [facetLive, facetStale];
      const staleRow = {
        controlId: control.stale.id,
        status: "FULFILLED" as const,
        evidence: "e",
        notes: "n",
        assessedById: users.owner,
        assessedAt: new Date(),
      };
      const resetSystem = await makeSystem({ facets: both });
      const keptSystem = await makeSystem({ facets: both });
      await prisma.controlAssessment.createMany({
        data: [
          { systemId: resetSystem, ...staleRow },
          { systemId: keptSystem, ...staleRow },
        ],
      });
      // The stale Control has an Organization source too, so it can be reset while it applies.
      await prisma.organizationControlImplementation.create({ data: { controlId: control.stale.id, status: "NOT_STARTED" } });

      expect((await reset(resetSystem, control.stale.id, users.owner)).status).toBe(200);
      for (const id of [resetSystem, keptSystem]) {
        const dropped = await patchSystem(
          new NextRequest(`http://localhost/api/systems/${id}`, {
            method: "PATCH",
            headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${users.admin}` }),
            body: JSON.stringify({ deploymentFacetIds: [facetLive] }),
          }),
          { params: Promise.resolve({ id }) },
        );
        expect(dropped.status).toBe(200);
      }

      expect(await assessmentOf(resetSystem, control.stale.id)).toBeNull();
      expect(await assessmentOf(keptSystem, control.stale.id)).not.toBeNull();
    });
  });

  describe("refusals change nothing", () => {
    it("returns 409 for a Per-System Control, which has no inheritance source to go back to", async () => {
      const systemId = await makeSystem();
      await prisma.controlAssessment.create({
        data: { systemId, controlId: control.perSystem.id, status: "FULFILLED", assessedById: users.owner, assessedAt: new Date() },
      });
      const before = await snapshot(systemId);

      for (const who of [users.owner, users.admin]) {
        const response = await reset(systemId, control.perSystem.id, who);
        expect(response.status).toBe(409);
        expect((await response.json()).error).toMatch(/no inheritance source/);
      }
      expect(await snapshot(systemId)).toEqual(before);
    });

    it("returns 409 for an already untouched Assessment, one nobody set, and a missing row", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makeSystem();

      // No row at all.
      const missing = await reset(systemId, control.both.id, users.owner);
      expect(missing.status).toBe(409);
      expect((await missing.json()).error).toMatch(/not set by a person/);
      expect(await assessmentOf(systemId)).toBeNull();

      // An untouched row.
      await prisma.controlAssessment.create({ data: { systemId, controlId: control.both.id } });
      let before = await snapshot(systemId);
      expect((await reset(systemId, control.both.id, users.owner)).status).toBe(409);
      expect(await snapshot(systemId)).toEqual(before);

      // A row nobody set that is not Not Started (left Fulfilled by a migration, or seed data).
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId, controlId: control.both.id } },
        data: { status: "FULFILLED", evidence: "Left Fulfilled by a migration" },
      });
      before = await snapshot(systemId);
      expect((await reset(systemId, control.both.id, users.owner)).status).toBe(409);
      expect(await snapshot(systemId)).toEqual(before);
    });

    it("returns 409 for a second reset in a row, with one event only", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem();

      expect((await reset(systemId, control.both.id, users.owner)).status).toBe(200);
      expect((await reset(systemId, control.both.id, users.owner)).status).toBe(409);

      expect(await events(systemId)).toHaveLength(1);
    });

    it("lets only one of two simultaneous resets through, with one event", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem();

      const responses = await Promise.all([
        reset(systemId, control.both.id, users.owner),
        reset(systemId, control.both.id, users.admin),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await events(systemId)).toHaveLength(1);
    });

    it("returns 409 for a stale Assessment, which is removed rather than reset, and 404 for a Control that doesn't exist", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makeSystem(); // doesn't declare the Facet the stale Control is scoped to
      await prisma.controlAssessment.create({
        data: { systemId, controlId: control.stale.id, status: "FULFILLED", assessedById: users.owner, assessedAt: new Date() },
      });
      await prisma.organizationControlImplementation.upsert({
        where: { controlId: control.stale.id },
        create: { controlId: control.stale.id, status: "FULFILLED" },
        update: { status: "FULFILLED" },
      });
      const before = await snapshot(systemId);

      const stale = await reset(systemId, control.stale.id, users.owner);
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toMatch(/no longer applies/);
      expect((await reset(systemId, "no-such-control", users.owner)).status).toBe(404);
      expect(await snapshot(systemId)).toEqual(before);
    });

    it.each([
      ["a SYSTEM_OWNER who doesn't own the System", "otherOwner"],
      ["a Reviewer", "reviewer"],
      ["a Risk Owner who doesn't own the System", "riskOwner"],
      ["a Viewer", "viewer"],
      ["a Business Risk Owner", "businessRiskOwner"],
      ["a Compliance Manager", "complianceManager"],
    ] as const)("refuses %s with 403 and changes nothing", async (_label, who) => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem();
      const before = await snapshot(systemId);

      const response = await reset(systemId, control.both.id, users[who]);

      expect(response.status).toBe(403);
      expect(await snapshot(systemId)).toEqual(before);
    });

    it("refuses a Compliance Manager even when they are the System's recorded owner", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makePersonSetSystem({}, { ownerId: users.complianceManager });
      const before = await snapshot(systemId);

      expect((await reset(systemId, control.both.id, users.complianceManager)).status).toBe(403);
      expect(await snapshot(systemId)).toEqual(before);
    });

    it("answers 403 before looking at the Assessment, so a non-owner learns nothing about it", async () => {
      await setOrganization("FULFILLED");
      const systemId = await makeSystem(); // no row, so an owner would get 409
      expect((await reset(systemId, control.both.id, users.viewer)).status).toBe(403);
    });

    it("returns 404 for a System the user can't see (a Draft they don't own) and for no such System", async () => {
      const draft = await makeSystem({ status: "DRAFT" });
      expect((await reset(draft, control.both.id, users.viewer)).status).toBe(404);
      expect((await reset("no-such-system", control.both.id, users.owner)).status).toBe(404);
    });

    it("rejects an unauthenticated request with 401", async () => {
      const systemId = await makePersonSetSystem();
      const before = await snapshot(systemId);

      expect((await reset(systemId, control.both.id, null)).status).toBe(401);
      expect(await snapshot(systemId)).toEqual(before);
    });
  });
});
