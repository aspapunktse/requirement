import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getComplianceForSystems } from "@/lib/compliance";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { getStaleAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { PATCH as patchSystem } from "../[id]/route";
import { POST as declareProviderDependency } from "../[id]/dependencies/route";
import { DELETE as removeProviderDependency } from "../[id]/dependencies/[providerId]/route";
import { POST as declareFrameworkScope } from "../[id]/framework-scopes/route";
import { DELETE as removeFrameworkScope } from "../[id]/framework-scopes/[frameworkId]/route";
import { PATCH as patchAssessment } from "../[id]/assessments/[controlId]/route";

/**
 * Continuous compliance (ADR 0006, #86): Deployment Facets, Impact Levels,
 * Provider dependencies and Framework Scope can all be changed by
 * the System's owner or an Admin at any lifecycle stage. Every change
 * recomputes the Assessments (newly applicable -> Not Started, untouched
 * no-longer-applicable -> removed, touched -> stale) and never changes the
 * System's status, `onboardedAt` or Approval history (F-AP.4). The new Not
 * Started mandatory Controls show up in the owner's "My tasks" data and in the
 * compliance figures.
 *
 * Self-contained fixtures (CI's test database is migrated, not seeded): every
 * fixture Control is scoped to a fixture Deployment Facet, so it only applies
 * to the fixture Systems here, and mapped to a Published Framework.
 */

const SUFFIX = Date.now();

function req(url: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Continuous compliance: classification and scope change at any lifecycle stage (#86)", { timeout: 30_000 }, () => {
  const users = {} as Record<"owner" | "otherOwner" | "admin" | "reviewer", string>;
  const systemIds: string[] = [];
  // The Systems the current test made; removed after it, so the owner's System count (which "My tasks" scans) stays small.
  const testSystemIds: string[] = [];
  const controlIds: string[] = [];
  let facetA: string;
  let facetB: string;
  let providerId: string;
  let frameworkId: string;
  // A second fixture Published Framework every System declares up front, with one Requirement per Control of the
  // Facet / Impact / Provider mechanisms; `frameworkId` (declared by the Framework Scope mechanism) has the rest.
  // Together they are the Requirement-based compliance figures (#90) `complianceOf` reads.
  let complianceFrameworkId: string;
  // One newly applicable Control per mechanism.
  const control = {} as Record<"facet" | "impact" | "scope" | "provider", string>;

  async function makeControl(
    key: keyof typeof control,
    data: Record<string, unknown>,
    facetIds: string[] = [facetA],
  ) {
    const created = await prisma.control.create({
      data: {
        code: `TEST-CC-${key}-${SUFFIX}`,
        title: `Test CC ${key}`,
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: true,
        deploymentFacets: { connect: facetIds.map((id) => ({ id })) },
        ...data,
      },
    });
    controlIds.push(created.id);
    control[key] = created.id;
    return created.id;
  }

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "SYSTEM_OWNER"],
      ["otherOwner", "SYSTEM_OWNER"],
      ["admin", "ADMIN"],
      ["reviewer", "REVIEWER"],
    ] as const) {
      users[key] = (
        await prisma.user.create({
          data: { email: `test-cc-${key}-${SUFFIX}@example.com`, name: `Test CC ${key}`, role },
        })
      ).id;
    }
    facetA = (await prisma.deploymentFacet.create({ data: { name: `Test CC Facet A ${SUFFIX}` } })).id;
    facetB = (await prisma.deploymentFacet.create({ data: { name: `Test CC Facet B ${SUFFIX}` } })).id;
    frameworkId = (
      await prisma.framework.create({ data: { name: `Test CC Framework ${SUFFIX}`, version: "1", status: "PUBLISHED" } })
    ).id;

    complianceFrameworkId = (
      await prisma.framework.create({
        data: { name: `Test CC Compliance Framework ${SUFFIX}`, version: "1", status: "PUBLISHED" },
      })
    ).id;

    // Every System here declares Facet A only; each Control below becomes applicable through exactly one change.
    await makeControl("facet", {}, [facetB]);
    await makeControl("impact", { minConfidentialityImpactLevel: "HIGH" });
    await makeControl("scope", {});
    await makeControl("provider", {});
    await mapControlsToBase([control.facet, control.impact, control.provider]);
    // Every fixture Control is also mapped to a fixture Framework, so compliance can be read for those Frameworks alone
    // (`complianceOf`), unaffected by other Controls that come and go while other test files run. The compliance
    // Framework's Requirements are one per Control, so each newly applicable Control is one more applicable Requirement.
    await mapControlsToFramework(frameworkId, [control.scope, control.facet, control.impact, control.provider]);
    for (const id of [control.facet, control.impact, control.provider]) {
      await mapControlsToFramework(complianceFrameworkId, [id]);
    }
    // An Onboarded Provider (owned by the Admin, so it is not in the owner's "My tasks" scan) offering the
    // provider Control in Full, Fulfilled: a System that depends on it inherits that Control live.
    providerId = (
      await prisma.system.create({
        data: {
          name: `Test CC Provider ${SUFFIX}`,
          ownerId: users.admin,
          status: "ONBOARDED",
          isProvider: true,
          deploymentFacets: { connect: { id: facetA } },
        },
      })
    ).id;
    systemIds.push(providerId);
    await prisma.controlAssessment.create({
      data: { systemId: providerId, controlId: control.provider, status: "FULFILLED" },
    });
    await prisma.controlOffering.create({ data: { providerId, controlId: control.provider, type: "FULL" } });
  });

  afterEach(async () => {
    const ids = testSystemIds.splice(0);
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: ids } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: ids } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: ids } } });
    await prisma.system.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkId, complianceFrameworkId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetA, facetB] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  /** A System owned by `owner`, declaring Facet A, in `status`, with the Approval history that status implies. */
  async function makeSystem(status: OnboardingStatus) {
    const system = await prisma.system.create({
      data: {
        name: `Test CC ${status} System ${SUFFIX}-${systemIds.length}`,
        ownerId: users.owner,
        status,
        onboardedAt: status === "ONBOARDED" ? new Date("2026-01-15T10:00:00Z") : null,
        deploymentFacets: { connect: { id: facetA } },
        frameworkScopes: { connect: { id: complianceFrameworkId } },
      },
    });
    systemIds.push(system.id);
    testSystemIds.push(system.id);
    if (status === "APPROVED" || status === "ONBOARDED") {
      await prisma.approval.create({ data: { systemId: system.id, reviewRoundId: (await prisma.reviewRound.create({ data: { systemId: system.id } })).id, approverId: users.reviewer, decision: "APPROVED" } });
    }
    return system.id;
  }

  /** What F-AP.4 says a recompute must never change. */
  async function lifecycle(systemId: string) {
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    const approvals = await prisma.approval.findMany({ where: { systemId }, orderBy: { id: "asc" } });
    return {
      status: system.status,
      onboardedAt: system.onboardedAt,
      approvals: approvals.map((a) => `${a.id}:${a.decision}:${a.approverId}`),
    };
  }

  /** Everything a refused change could have touched. */
  async function snapshot(systemId: string) {
    const system = await prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: { deploymentFacets: true, providerDependencies: true, frameworkScopes: true },
    });
    return {
      ...(await lifecycle(systemId)),
      facets: system.deploymentFacets.map((f) => f.id).sort(),
      providerDependencies: system.providerDependencies.map((d) => d.providerId).sort(),
      scopes: system.frameworkScopes.map((f) => f.id).sort(),
      impact: [system.confidentialityImpactLevel, system.integrityImpactLevel, system.availabilityImpactLevel],
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } })).map(
        (a) => `${a.controlId}:${a.status}:${a.assessedById}`,
      ),
      changeEvents: await prisma.changeEvent.count({ where: { systemId } }),
    };
  }

  /**
   * Is `controlId` one of the mandatory Controls still to assess on the System, and does the owner's "My tasks" data
   * report the System as needing assessment? (Checked per Control rather than by an exact count: on the seeded dev DB,
   * and while other test files' fixtures come and go, other Controls are unassessed here too.)
   */
  async function isTask(systemId: string, controlId: string) {
    const system = await prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });
    const unaddressed = (await getUnaddressedMandatoryControls(system)).map((c) => c.id);
    const entry = (await getSystemsNeedingAttention(users.owner)).find(
      (e) => e.id === systemId && e.reason === "needs-assessment",
    );
    return unaddressed.includes(controlId) && entry?.reason === "needs-assessment" && entry.count >= 1;
  }

  /** Requirements Met and applicable on the System, over the two fixture Frameworks (a Framework not in scope counts 0). */
  async function complianceOf(systemId: string) {
    const figures = await Promise.all(
      [complianceFrameworkId, frameworkId].map((id) => getComplianceForSystems({ id: systemId }, { frameworkId: id })),
    );
    return { met: figures[0].met + figures[1].met, applicable: figures[0].applicable + figures[1].applicable };
  }

  type Mechanism = {
    /** The one fixture Control this change makes applicable. */
    control: string;
    run: (systemId: string, userId: string) => Promise<Response>;
    ok: number;
  };
  const mechanisms: Record<"Deployment Facets" | "Impact Levels" | "Framework Scope", Mechanism> = {
    "Deployment Facets": {
      get control() {
        return control.facet;
      },
      ok: 200,
      run: (id, u) =>
        patchSystem(req(`/api/systems/${id}`, "PATCH", u, { deploymentFacetIds: [facetA, facetB] }), ctx(id)),
    },
    "Impact Levels": {
      get control() {
        return control.impact;
      },
      ok: 200,
      run: (id, u) => patchSystem(req(`/api/systems/${id}`, "PATCH", u, { confidentialityImpactLevel: "HIGH" }), ctx(id)),
    },
    "Framework Scope": {
      get control() {
        return control.scope;
      },
      ok: 201,
      run: (id, u) =>
        declareFrameworkScope(req(`/api/systems/${id}/framework-scopes`, "POST", u, { frameworkId }), ctx(id)),
    },
  };
  type MechanismName = keyof typeof mechanisms;
  const MECHANISM_NAMES = Object.keys(mechanisms) as MechanismName[];
  const STATUSES = ["IN_REVIEW", "APPROVED", "ONBOARDED"] as const;

  describe.each(STATUSES)("on a %s System", (status) => {
    // A SYSTEM_OWNER sees only their own Systems and Onboarded ones, so a non-owner gets 404 (existence not leaked) on
    // an In Review or Approved System and 403 on an Onboarded one; a Reviewer sees every non-Draft System, so 403.
    const expectedRefusal = (who: "otherOwner" | "reviewer") =>
      who === "otherOwner" && status !== "ONBOARDED" ? 404 : 403;

    it.each(MECHANISM_NAMES.flatMap((name) => [["owner", name] as const, ["admin", name] as const]))(
      "lets the %s change %s: newly applicable Control -> Not Started, in My tasks and compliance, status and Approval history untouched (F-AP.4)",
      async (who, name) => {
        const mechanism = mechanisms[name];
        const systemId = await makeSystem(status);
        const lifecycleBefore = await lifecycle(systemId);
        const complianceBefore = await complianceOf(systemId);
        expect(await isTask(systemId, mechanism.control)).toBe(false);

        const response = await mechanism.run(systemId, users[who]);
        expect(response.status).toBe(mechanism.ok);

        // The recompute: a Not Started, untouched Assessment for exactly the newly applicable Control.
        const rows = await prisma.controlAssessment.findMany({ where: { systemId } });
        expect(rows.map((a) => [a.controlId, a.status, a.assessedById])).toEqual([[mechanism.control, "NOT_STARTED", null]]);

        // F-AP.4: nothing about the lifecycle moved.
        expect(await lifecycle(systemId)).toEqual(lifecycleBefore);

        // "My tasks" (one more mandatory Control to assess) and the compliance figures (one more applicable, Not Met Requirement).
        expect(await isTask(systemId, mechanism.control)).toBe(true);
        const complianceAfter = await complianceOf(systemId);
        expect(complianceAfter).toEqual({ met: complianceBefore.met, applicable: complianceBefore.applicable + 1 });
      },
    );

    it.each(MECHANISM_NAMES)(
      "refuses a non-owner (403, or 404 when they can't see the System) and a Reviewer (403) changing %s, changing nothing",
      async (name) => {
        const systemId = await makeSystem(status);
        const before = await snapshot(systemId);
        for (const who of ["otherOwner", "reviewer"] as const) {
          const response = await mechanisms[name].run(systemId, users[who]);
          expect(response.status, `${who}: ${name}`).toBe(expectedRefusal(who));
          expect(await snapshot(systemId), `${who}: ${name} changed something`).toEqual(before);
        }
      },
    );

    it("lets the owner declare and an Admin remove a Provider dependency: the Provider's Offering counts live and stops with it, and the status is never touched", async () => {
      const systemId = await makeSystem(status);
      const lifecycleBefore = await lifecycle(systemId);
      const complianceBefore = await complianceOf(systemId);
      const own = { where: { systemId_controlId: { systemId, controlId: control.provider } } };

      const declared = await declareProviderDependency(
        req(`/api/systems/${systemId}/dependencies`, "POST", users.owner, { providerId }),
        ctx(systemId),
      );
      expect(declared.status).toBe(201);
      // Nothing is copied into the System: it inherits the Fulfilled Control live.
      expect(await prisma.controlAssessment.findUnique(own)).toBeNull();
      expect(await lifecycle(systemId)).toEqual(lifecycleBefore);
      // The Provider's Control was already applicable (and unresolved), so its Requirement was already counted and
      // Not Met; the inherited credit makes it Met.
      expect(await complianceOf(systemId)).toEqual({
        met: complianceBefore.met + 1,
        applicable: complianceBefore.applicable,
      });
      expect(await isTask(systemId, control.provider)).toBe(false);

      const removed = await removeProviderDependency(
        req(`/api/systems/${systemId}/dependencies/${providerId}`, "DELETE", users.admin),
        { params: Promise.resolve({ id: systemId, providerId }) },
      );
      expect(removed.status).toBe(200);
      expect(await prisma.controlAssessment.findUnique(own)).toBeNull();
      expect(await lifecycle(systemId)).toEqual(lifecycleBefore);
      expect(await complianceOf(systemId)).toEqual(complianceBefore);
      // The Control is an open mandatory Control again, so it is a task for the owner.
      expect(await isTask(systemId, control.provider)).toBe(true);
    });

    it("refuses a non-owner declaring a Provider dependency (403, or 404 when they can't see the System), changing nothing", async () => {
      const systemId = await makeSystem(status);
      const before = await snapshot(systemId);
      const response = await declareProviderDependency(
        req(`/api/systems/${systemId}/dependencies`, "POST", users.otherOwner, { providerId }),
        ctx(systemId),
      );
      expect(response.status).toBe(expectedRefusal("otherOwner"));
      expect(await snapshot(systemId)).toEqual(before);
    });
  });

  it("keeps a touched Assessment as stale, and reports it, when the owner undoes a change on an Onboarded System", async () => {
    const systemId = await makeSystem("ONBOARDED");
    const lifecycleBefore = await lifecycle(systemId);
    const declared = await mechanisms["Framework Scope"].run(systemId, users.owner);
    expect(declared.status).toBe(201);
    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId, controlId: control.scope } },
      data: { status: "FULFILLED", assessedById: users.owner },
    });

    const removed = await removeFrameworkScope(
      req(`/api/systems/${systemId}/framework-scopes/${frameworkId}`, "DELETE", users.owner),
      { params: Promise.resolve({ id: systemId, frameworkId }) },
    );
    expect(removed.status).toBe(200);

    const system = await prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });
    expect((await getStaleAssessments(system)).map((a) => a.controlId)).toEqual([control.scope]);
    expect(
      (await getSystemsNeedingAttention(users.owner)).filter((e) => e.id === systemId && e.reason === "stale"),
    ).toHaveLength(1);
    expect(await lifecycle(systemId)).toEqual(lifecycleBefore);
  });

  it("lets the owner work a newly applicable Control on an Onboarded System, clearing it from My tasks without touching the status", async () => {
    const systemId = await makeSystem("ONBOARDED");
    const lifecycleBefore = await lifecycle(systemId);
    await mechanisms["Deployment Facets"].run(systemId, users.owner);
    expect(await isTask(systemId, control.facet)).toBe(true);

    const response = await patchAssessment(
      req(`/api/systems/${systemId}/assessments/${control.facet}`, "PATCH", users.owner, { status: "IN_PROGRESS" }),
      { params: Promise.resolve({ id: systemId, controlId: control.facet }) },
    );
    expect(response.status).toBe(200);
    expect(await isTask(systemId, control.facet)).toBe(false);
    expect(await lifecycle(systemId)).toEqual(lifecycleBefore);

    const fulfilled = await patchAssessment(
      req(`/api/systems/${systemId}/assessments/${control.facet}`, "PATCH", users.owner, {
        status: "FULFILLED",
        evidence: "https://example.com/evidence",
      }),
      { params: Promise.resolve({ id: systemId, controlId: control.facet }) },
    );
    expect(fulfilled.status).toBe(200);
    expect(await lifecycle(systemId)).toEqual(lifecycleBefore);
  });
});
