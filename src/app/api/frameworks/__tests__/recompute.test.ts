import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ImpactLevel, OnboardingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getStaleAssessments } from "@/lib/control-assessments";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { onFrameworkPublished } from "@/lib/frameworks";
import { getBaseFramework, mapControlsToBase } from "@/test/framework-fixtures";
import { POST as publishFramework } from "../[id]/publish/route";
import { DELETE as deleteRequirement } from "../[id]/requirements/[requirementId]/route";
import { POST as createMapping } from "../[id]/requirements/[requirementId]/mappings/route";
import {
  PATCH as patchMapping,
  DELETE as deleteMapping,
} from "../[id]/requirements/[requirementId]/mappings/[mappingId]/route";
import { POST as createSupplementaryControl } from "../[id]/requirements/[requirementId]/supplementary-control/route";
import { PATCH as patchControl } from "../../controls/[id]/route";

/**
 * Recompute on requirement-database changes (#87, F-AP.3, F-FW.5, F-CL.7):
 * publishing a Framework, adding/removing a Control Mapping on a Published
 * Framework (a Requirement delete included), a Supplementary Control created
 * from a gap, and editing a Control's scoping recompute the affected Systems
 * only: Not Started for newly applicable Controls, untouched no-longer-
 * applicable Assessments removed, touched ones kept as stale, a `"system"`
 * Change Event only where the set changed, and never a change to status or
 * Approvals (F-AP.4).
 *
 * Self-contained fixtures (CI's DB is migrated, not seeded). Every fixture
 * Control is scoped to a fixture Deployment Facet (except the Supplementary
 * Control, which the API can't scope, and which only applies to Systems having
 * a fixture Framework in scope), and every mapping/publish test uses fixture
 * non-base Frameworks that only fixture Systems have in scope, so nothing here
 * fans out into other test files' Systems. The one exception, the base
 * Framework test, uses a facet-scoped Control on a fixture Requirement of the
 * base, so the fan-out loads every System but only writes to this file's.
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

describe("Recompute affected Systems on catalog changes (#87)", { timeout: 60_000 }, () => {
  let cmId: string;
  let ownerId: string;
  let facetA: string;
  let facetB: string;
  const systemIds: string[] = [];
  const controlIds: string[] = [];
  const frameworkIds: string[] = [];
  const facetIds: string[] = [];

  beforeAll(async () => {
    const [cm, owner] = await Promise.all([
      prisma.user.create({ data: { email: `test-recompute-cm-${SUFFIX}@example.com`, name: "Recompute CM", role: "COMPLIANCE_MANAGER" } }),
      prisma.user.create({ data: { email: `test-recompute-owner-${SUFFIX}@example.com`, name: "Recompute Owner", role: "SYSTEM_OWNER" } }),
    ]);
    cmId = cm.id;
    ownerId = owner.id;
    [facetA, facetB] = (
      await Promise.all([
        prisma.deploymentFacet.create({ data: { name: `Test Recompute Facet A ${SUFFIX}` } }),
        prisma.deploymentFacet.create({ data: { name: `Test Recompute Facet B ${SUFFIX}` } }),
      ])
    ).map((f) => f.id);
    facetIds.push(facetA, facetB);
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({
      where: { OR: [{ systemId: { in: systemIds } }, { systemId: null, actorId: cmId }] },
    });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: frameworkIds } } });
    // Supplementary Controls made through the API aren't in controlIds, but reference their origin Framework.
    const supplementary = await prisma.control.findMany({
      where: { originFrameworkId: { in: frameworkIds } },
      select: { id: true },
    });
    await prisma.control.deleteMany({ where: { id: { in: [...controlIds, ...supplementary.map((c) => c.id)] } } });
    await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facetIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [cmId, ownerId] } } });
  });

  async function makeFramework(status: "DRAFT" | "PUBLISHED") {
    const framework = await prisma.framework.create({
      data: { name: `Test Recompute FW ${next()}`, version: "1", status },
    });
    frameworkIds.push(framework.id);
    return framework;
  }

  async function makeRequirement(frameworkId: string) {
    return prisma.requirement.create({
      data: { frameworkId, code: `R-${next()}`, section: "S", title: "T", text: "t" },
    });
  }

  async function makeControl(facets: string[] = [facetA], extra: Record<string, unknown> = {}) {
    const control = await prisma.control.create({
      data: {
        code: `TEST-RC-${next()}`,
        title: "Test recompute control",
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        mandatory: true,
        question: "Is it done?",
        deploymentFacets: { connect: facets.map((id) => ({ id })) },
        ...extra,
      },
    });
    controlIds.push(control.id);
    return control;
  }

  async function makeSystem(opts: {
    facets?: string[];
    scope?: string[];
    status?: OnboardingStatus;
    level?: ImpactLevel;
  }) {
    const system = await prisma.system.create({
      data: {
        name: `Test Recompute System ${next()}`,
        ownerId,
        status: opts.status ?? "DRAFT",
        onboardedAt: opts.status === "ONBOARDED" ? new Date() : null,
        confidentialityImpactLevel: opts.level ?? null,
        deploymentFacets: { connect: (opts.facets ?? [facetA]).map((id) => ({ id })) },
        frameworkScopes: { connect: (opts.scope ?? []).map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  /** Map `controlId` to `requirementId` directly (test setup, no recompute). */
  function mapDirect(requirementId: string, controlId: string) {
    return prisma.controlMapping.create({ data: { requirementId, controlId, coverage: "FULL" } });
  }

  async function rows(systemId: string, ids: string[]) {
    const found = await prisma.controlAssessment.findMany({ where: { systemId, controlId: { in: ids } } });
    return new Map(found.map((a) => [a.controlId, a]));
  }
  const recomputeEvents = (systemId: string) =>
    prisma.changeEvent.findMany({ where: { systemId, action: "APPLICABILITY_RECOMPUTED" }, orderBy: { createdAt: "asc" } });
  const loadForStale = (id: string) =>
    prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, regulatoryOverlays: true, frameworkScopes: { select: { id: true } } },
    });
  /** Everything a recompute must never touch, plus the System's rows, for "no change" assertions. */
  async function fingerprint(systemId: string) {
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    return {
      status: system.status,
      onboardedAt: system.onboardedAt?.toISOString() ?? null,
      approvals: await prisma.approval.count({ where: { systemId } }),
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } })).map(
        (a) => `${a.controlId}:${a.status}:${a.assessedById}`,
      ),
      events: await prisma.changeEvent.count({ where: { systemId } }),
    };
  }

  const addMapping = (frameworkId: string, requirementId: string, controlId: string, coverage = "FULL") =>
    createMapping(
      req(`/api/frameworks/${frameworkId}/requirements/${requirementId}/mappings`, "POST", cmId, { controlId, coverage }),
      params({ id: frameworkId, requirementId }),
    );
  const removeMapping = (frameworkId: string, requirementId: string, mappingId: string) =>
    deleteMapping(
      req(`/api/frameworks/${frameworkId}/requirements/${requirementId}/mappings/${mappingId}`, "DELETE", cmId),
      params({ id: frameworkId, requirementId, mappingId }),
    );
  const patchCtl = (controlId: string, body: unknown) =>
    patchControl(req(`/api/controls/${controlId}`, "PATCH", cmId, body), params({ id: controlId }));
  const publish = (frameworkId: string) =>
    publishFramework(req(`/api/frameworks/${frameworkId}/publish`, "POST", cmId), params({ id: frameworkId }));

  describe("Framework published (F-FW.5)", () => {
    it("makes its mapped Controls applicable (Not Started) on the Systems that have it in scope, and only those", async () => {
      const draft = await makeFramework("DRAFT");
      const requirement = await makeRequirement(draft.id);
      const [c1, c2] = [await makeControl(), await makeControl()];
      await mapDirect(requirement.id, c1.id);
      await mapDirect(requirement.id, c2.id);
      // In scope + Approved (status must stay), in scope but facet B (Controls are scoped to A), and not in scope.
      const inScope = await makeSystem({ scope: [draft.id], status: "APPROVED" });
      await prisma.approval.create({ data: { systemId: inScope.id, approverId: ownerId, decision: "APPROVED" } });
      const wrongFacet = await makeSystem({ facets: [facetB], scope: [draft.id] });
      const notInScope = await makeSystem({});
      const before = await fingerprint(inScope.id);
      const others = [await fingerprint(wrongFacet.id), await fingerprint(notInScope.id)];

      const response = await publish(draft.id);
      expect(response.status).toBe(200);

      const inScopeRows = await rows(inScope.id, [c1.id, c2.id]);
      expect([...inScopeRows.values()].map((a) => a.status)).toEqual(["NOT_STARTED", "NOT_STARTED"]);
      expect(inScopeRows.size).toBe(2);
      // F-AP.4: status, onboardedAt and Approvals are untouched; the only change is the two rows and one event.
      const after = await fingerprint(inScope.id);
      expect({ ...after, assessments: undefined, events: undefined }).toEqual({
        ...before,
        assessments: undefined,
        events: undefined,
      });
      expect(after.assessments).toHaveLength(2);

      const events = await recomputeEvents(inScope.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorId: "system", action: "APPLICABILITY_RECOMPUTED" });
      expect(events[0].detail).toContain(`Framework "${draft.name}:1" published`);
      expect(events[0].detail).toContain("+2/-0");

      // No change, no event, on the Systems the Framework doesn't reach.
      expect(await fingerprint(wrongFacet.id)).toEqual(others[0]);
      expect(await fingerprint(notInScope.id)).toEqual(others[1]);
    });

    it("re-running the hook changes nothing (idempotent), and heals a row that went missing", async () => {
      const draft = await makeFramework("DRAFT");
      const requirement = await makeRequirement(draft.id);
      const control = await makeControl();
      await mapDirect(requirement.id, control.id);
      const system = await makeSystem({ scope: [draft.id] });
      expect((await publish(draft.id)).status).toBe(200);
      expect((await rows(system.id, [control.id])).size).toBe(1);

      const settled = await fingerprint(system.id);
      expect((await publish(draft.id)).status).toBe(409);
      await onFrameworkPublished(draft.id);
      expect(await fingerprint(system.id)).toEqual(settled);

      await prisma.controlAssessment.deleteMany({ where: { systemId: system.id, controlId: control.id } });
      await onFrameworkPublished(draft.id);
      expect((await rows(system.id, [control.id])).size).toBe(1);
    });
  });

  describe("Draft Frameworks trigger nothing", () => {
    it("mapping added, mapping removed, Requirement deleted and Control scoping edited on a Draft change no System", async () => {
      const draft = await makeFramework("DRAFT");
      const requirement = await makeRequirement(draft.id);
      const other = await makeRequirement(draft.id);
      const control = await makeControl();
      const mappedOnly = await makeControl();
      const system = await makeSystem({ scope: [draft.id] });
      const untouched = await fingerprint(system.id);

      const created = await addMapping(draft.id, requirement.id, control.id);
      expect(created.status).toBe(201);
      const { mapping } = await created.json();
      expect(await fingerprint(system.id)).toEqual(untouched);

      // The Control is mapped only to a Draft Framework: scoping edits reach no System either.
      expect((await patchCtl(control.id, { deploymentFacetIds: [facetA, facetB] })).status).toBe(200);
      expect(await fingerprint(system.id)).toEqual(untouched);

      expect((await removeMapping(draft.id, requirement.id, mapping.id)).status).toBe(204);
      await mapDirect(other.id, mappedOnly.id);
      expect(
        (await deleteRequirement(req(`/api/frameworks/${draft.id}/requirements/${other.id}`, "DELETE", cmId), params({ id: draft.id, requirementId: other.id }))).status,
      ).toBe(204);
      expect(await fingerprint(system.id)).toEqual(untouched);
    });
  });

  describe("Control Mapping added on a Published Framework (F-CL.7)", () => {
    it("creates Not Started Assessments on the Systems with the Framework in scope; a Partial mapping counts too", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl();
      const partial = await makeControl();
      const inScope = await makeSystem({ scope: [published.id], status: "ONBOARDED" });
      const notInScope = await makeSystem({});
      const wrongFacet = await makeSystem({ facets: [facetB], scope: [published.id] });
      const [nis, wf] = [await fingerprint(notInScope.id), await fingerprint(wrongFacet.id)];

      expect((await addMapping(published.id, requirement.id, control.id)).status).toBe(201);
      expect((await addMapping(published.id, requirement.id, partial.id, "PARTIAL")).status).toBe(201);

      const found = await rows(inScope.id, [control.id, partial.id]);
      expect([...found.values()].map((a) => a.status)).toEqual(["NOT_STARTED", "NOT_STARTED"]);
      expect(found.size).toBe(2);
      const events = await recomputeEvents(inScope.id);
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.actorId === "system" && e.detail.includes("Control Mapping added"))).toBe(true);
      expect(events[0].detail).toContain(control.code);
      expect(events[0].detail).toContain("+1/-0");
      // An Onboarded System stays Onboarded.
      const system = await prisma.system.findUniqueOrThrow({ where: { id: inScope.id } });
      expect(system.status).toBe("ONBOARDED");
      expect(system.onboardedAt).not.toBeNull();

      expect(await fingerprint(notInScope.id)).toEqual(nis);
      expect(await fingerprint(wrongFacet.id)).toEqual(wf);
    });

    it("a newly applicable mandatory Control shows up in the owner's My tasks", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl();
      const system = await makeSystem({ scope: [published.id], status: "APPROVED" });
      // (On a seeded DB the seeded mandatory Controls are unassessed too, so compare with the count just before.)
      const taskFor = async () => (await getSystemsNeedingAttention(ownerId)).find((t) => t.id === system.id);
      const before = await taskFor();
      const countBefore = before && before.reason === "needs-assessment" ? before.count : 0;

      expect((await addMapping(published.id, requirement.id, control.id)).status).toBe(201);

      expect(await taskFor()).toEqual({
        id: system.id,
        name: system.name,
        reason: "needs-assessment",
        count: countBefore + 1,
      });
    });

    it("a Coverage change (Full to Partial) is not a trigger", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl();
      const system = await makeSystem({ scope: [published.id] });
      const created = await addMapping(published.id, requirement.id, control.id);
      const { mapping } = await created.json();
      const settled = await fingerprint(system.id);

      const response = await patchMapping(
        req(`/api/frameworks/${published.id}/requirements/${requirement.id}/mappings/${mapping.id}`, "PATCH", cmId, { coverage: "PARTIAL" }),
        params({ id: published.id, requirementId: requirement.id, mappingId: mapping.id }),
      );
      expect(response.status).toBe(200);
      expect(await fingerprint(system.id)).toEqual(settled);
    });

    it("on the base Framework it reaches every System (a facet-scoped Control keeps the fan-out harmless to other files)", async () => {
      const base = await getBaseFramework();
      const requirementId = await mapControlsToBase([]); // a fixture Requirement of the base with no mappings yet
      const control = await makeControl([facetA]);
      const a1 = await makeSystem({}); // no scope declared: the base is always in scope
      const a2 = await makeSystem({ scope: [], status: "APPROVED" });
      const b = await makeSystem({ facets: [facetB] });
      const bFingerprint = await fingerprint(b.id);

      const created = await addMapping(base.id, requirementId, control.id);
      expect(created.status).toBe(201);
      const { mapping } = await created.json();
      for (const system of [a1, a2]) expect((await rows(system.id, [control.id])).get(control.id)?.status).toBe("NOT_STARTED");
      expect(await fingerprint(b.id)).toEqual(bFingerprint);

      expect((await removeMapping(base.id, requirementId, mapping.id)).status).toBe(204);
      for (const system of [a1, a2]) expect((await rows(system.id, [control.id])).size).toBe(0);
      expect(await recomputeEvents(a1.id)).toHaveLength(2);
    });
  });

  describe("Control Mapping removed / Requirement deleted on a Published Framework", () => {
    it("removes untouched Assessments and keeps touched ones as stale", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const [untouchedControl, touchedControl] = [await makeControl(), await makeControl()];
      const system = await makeSystem({ scope: [published.id], status: "APPROVED" });
      const m1 = await mapDirect(requirement.id, untouchedControl.id);
      const m2 = await mapDirect(requirement.id, touchedControl.id);
      await onFrameworkPublished(published.id); // brings both rows in
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId: system.id, controlId: touchedControl.id } },
        data: { status: "IN_PROGRESS", assessedById: ownerId, notes: "worked on" },
      });
      const eventsBefore = (await recomputeEvents(system.id)).length;
      const fixed = await fingerprint(system.id);

      expect((await removeMapping(published.id, requirement.id, m1.id)).status).toBe(204);
      expect((await removeMapping(published.id, requirement.id, m2.id)).status).toBe(204);

      const found = await rows(system.id, [untouchedControl.id, touchedControl.id]);
      expect(found.has(untouchedControl.id)).toBe(false);
      expect(found.get(touchedControl.id)).toMatchObject({ status: "IN_PROGRESS", notes: "worked on" });
      const stale = await getStaleAssessments(await loadForStale(system.id));
      expect(stale.map((a) => a.controlId)).toContain(touchedControl.id);

      const events = (await recomputeEvents(system.id)).slice(eventsBefore);
      expect(events).toHaveLength(2);
      expect(events[0].detail).toContain("Control Mapping removed");
      expect(events[0].detail).toContain("+0/-1");
      expect(events[1].detail).toContain("+0/-0");
      expect(events[1].detail).toContain("1 kept as stale");
      const after = await fingerprint(system.id);
      expect(after.status).toBe(fixed.status);
      expect(after.approvals).toBe(fixed.approvals);
    });

    it("a Control still mapped through another Requirement stays applicable: nothing changes", async () => {
      const published = await makeFramework("PUBLISHED");
      const [r1, r2] = [await makeRequirement(published.id), await makeRequirement(published.id)];
      const control = await makeControl();
      const system = await makeSystem({ scope: [published.id] });
      const m1 = await mapDirect(r1.id, control.id);
      await mapDirect(r2.id, control.id);
      await onFrameworkPublished(published.id);
      const settled = await fingerprint(system.id);

      expect((await removeMapping(published.id, r1.id, m1.id)).status).toBe(204);
      expect(await fingerprint(system.id)).toEqual(settled);
    });

    it("deleting a Requirement removes its mappings' Controls the same way", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl();
      const system = await makeSystem({ scope: [published.id] });
      const other = await makeSystem({});
      await mapDirect(requirement.id, control.id);
      await onFrameworkPublished(published.id);
      expect((await rows(system.id, [control.id])).size).toBe(1);
      const otherFingerprint = await fingerprint(other.id);

      const response = await deleteRequirement(
        req(`/api/frameworks/${published.id}/requirements/${requirement.id}`, "DELETE", cmId),
        params({ id: published.id, requirementId: requirement.id }),
      );
      expect(response.status).toBe(204);

      expect((await rows(system.id, [control.id])).size).toBe(0);
      const events = await recomputeEvents(system.id);
      expect(events[events.length - 1].detail).toContain("Requirement deleted");
      expect(events[events.length - 1].detail).toContain("+0/-1");
      expect(await fingerprint(other.id)).toEqual(otherFingerprint);
    });
  });

  describe("Supplementary Control created from a gap", () => {
    it("on a Published Framework, the new Control gets Not Started Assessments on the Systems with it in scope", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const system = await makeSystem({ scope: [published.id], status: "APPROVED" });
      const notInScope = await makeSystem({});
      const notInScopeFingerprint = await fingerprint(notInScope.id);

      const response = await createSupplementaryControl(
        req(`/api/frameworks/${published.id}/requirements/${requirement.id}/supplementary-control`, "POST", cmId, {
          code: `TEST-RC-SUP-${next()}`,
          title: "Supplementary",
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          question: "Is it covered?",
        }),
        params({ id: published.id, requirementId: requirement.id }),
      );
      expect(response.status).toBe(201);
      const { control } = await response.json();

      const found = await rows(system.id, [control.id]);
      expect(found.get(control.id)?.status).toBe("NOT_STARTED");
      const events = await recomputeEvents(system.id);
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain("Control Mapping added");
      expect(await fingerprint(notInScope.id)).toEqual(notInScopeFingerprint);
    });

    it("on a Draft Framework it changes no System", async () => {
      const draft = await makeFramework("DRAFT");
      const requirement = await makeRequirement(draft.id);
      const system = await makeSystem({ scope: [draft.id] });
      const settled = await fingerprint(system.id);
      const response = await createSupplementaryControl(
        req(`/api/frameworks/${draft.id}/requirements/${requirement.id}/supplementary-control`, "POST", cmId, {
          code: `TEST-RC-SUP-${next()}`,
          title: "Supplementary",
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          question: "Is it covered?",
        }),
        params({ id: draft.id, requirementId: requirement.id }),
      );
      expect(response.status).toBe(201);
      expect(await fingerprint(system.id)).toEqual(settled);
    });
  });

  describe("Control scoping edited", () => {
    it("a Deployment Facet edit adds and removes the Control on exactly the affected Systems", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl([facetA]);
      await mapDirect(requirement.id, control.id);
      const onA = await makeSystem({ facets: [facetA], scope: [published.id], status: "ONBOARDED" });
      const onB = await makeSystem({ facets: [facetB], scope: [published.id] });
      const onBNoScope = await makeSystem({ facets: [facetB] }); // Framework not in scope: never affected
      await onFrameworkPublished(published.id);
      expect((await rows(onA.id, [control.id])).size).toBe(1);
      expect((await rows(onB.id, [control.id])).size).toBe(0);
      const [fpA, fpNoScope] = [await fingerprint(onA.id), await fingerprint(onBNoScope.id)];
      const aEventsBefore = (await recomputeEvents(onA.id)).length; // the publish that brought its row in

      // Widen to A and B: only the B System in scope gains it; A is unchanged (no event).
      expect((await patchCtl(control.id, { deploymentFacetIds: [facetA, facetB] })).status).toBe(200);
      expect((await rows(onB.id, [control.id])).get(control.id)?.status).toBe("NOT_STARTED");
      expect(await fingerprint(onA.id)).toEqual(fpA);
      expect(await fingerprint(onBNoScope.id)).toEqual(fpNoScope);
      const bEvents = await recomputeEvents(onB.id);
      expect(bEvents).toHaveLength(1);
      expect(bEvents[0].detail).toContain(`Control ${control.code} scoping edited`);
      expect(bEvents[0].detail).toContain("+1/-0");

      // Narrow to B only: A's untouched row goes, B keeps its.
      expect((await patchCtl(control.id, { deploymentFacetIds: [facetB] })).status).toBe(200);
      expect((await rows(onA.id, [control.id])).size).toBe(0);
      expect((await rows(onB.id, [control.id])).size).toBe(1);
      const aEvents = await recomputeEvents(onA.id);
      expect(aEvents).toHaveLength(aEventsBefore + 1);
      expect(aEvents[aEventsBefore].detail).toContain("+0/-1");
      expect(await recomputeEvents(onB.id)).toHaveLength(1);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: onA.id } })).status).toBe("ONBOARDED");
    });

    it("keeps a touched Assessment as stale when the edit no longer covers the System", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl([facetA]);
      await mapDirect(requirement.id, control.id);
      const system = await makeSystem({ facets: [facetA], scope: [published.id] });
      await onFrameworkPublished(published.id);
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId: system.id, controlId: control.id } },
        data: { status: "FULFILLED", assessedById: ownerId },
      });

      expect((await patchCtl(control.id, { deploymentFacetIds: [facetB] })).status).toBe(200);

      expect((await rows(system.id, [control.id])).get(control.id)?.status).toBe("FULFILLED");
      expect((await getStaleAssessments(await loadForStale(system.id))).map((a) => a.controlId)).toContain(control.id);
      const events = await recomputeEvents(system.id);
      expect(events[events.length - 1].detail).toContain("1 kept as stale");
    });

    it("an Impact Level threshold edit recomputes the Systems on either side of it", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl([facetA]);
      await mapDirect(requirement.id, control.id);
      const low = await makeSystem({ scope: [published.id], level: "LOW" });
      const high = await makeSystem({ scope: [published.id], level: "HIGH" });
      await onFrameworkPublished(published.id);
      expect((await rows(low.id, [control.id])).size).toBe(1);

      expect((await patchCtl(control.id, { minConfidentialityImpactLevel: "MODERATE" })).status).toBe(200);
      expect((await rows(low.id, [control.id])).size).toBe(0);
      expect((await rows(high.id, [control.id])).size).toBe(1);

      expect((await patchCtl(control.id, { minConfidentialityImpactLevel: null })).status).toBe(200);
      expect((await rows(low.id, [control.id])).size).toBe(1);
    });

    it("edits that don't change who the Control applies to recompute nothing", async () => {
      const published = await makeFramework("PUBLISHED");
      const requirement = await makeRequirement(published.id);
      const control = await makeControl([facetA, facetB]);
      await mapDirect(requirement.id, control.id);
      const system = await makeSystem({ scope: [published.id] });
      await onFrameworkPublished(published.id);
      const settled = await fingerprint(system.id);
      // Rows are deliberately removed by hand: a recompute would put this one back, a non-trigger must not.
      await prisma.controlAssessment.deleteMany({ where: { systemId: system.id, controlId: control.id } });
      const removedByHand = await fingerprint(system.id);
      expect(removedByHand.assessments).not.toEqual(settled.assessments);

      for (const body of [
        { title: "Renamed" },
        { mandatory: false },
        { deploymentFacetIds: [facetB, facetA] }, // same set, different order
        { minConfidentialityImpactLevel: null }, // already unset
      ]) {
        expect((await patchCtl(control.id, body)).status).toBe(200);
        expect(await fingerprint(system.id)).toEqual(removedByHand);
      }
    });
  });
});
