import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { onFrameworkPublished } from "@/lib/frameworks";
import { pickCapability } from "@/lib/capability-fulfillment";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { PATCH as patchSystem } from "../[id]/route";
import { POST as declareCapability } from "../[id]/capabilities/route";
import { DELETE as removeCapability } from "../[id]/capabilities/[capabilityId]/route";
import { POST as declareFrameworkScope } from "../[id]/framework-scopes/route";
import { POST as createMapping } from "../../frameworks/[id]/requirements/[requirementId]/mappings/route";
import { PATCH as patchControl } from "../../controls/[id]/route";

/**
 * Capability auto-fulfilment when a recompute makes Controls applicable (#110):
 * the same rules as declaring a Capability, run by every recompute path. A
 * newly applicable Control a declared Capability covers is created FULFILLED
 * (`fulfilledByCapabilityId`, the "Inherited via ..." note) in the same write as
 * the recompute; one no declared Capability covers starts Not Started; a touched
 * row is never overwritten; a `"system"` Change Event records it.
 *
 * Self-contained fixtures (CI's DB is migrated, not seeded). Every fixture
 * Control is scoped to a fixture Deployment Facet, so it only applies to fixture
 * Systems; the catalog cases use fixture non-base Frameworks only fixture Systems
 * have in scope. Assertions are on this file's own rows, by id.
 */

const SUFFIX = Date.now();
let counter = 0;
const next = () => `${SUFFIX}-${++counter}`;

function req(path: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;

describe("pickCapability: the deterministic choice among several Capabilities", () => {
  it("is the first by name, then by id, whatever the input order", () => {
    const a = { id: "z-id", name: "Alpha" };
    const b = { id: "a-id", name: "Beta" };
    const alphaTwin = { id: "b-id", name: "Alpha" };
    expect(pickCapability([b, a])).toBe(a);
    expect(pickCapability([a, b])).toBe(a);
    expect(pickCapability([a, alphaTwin, b])).toBe(alphaTwin);
    expect(pickCapability([alphaTwin, b, a])).toBe(alphaTwin);
    expect(pickCapability([])).toBeNull();
  });

  it("compares names by code unit, not by locale", () => {
    expect(pickCapability([{ id: "1", name: "a" }, { id: "2", name: "B" }])?.name).toBe("B");
  });
});

describe("Capability auto-fulfilment in every recompute path (#110)", { timeout: 60_000 }, () => {
  let ownerId: string;
  let cmId: string;
  const facetIds: string[] = [];
  // Created B first, so by id order B < A but by name order A < B.
  let capB: { id: string; name: string };
  let capA: { id: string; name: string };
  let capUndeclared: { id: string; name: string };
  const systemIds: string[] = [];
  const controlIds: string[] = [];
  const frameworkIds: string[] = [];
  const capabilityIds: string[] = [];

  beforeAll(async () => {
    const [owner, cm] = await Promise.all([
      prisma.user.create({ data: { email: `test-capfx-owner-${SUFFIX}@example.com`, name: "Capfx Owner", role: "SYSTEM_OWNER" } }),
      prisma.user.create({ data: { email: `test-capfx-cm-${SUFFIX}@example.com`, name: "Capfx CM", role: "COMPLIANCE_MANAGER" } }),
    ]);
    ownerId = owner.id;
    cmId = cm.id;
    capB = await prisma.capability.create({ data: { name: `Test Capfx Cap B ${SUFFIX}` } });
    capA = await prisma.capability.create({ data: { name: `Test Capfx Cap A ${SUFFIX}` } });
    capUndeclared = await prisma.capability.create({ data: { name: `Test Capfx Cap Undeclared ${SUFFIX}` } });
    capabilityIds.push(capA.id, capB.id, capUndeclared.id);
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({
      where: { OR: [{ systemId: { in: systemIds } }, { systemId: null, actorId: cmId }] },
    });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: frameworkIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
    await prisma.capability.deleteMany({ where: { id: { in: capabilityIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facetIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, cmId] } } });
  });

  /**
   * A fresh pair of Deployment Facets per test: Controls are scoped to one, Systems declare the other, so what one test
   * makes applicable can't leak into another test's Systems.
   */
  async function makeFacets() {
    const [a, b] = await Promise.all(
      ["A", "B"].map((label) => prisma.deploymentFacet.create({ data: { name: `Test Capfx Facet ${label} ${next()}` } })),
    );
    facetIds.push(a.id, b.id);
    return { fa: a.id, fb: b.id };
  }

  async function makeControl(facets: string[], capabilities: { id: string }[] = []) {
    const control = await prisma.control.create({
      data: {
        code: `TEST-CAPFX-${next()}`,
        title: "Test capability fulfilment control",
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: true,
        question: "Is it done?",
        deploymentFacets: { connect: facets.map((id) => ({ id })) },
        capabilities: { connect: capabilities.map((c) => ({ id: c.id })) },
      },
    });
    controlIds.push(control.id);
    return control;
  }

  async function makeFramework(status: "DRAFT" | "PUBLISHED" = "PUBLISHED") {
    const framework = await prisma.framework.create({
      data: { name: `Test Capfx FW ${next()}`, version: "1", status },
    });
    frameworkIds.push(framework.id);
    return framework;
  }

  async function makeRequirement(frameworkId: string) {
    return prisma.requirement.create({
      data: { frameworkId, code: `R-${next()}`, section: "S", title: "T", text: "t" },
    });
  }

  const mapDirect = (requirementId: string, controlId: string) =>
    prisma.controlMapping.create({ data: { requirementId, controlId, coverage: "FULL" } });

  async function makeSystem(opts: { facets: string[]; scope?: string[]; capabilities?: { id: string }[] }) {
    const system = await prisma.system.create({
      data: {
        name: `Test Capfx System ${next()}`,
        ownerId,
        status: "ONBOARDED",
        onboardedAt: new Date(),
        deploymentFacets: { connect: opts.facets.map((id) => ({ id })) },
        frameworkScopes: { connect: (opts.scope ?? []).map((id) => ({ id })) },
        capabilities: { connect: (opts.capabilities ?? []).map((c) => ({ id: c.id })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  const assessmentOf = (systemId: string, controlId: string) =>
    prisma.controlAssessment.findUnique({ where: { systemId_controlId: { systemId, controlId } } });
  const fulfilmentEvents = (systemId: string) =>
    prisma.changeEvent.findMany({
      where: { systemId, action: "ASSESSMENT_STATUS_CHANGED" },
      orderBy: { createdAt: "asc" },
    });

  /** The Assessment came out FULFILLED by `capability`, untouched by a human, with the note. */
  async function expectFulfilledVia(systemId: string, controlId: string, capability: { id: string; name: string }) {
    const row = await assessmentOf(systemId, controlId);
    expect(row).toMatchObject({
      status: "FULFILLED",
      fulfilledByCapabilityId: capability.id,
      notes: `Inherited via ${capability.name}`,
      assessedById: null,
    });
    expect(row?.assessedAt).not.toBeNull();
  }
  async function expectNotStarted(systemId: string, controlId: string) {
    expect(await assessmentOf(systemId, controlId)).toMatchObject({
      status: "NOT_STARTED",
      fulfilledByCapabilityId: null,
      notes: null,
      assessedById: null,
    });
  }

  describe("classification change", () => {
    it("fulfils a newly applicable Control a declared Capability covers; others start Not Started", async () => {
      const { fa, fb } = await makeFacets();
      const covered = await makeControl([fb], [capA]);
      const uncovered = await makeControl([fb]);
      const coveredByUndeclared = await makeControl([fb], [capUndeclared]);
      await mapControlsToBase([covered.id, uncovered.id, coveredByUndeclared.id]);
      const system = await makeSystem({ facets: [fa], capabilities: [capA] });

      const response = await patchSystem(
        req(`/api/systems/${system.id}`, "PATCH", ownerId, { deploymentFacetIds: [fa, fb] }),
        params({ id: system.id }),
      );
      expect(response.status).toBe(200);

      await expectFulfilledVia(system.id, covered.id, capA);
      await expectNotStarted(system.id, uncovered.id);
      await expectNotStarted(system.id, coveredByUndeclared.id);

      // The recompute's own event stays the person's and counts all three; the auto-fulfilment is a "system" event.
      const classification = await prisma.changeEvent.findMany({ where: { systemId: system.id, action: "CLASSIFICATION_CHANGED" } });
      expect(classification).toHaveLength(1);
      expect(classification[0]).toMatchObject({ actorId: ownerId });
      expect(classification[0].detail).toContain("+3/-0");
      const events = await fulfilmentEvents(system.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: "system",
        detail: `1 Control Assessment(s) auto-fulfilled via Capability "${capA.name}"`,
      });
    });

    it("never overwrites a touched row, and a System with no declared Capability gets only Not Started rows", async () => {
      const { fa, fb } = await makeFacets();
      const covered = await makeControl([fb], [capA]);
      const coveredToo = await makeControl([fb], [capA]);
      await mapControlsToBase([covered.id, coveredToo.id]);
      const system = await makeSystem({ facets: [fa], capabilities: [capA] });
      const bare = await makeSystem({ facets: [fa] });
      // A human already worked on this Assessment (it was left behind as stale), so it already has a row.
      await prisma.controlAssessment.create({
        data: { systemId: system.id, controlId: covered.id, status: "IN_PROGRESS", notes: "mine", assessedById: ownerId, assessedAt: new Date() },
      });

      for (const id of [system.id, bare.id]) {
        const response = await patchSystem(
          req(`/api/systems/${id}`, "PATCH", ownerId, { deploymentFacetIds: [fa, fb] }),
          params({ id }),
        );
        expect(response.status).toBe(200);
      }

      expect(await assessmentOf(system.id, covered.id)).toMatchObject({
        status: "IN_PROGRESS",
        notes: "mine",
        assessedById: ownerId,
        fulfilledByCapabilityId: null,
      });
      await expectFulfilledVia(system.id, coveredToo.id, capA);
      expect((await fulfilmentEvents(system.id))[0].detail).toContain("1 Control Assessment(s)");
      await expectNotStarted(bare.id, covered.id);
      await expectNotStarted(bare.id, coveredToo.id);
      expect(await fulfilmentEvents(bare.id)).toHaveLength(0);
    });

    it("picks the first Capability by name when two declared ones cover the same Control", async () => {
      const { fa, fb } = await makeFacets();
      const control = await makeControl([fb], [capB, capA]);
      await mapControlsToBase([control.id]);
      // Declared in the "wrong" order too (B first), and B was created before A.
      const system = await makeSystem({ facets: [fa], capabilities: [capB, capA] });

      await patchSystem(
        req(`/api/systems/${system.id}`, "PATCH", ownerId, { deploymentFacetIds: [fa, fb] }),
        params({ id: system.id }),
      );

      await expectFulfilledVia(system.id, control.id, capA);
      const events = await fulfilmentEvents(system.id);
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain(capA.name);

      // With only B declared, B covers it.
      const onlyB = await makeSystem({ facets: [fa], capabilities: [capB] });
      await patchSystem(
        req(`/api/systems/${onlyB.id}`, "PATCH", ownerId, { deploymentFacetIds: [fa, fb] }),
        params({ id: onlyB.id }),
      );
      await expectFulfilledVia(onlyB.id, control.id, capB);
    });

    it("writes one event per Capability when two cover different newly applicable Controls", async () => {
      const { fa, fb } = await makeFacets();
      const viaA = await makeControl([fb], [capA]);
      const viaB = await makeControl([fb], [capB]);
      const viaB2 = await makeControl([fb], [capB]);
      await mapControlsToBase([viaA.id, viaB.id, viaB2.id]);
      const system = await makeSystem({ facets: [fa], capabilities: [capA, capB] });

      await patchSystem(
        req(`/api/systems/${system.id}`, "PATCH", ownerId, { deploymentFacetIds: [fa, fb] }),
        params({ id: system.id }),
      );

      await expectFulfilledVia(system.id, viaA.id, capA);
      await expectFulfilledVia(system.id, viaB.id, capB);
      await expectFulfilledVia(system.id, viaB2.id, capB);
      const details = (await fulfilmentEvents(system.id)).map((e) => e.detail).sort();
      expect(details).toEqual(
        [
          `1 Control Assessment(s) auto-fulfilled via Capability "${capA.name}"`,
          `2 Control Assessment(s) auto-fulfilled via Capability "${capB.name}"`,
        ].sort(),
      );
    });
  });

  describe("Framework Scope declared", () => {
    it("fulfils a newly applicable Control a declared Capability covers; others start Not Started", async () => {
      const { fa } = await makeFacets();
      const framework = await makeFramework();
      const requirement = await makeRequirement(framework.id);
      const covered = await makeControl([fa], [capA]);
      const uncovered = await makeControl([fa]);
      await mapDirect(requirement.id, covered.id);
      await mapDirect(requirement.id, uncovered.id);
      const system = await makeSystem({ facets: [fa], capabilities: [capA] });
      // Touched, already-present row for a Control the scope would otherwise fulfil.
      const touched = await makeControl([fa], [capA]);
      await mapDirect(requirement.id, touched.id);
      await prisma.controlAssessment.create({
        data: { systemId: system.id, controlId: touched.id, status: "WAIVED", notes: "waived by a person", assessedById: ownerId, assessedAt: new Date() },
      });

      const response = await declareFrameworkScope(
        req(`/api/systems/${system.id}/framework-scopes`, "POST", ownerId, { frameworkId: framework.id }),
        params({ id: system.id }),
      );
      expect(response.status).toBe(201);

      await expectFulfilledVia(system.id, covered.id, capA);
      await expectNotStarted(system.id, uncovered.id);
      expect(await assessmentOf(system.id, touched.id)).toMatchObject({
        status: "WAIVED",
        notes: "waived by a person",
        assessedById: ownerId,
        fulfilledByCapabilityId: null,
      });
      const events = await fulfilmentEvents(system.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: "system",
        detail: `1 Control Assessment(s) auto-fulfilled via Capability "${capA.name}"`,
      });
    });
  });

  describe("catalog change", () => {
    it("a Control Mapping added fulfils on the Systems declaring a covering Capability only; one event each", async () => {
      const { fa } = await makeFacets();
      const framework = await makeFramework();
      const requirement = await makeRequirement(framework.id);
      const covered = await makeControl([fa], [capA]);
      const uncovered = await makeControl([fa]);
      const declaring = await makeSystem({ facets: [fa], scope: [framework.id], capabilities: [capA] });
      const bare = await makeSystem({ facets: [fa], scope: [framework.id] });
      const touchedSystem = await makeSystem({ facets: [fa], scope: [framework.id], capabilities: [capA] });
      await prisma.controlAssessment.create({
        data: { systemId: touchedSystem.id, controlId: covered.id, status: "IN_PROGRESS", assessedById: ownerId, assessedAt: new Date() },
      });

      for (const control of [covered, uncovered]) {
        const response = await createMapping(
          req(`/api/frameworks/${framework.id}/requirements/${requirement.id}/mappings`, "POST", cmId, {
            controlId: control.id,
            coverage: "FULL",
          }),
          params({ id: framework.id, requirementId: requirement.id }),
        );
        expect(response.status).toBe(201);
      }

      await expectFulfilledVia(declaring.id, covered.id, capA);
      await expectNotStarted(declaring.id, uncovered.id);
      await expectNotStarted(bare.id, covered.id);
      await expectNotStarted(bare.id, uncovered.id);
      // The touched row is left alone; the uncovered Control next to it still starts Not Started.
      expect(await assessmentOf(touchedSystem.id, covered.id)).toMatchObject({
        status: "IN_PROGRESS",
        assessedById: ownerId,
        fulfilledByCapabilityId: null,
      });
      await expectNotStarted(touchedSystem.id, uncovered.id);

      const events = await fulfilmentEvents(declaring.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: "system",
        detail: `1 Control Assessment(s) auto-fulfilled via Capability "${capA.name}"`,
      });
      expect(await fulfilmentEvents(bare.id)).toHaveLength(0);
      expect(await fulfilmentEvents(touchedSystem.id)).toHaveLength(0);
      // The recompute events are still there, one per mapping.
      const recomputed = await prisma.changeEvent.count({ where: { systemId: declaring.id, action: "APPLICABILITY_RECOMPUTED" } });
      expect(recomputed).toBe(2);
    });

    it("a Control scoping edit fulfils a Control that became applicable", async () => {
      const { fa, fb } = await makeFacets();
      const framework = await makeFramework();
      const requirement = await makeRequirement(framework.id);
      // Scoped to Facet B only: it doesn't apply to a Facet A System until its scoping is widened.
      const covered = await makeControl([fb], [capA]);
      const uncovered = await makeControl([fb]);
      await mapDirect(requirement.id, covered.id);
      await mapDirect(requirement.id, uncovered.id);
      const system = await makeSystem({ facets: [fa], scope: [framework.id], capabilities: [capA] });

      for (const control of [covered, uncovered]) {
        const response = await patchControl(
          req(`/api/controls/${control.id}`, "PATCH", cmId, { deploymentFacetIds: [fa, fb] }),
          params({ id: control.id }),
        );
        expect(response.status).toBe(200);
      }

      await expectFulfilledVia(system.id, covered.id, capA);
      await expectNotStarted(system.id, uncovered.id);
      expect(await fulfilmentEvents(system.id)).toHaveLength(1);
    });

    it("Framework publish fulfils, and the summary counts it; the hook is idempotent", async () => {
      const { fa } = await makeFacets();
      const draft = await makeFramework("DRAFT");
      const requirement = await makeRequirement(draft.id);
      const covered = await makeControl([fa], [capA]);
      const uncovered = await makeControl([fa]);
      await mapDirect(requirement.id, covered.id);
      await mapDirect(requirement.id, uncovered.id);
      const system = await makeSystem({ facets: [fa], scope: [draft.id], capabilities: [capA] });
      await prisma.framework.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } });

      const summary = await onFrameworkPublished(draft.id);
      expect(summary).toMatchObject({ systems: 1, changed: 1, added: 2, fulfilled: 1 });
      await expectFulfilledVia(system.id, covered.id, capA);
      await expectNotStarted(system.id, uncovered.id);

      // Running it again changes nothing: the rows exist, so nothing is created and nothing is overwritten.
      expect(await onFrameworkPublished(draft.id)).toMatchObject({ changed: 0, added: 0, fulfilled: 0 });
      expect(await fulfilmentEvents(system.id)).toHaveLength(1);
    });

    it("picks the first Capability by name for each System, from its own declared set", async () => {
      const { fa } = await makeFacets();
      const framework = await makeFramework();
      const requirement = await makeRequirement(framework.id);
      const control = await makeControl([fa], [capB, capA]);
      const both = await makeSystem({ facets: [fa], scope: [framework.id], capabilities: [capB, capA] });
      const onlyB = await makeSystem({ facets: [fa], scope: [framework.id], capabilities: [capB] });

      const response = await createMapping(
        req(`/api/frameworks/${framework.id}/requirements/${requirement.id}/mappings`, "POST", cmId, {
          controlId: control.id,
          coverage: "PARTIAL",
        }),
        params({ id: framework.id, requirementId: requirement.id }),
      );
      expect(response.status).toBe(201);

      await expectFulfilledVia(both.id, control.id, capA);
      await expectFulfilledVia(onlyB.id, control.id, capB);
    });
  });

  describe("declaring and removing a Capability still work", () => {
    it("declaring fulfils the applicable Controls it covers, as before", async () => {
      const { fa } = await makeFacets();
      const control = await makeControl([fa], [capA]);
      await mapControlsToBase([control.id]);
      const system = await makeSystem({ facets: [fa] });

      const response = await declareCapability(
        req(`/api/systems/${system.id}/capabilities`, "POST", ownerId, { capabilityId: capA.id }),
        params({ id: system.id }),
      );
      expect(response.status).toBe(201);

      await expectFulfilledVia(system.id, control.id, capA);
      expect((await fulfilmentEvents(system.id)).map((e) => e.detail)).toEqual([
        `1 Control Assessment(s) auto-fulfilled via Capability "${capA.name}"`,
      ]);
    });

    it("removing re-attributes to the first surviving Capability by name, and reverts when none is left", async () => {
      const { fa } = await makeFacets();
      const control = await makeControl([fa], [capA, capB, capUndeclared]);
      const onlyA = await makeControl([fa], [capA]);
      await mapControlsToBase([control.id, onlyA.id]);
      // Declared in an order unrelated to the names; the Assessments were fulfilled by A.
      const system = await makeSystem({ facets: [fa], capabilities: [capUndeclared, capB, capA] });
      for (const controlId of [control.id, onlyA.id]) {
        await prisma.controlAssessment.create({
          data: { systemId: system.id, controlId, status: "FULFILLED", notes: `Inherited via ${capA.name}`, fulfilledByCapabilityId: capA.id, assessedAt: new Date() },
        });
      }

      const removed = await removeCapability(
        req(`/api/systems/${system.id}/capabilities/${capA.id}`, "DELETE", ownerId),
        params({ id: system.id, capabilityId: capA.id }),
      );
      expect(removed.status).toBeLessThan(300);

      await expectFulfilledVia(system.id, control.id, capB);
      await expectNotStarted(system.id, onlyA.id);
    });
  });
});
