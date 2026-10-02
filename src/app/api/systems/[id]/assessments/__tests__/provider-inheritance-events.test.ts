import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runProviderAssessmentWrite } from "@/lib/provider-inheritance";
import { patchSystemClassification, requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH as editAssessment } from "../[controlId]/route";
import { PATCH as answer } from "../[controlId]/answer/route";
import { POST as reset } from "../[controlId]/reset/route";
import { POST as onboard } from "../../onboard/route";
import { POST as addOffering } from "../../offerings/route";
import { DELETE as removeOffering, PATCH as changeOffering } from "../../offerings/[offeringId]/route";
import { DELETE as removeDependency } from "../../dependencies/[providerId]/route";
import { POST as declareDependency } from "../../dependencies/route";
import { POST as declareCapability } from "../../capabilities/route";
import { PATCH as editOrganization } from "@/app/api/organization/controls/[controlId]/route";

/**
 * F-IN.7 (#124): a change to a Provider's Assessment status, Onboarded status, an Offering or a
 * dependency logs one "system" ASSESSMENT_STATUS_CHANGED event on each dependent System whose
 * effective status actually moved, and none on the others. Nothing is ever written to a dependent's
 * Assessment rows. Self-contained fixtures (CI's DB is migrated, not seeded): see provider-fixtures.ts.
 */

const f = setupProviderFixtures("PrvEvents");

const idCtx = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) });
const edit = (systemId: string, controlId: string, status: ControlAssessmentStatus, userId = f.users.owner) =>
  editAssessment(requestAs(`/api/systems/${systemId}/assessments/${controlId}`, userId, "PATCH", { status }), idCtx(systemId, controlId));
const answerYes = (systemId: string, controlId: string, userId = f.users.owner) =>
  answer(requestAs(`/api/systems/${systemId}/assessments/${controlId}/answer`, userId, "PATCH", { answer: "YES" }), idCtx(systemId, controlId));
const resetOwn = (systemId: string, controlId: string, userId = f.users.owner) =>
  reset(requestAs(`/api/systems/${systemId}/assessments/${controlId}/reset`, userId, "POST"), idCtx(systemId, controlId));
const onboardIt = (systemId: string, userId = f.users.owner) =>
  onboard(requestAs(`/api/systems/${systemId}/onboard`, userId, "POST"), { params: Promise.resolve({ id: systemId }) });
const sysCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const offerVia = (providerId: string, body: unknown, userId = f.users.owner) =>
  addOffering(requestAs(`/api/systems/${providerId}/offerings`, userId, "POST", body), sysCtx(providerId));
const offeringCtx = (id: string, offeringId: string) => ({ params: Promise.resolve({ id, offeringId }) });
const patchOffering = (providerId: string, offeringId: string, body: unknown, userId = f.users.owner) =>
  changeOffering(requestAs(`/api/systems/${providerId}/offerings/${offeringId}`, userId, "PATCH", body), offeringCtx(providerId, offeringId));
const deleteOffering = (providerId: string, offeringId: string, userId = f.users.owner) =>
  removeOffering(requestAs(`/api/systems/${providerId}/offerings/${offeringId}`, userId, "DELETE"), offeringCtx(providerId, offeringId));
const declare = (systemId: string, providerId: string, userId = f.users.owner) =>
  declareDependency(requestAs(`/api/systems/${systemId}/dependencies`, userId, "POST", { providerId }), sysCtx(systemId));
const undeclare = (systemId: string, providerId: string, userId = f.users.owner) =>
  removeDependency(requestAs(`/api/systems/${systemId}/dependencies/${providerId}`, userId, "DELETE"), {
    params: Promise.resolve({ id: systemId, providerId }),
  });
const setOrganizationVia = (controlId: string, status: ControlAssessmentStatus) =>
  editOrganization(requestAs(`/api/organization/controls/${controlId}`, f.users.admin, "PATCH", { status }), {
    params: Promise.resolve({ controlId }),
  });
const setOrganization = (controlId: string, status: ControlAssessmentStatus) =>
  prisma.organizationControlImplementation.upsert({ where: { controlId }, create: { controlId, status }, update: { status } });

/** The "system"-actor events F-IN.7 writes on a System. */
const movedEvents = (systemId: string) =>
  prisma.changeEvent.findMany({ where: { systemId, actorId: "system", action: "ASSESSMENT_STATUS_CHANGED" }, orderBy: { createdAt: "asc" } });
const allEvents = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });
const rows = (systemIds: string[]) =>
  prisma.controlAssessment.findMany({ where: { systemId: { in: systemIds } }, orderBy: [{ systemId: "asc" }, { controlId: "asc" }] });

/** The Provider and the Systems around it in the standard scenario: who should hear about a change and who should not. */
async function scenario(options: { providerStatus?: "ONBOARDED" | "DRAFT" } = {}) {
  const name = `Test PrvEvents Provider ${f.suffix}-${Math.random().toString(36).slice(2, 7)}`;
  const providerId = await f.makeSystem({ isProvider: true, name, status: options.providerStatus });
  const control = f.controls.perSystem;
  const offering = await f.offer(providerId, control.id);
  await f.assess(providerId, control.id, "NOT_STARTED");

  const untouched = await f.makeSystem();
  await f.assess(untouched, control.id, "NOT_STARTED", null);
  const noRow = await f.makeSystem();
  const personSet = await f.makeSystem();
  await f.assess(personSet, control.id, "IN_PROGRESS");
  const alsoViaOther = await f.makeSystem();
  const other = await f.makeSystem({ isProvider: true });
  await f.offer(other, control.id);
  await f.assess(other, control.id, "FULFILLED");
  const doesNotTake = await f.makeSystem({ facets: [f.facets.stale] }); // the Control is scoped to the live Facet
  const stranger = await f.makeSystem(); // depends on nobody

  for (const dependent of [untouched, noRow, personSet, alsoViaOther, doesNotTake]) await f.depend(dependent, providerId);
  await f.depend(alsoViaOther, other);

  const listens = [untouched, noRow];
  const silent = [personSet, alsoViaOther, doesNotTake, stranger];
  return { providerId, name, control, offering, listens, silent, all: [...listens, ...silent, other] };
}

const inheritedNow = (code: string, name: string) => `${code} is now Fulfilled, inherited from Provider "${name}"`;
const noLonger = (code: string, name: string) => `${code} is no longer inherited from Provider "${name}" (now Not Started)`;

describe("a Provider's own Assessment status changes (#124, F-IN.7)", { timeout: 60_000 }, () => {
  it("the edit route logs one system event on each dependent that moved, and none on the others, then again when it drops back", async () => {
    const s = await scenario();
    const before = await rows(s.all);

    expect((await edit(s.providerId, s.control.id, "FULFILLED")).status).toBe(200);

    for (const id of s.listens) {
      const events = await movedEvents(id);
      expect(events.map((e) => e.detail)).toEqual([inheritedNow(s.control.code, s.name)]);
      expect(events[0]).toMatchObject({ action: "ASSESSMENT_STATUS_CHANGED", actorId: "system" });
    }
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
    // Nothing is ever written into a dependent's rows.
    expect(await rows(s.all)).toEqual(before);

    expect((await edit(s.providerId, s.control.id, "IN_PROGRESS")).status).toBe(200);
    for (const id of s.listens) {
      expect((await movedEvents(id)).map((e) => e.detail)).toEqual([inheritedNow(s.control.code, s.name), noLonger(s.control.code, s.name)]);
    }
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);
  });

  it("still writes the Provider's own event (by the person) and the edit itself", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "FULFILLED");
    const own = (await allEvents(s.providerId)).filter((e) => e.action === "ASSESSMENT_STATUS_CHANGED");
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ actorId: f.users.owner, detail: `${s.control.code} status changed from NOT_STARTED to FULFILLED` });
    expect((await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.providerId, controlId: s.control.id } } })).status).toBe("FULFILLED");
  });

  it("logs nothing for a change between statuses that give no credit, a repeated save, or a Control the Provider doesn't offer", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "IN_PROGRESS");
    await edit(s.providerId, s.control.id, "WAIVED");
    await edit(s.providerId, s.control.id, "WAIVED");
    await edit(s.providerId, f.controls.both.id, "FULFILLED"); // offered by nobody
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });

  it("logs nothing while the Provider is not Onboarded (pending gives no credit)", async () => {
    const s = await scenario({ providerStatus: "DRAFT" });
    await edit(s.providerId, s.control.id, "FULFILLED");
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });

  it("logs nothing for a Shared Offering while no dependent has done its own half (#125 covers the ones that have)", async () => {
    const s = await scenario();
    await prisma.controlOffering.update({ where: { id: s.offering.id }, data: { type: "SHARED", customerResponsibility: "Keys" } });
    await edit(s.providerId, s.control.id, "FULFILLED");
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });

  it("the Self-Assessment answer route logs them too", async () => {
    const s = await scenario();
    expect((await answerYes(s.providerId, s.control.id)).status).toBe(200);
    for (const id of s.listens) expect((await movedEvents(id)).map((e) => e.detail)).toEqual([inheritedNow(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
  });

  it("the reset route logs them too: a Provider resetting its own Both Control to what the Organization gives", async () => {
    await setOrganization(f.controls.both.id, "NOT_STARTED");
    const name = `Test PrvEvents Reset ${f.suffix}`;
    const providerId = await f.makeSystem({ isProvider: true, name });
    await f.offer(providerId, f.controls.both.id);
    await f.assess(providerId, f.controls.both.id, "FULFILLED"); // person-set Fulfilled
    const dependent = await f.makeSystem();
    await f.depend(dependent, providerId);
    expect(await movedEvents(dependent)).toEqual([]);

    expect((await resetOwn(providerId, f.controls.both.id)).status).toBe(200);

    expect((await movedEvents(dependent)).map((e) => e.detail)).toEqual([noLonger(f.controls.both.code, name)]);
  });

  it("a person who edits a System that is not a Provider causes no dependent events, and a Provider with no dependents just saves", async () => {
    const plain = await f.makeSystem();
    await edit(plain, f.controls.perSystem.id, "FULFILLED");
    const lonely = await f.makeSystem({ isProvider: true });
    await f.offer(lonely, f.controls.perSystem.id);
    expect((await edit(lonely, f.controls.perSystem.id, "FULFILLED")).status).toBe(200);
    expect(await movedEvents(plain)).toEqual([]);
    expect(await movedEvents(lonely)).toEqual([]);
  });

  it("a refused edit writes nothing anywhere", async () => {
    const s = await scenario();
    const before = await rows(s.all);
    expect((await edit(s.providerId, s.control.id, "FULFILLED", f.users.viewer)).status).toBe(403);
    expect((await edit(s.providerId, s.control.id, "FULFILLED", f.users.otherOwner)).status).toBe(403);
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);
  });
});

describe("the Provider becomes Onboarded (#124, F-IN.7)", { timeout: 60_000 }, () => {
  it("logs one event per dependent and Control that moved, and none where a person-set status or another source already decided", async () => {
    await setOrganization(f.controls.both.id, "NOT_STARTED");
    const name = `Test PrvEvents Onboarding ${f.suffix}`;
    const providerId = await f.makeSystem({ isProvider: true, name, status: "DRAFT" });
    await prisma.system.update({ where: { id: providerId }, data: { status: "APPROVED" } });
    for (const control of [f.controls.perSystem, f.controls.both]) {
      await f.offer(providerId, control.id);
      await f.assess(providerId, control.id, "FULFILLED");
    }
    const plain = await f.makeSystem();
    const mixed = await f.makeSystem();
    await f.assess(mixed, f.controls.perSystem.id, "WAIVED"); // person-set: never overridden
    const stranger = await f.makeSystem();
    await f.depend(plain, providerId);
    await f.depend(mixed, providerId);
    const before = await rows([plain, mixed, stranger]);

    expect((await onboardIt(providerId)).status).toBe(200);

    expect((await movedEvents(plain)).map((e) => e.detail).sort()).toEqual(
      [inheritedNow(f.controls.both.code, name), inheritedNow(f.controls.perSystem.code, name)].sort(),
    );
    expect((await movedEvents(mixed)).map((e) => e.detail)).toEqual([inheritedNow(f.controls.both.code, name)]);
    expect(await movedEvents(stranger)).toEqual([]);
    expect(await rows([plain, mixed, stranger])).toEqual(before);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: providerId } })).status).toBe("ONBOARDED");
    expect((await allEvents(providerId)).map((e) => e.action)).toContain("SYSTEM_ONBOARDED");
  });

  it("onboarding a Provider nobody depends on, and a System that is not a Provider, just onboards", async () => {
    const lonely = await f.makeSystem({ isProvider: true, status: "DRAFT" });
    await prisma.system.update({ where: { id: lonely }, data: { status: "APPROVED" } });
    await f.offer(lonely, f.controls.perSystem.id);
    const plain = await f.makeSystem({ status: "DRAFT" });
    await prisma.system.update({ where: { id: plain }, data: { status: "APPROVED" } });
    expect((await onboardIt(lonely)).status).toBe(200);
    expect((await onboardIt(plain)).status).toBe(200);
  });

  it("a refused onboarding (not Approved, or not the owner) writes nothing", async () => {
    const s = await scenario({ providerStatus: "DRAFT" });
    await edit(s.providerId, s.control.id, "FULFILLED");
    expect((await onboardIt(s.providerId)).status).toBe(400);
    await prisma.system.update({ where: { id: s.providerId }, data: { status: "APPROVED" } });
    expect((await onboardIt(s.providerId, f.users.reviewer)).status).toBe(403);
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });
});

describe("an Offering is added, changed or removed (#124, F-IN.7)", { timeout: 60_000 }, () => {
  it("logs events as the Offering starts, stops and starts giving credit again, and none while it is Shared", async () => {
    const s = await scenario();
    await prisma.controlOffering.delete({ where: { id: s.offering.id } });
    await edit(s.providerId, s.control.id, "FULFILLED");
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);

    const added = await offerVia(s.providerId, { controlId: s.control.id, type: "FULL" });
    expect(added.status).toBe(201);
    const offeringId = (await added.json()).offering.id as string;
    for (const id of s.listens) expect((await movedEvents(id)).map((e) => e.detail)).toEqual([inheritedNow(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);

    expect((await patchOffering(s.providerId, offeringId, { type: "SHARED", customerResponsibility: "Keys" })).status).toBe(200);
    for (const id of s.listens) expect((await movedEvents(id)).map((e) => e.detail).pop()).toBe(noLonger(s.control.code, s.name));

    expect((await patchOffering(s.providerId, offeringId, { customerResponsibility: "Other keys" })).status).toBe(200); // still Shared: nothing moves
    for (const id of s.listens) expect(await movedEvents(id)).toHaveLength(2);

    expect((await patchOffering(s.providerId, offeringId, { type: "FULL" })).status).toBe(200);
    for (const id of s.listens) expect((await movedEvents(id)).map((e) => e.detail).pop()).toBe(inheritedNow(s.control.code, s.name));

    expect((await deleteOffering(s.providerId, offeringId)).status).toBe(200);
    for (const id of s.listens) {
      const details = (await movedEvents(id)).map((e) => e.detail);
      expect(details).toHaveLength(4);
      expect(details.pop()).toBe(noLonger(s.control.code, s.name));
    }
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
  });

  it("logs nothing for an Offering of a Provider that is not Fulfilled on it, and refused Offering writes write nothing", async () => {
    const s = await scenario();
    await prisma.controlOffering.delete({ where: { id: s.offering.id } });
    expect((await offerVia(s.providerId, { controlId: s.control.id, type: "FULL" })).status).toBe(201); // Provider's own status is Not Started
    expect((await offerVia(s.providerId, { controlId: s.control.id, type: "FULL" })).status).toBe(409);
    expect((await offerVia(s.providerId, { controlId: s.control.id, type: "FULL" }, f.users.viewer)).status).toBe(403);
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });
});

describe("a dependency is declared or removed (#124, F-IN.7)", { timeout: 60_000 }, () => {
  it("logs the events on the dependent itself, next to its CLASSIFICATION_CHANGED event, and on no other System", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "FULFILLED");
    const newcomer = await f.makeSystem();
    const bystander = await f.makeSystem();
    const eventsBefore = (await allEvents(s.listens[0])).length;

    expect((await declare(newcomer, s.providerId)).status).toBe(201);

    const own = await allEvents(newcomer);
    expect(own.map((e) => [e.action, e.actorId])).toEqual([
      ["CLASSIFICATION_CHANGED", f.users.owner],
      ["ASSESSMENT_STATUS_CHANGED", "system"],
    ]);
    expect(own[1].detail).toBe(inheritedNow(s.control.code, s.name));
    expect(await allEvents(bystander)).toEqual([]);
    expect(await allEvents(s.listens[0])).toHaveLength(eventsBefore);

    expect((await undeclare(newcomer, s.providerId)).status).toBe(200);
    expect((await allEvents(newcomer)).map((e) => e.detail)).toEqual([
      `Provider dependency on "${s.name}" added`,
      inheritedNow(s.control.code, s.name),
      `Provider dependency on "${s.name}" removed`,
      noLonger(s.control.code, s.name),
    ]);
  });

  it("logs no system event when the dependency gives nothing (pending Provider, person-set own status, another source already decided)", async () => {
    const pending = await scenario({ providerStatus: "DRAFT" });
    await edit(pending.providerId, pending.control.id, "FULFILLED");
    const a = await f.makeSystem();
    await declare(a, pending.providerId);

    const live = await scenario();
    await edit(live.providerId, live.control.id, "FULFILLED");
    const b = await f.makeSystem();
    await f.assess(b, live.control.id, "WAIVED");
    await declare(b, live.providerId);

    const covered = await f.makeSystem();
    await declare(covered, live.providerId); // moves: Fulfilled through live
    const second = await scenario();
    await edit(second.providerId, second.control.id, "FULFILLED");
    const before = (await movedEvents(covered)).length;
    await declare(covered, second.providerId); // already Fulfilled: no further event

    expect(await movedEvents(a)).toEqual([]);
    expect(await movedEvents(b)).toEqual([]);
    expect(before).toBe(1);
    expect(await movedEvents(covered)).toHaveLength(1);
    // Each declaration still logs its own CLASSIFICATION_CHANGED event.
    expect((await allEvents(covered)).filter((e) => e.action === "CLASSIFICATION_CHANGED")).toHaveLength(2);
  });

  it("an Organization change doesn't log on a System a Provider already made Fulfilled (the Organization fan-out sees Provider sources)", async () => {
    await setOrganization(f.controls.both.id, "NOT_STARTED");
    const name = `Test PrvEvents OrgMix ${f.suffix}`;
    const providerId = await f.makeSystem({ isProvider: true, name });
    await f.offer(providerId, f.controls.both.id);
    await f.assess(providerId, f.controls.both.id, "FULFILLED");
    const viaProvider = await f.makeSystem();
    await f.depend(viaProvider, providerId);
    const organizationOnly = await f.makeSystem();
    expect(await movedEvents(viaProvider)).toEqual([]);

    expect((await setOrganizationVia(f.controls.both.id, "FULFILLED")).status).toBe(200);
    // The System a Provider already made Fulfilled hears nothing; the one that only had the Organization does.
    expect(await movedEvents(viaProvider)).toEqual([]);
    expect((await movedEvents(organizationOnly)).map((e) => e.detail)).toEqual([
      `${f.controls.both.code} is now Fulfilled, inherited from the Organization`,
    ]);

    expect((await setOrganizationVia(f.controls.both.id, "NOT_STARTED")).status).toBe(200);
    expect(await movedEvents(viaProvider)).toEqual([]);
    expect(await movedEvents(organizationOnly)).toHaveLength(2);
    await setOrganization(f.controls.both.id, "NOT_STARTED");
  });
});

describe("the optional triggers (#124, F-IN.7)", { timeout: 60_000 }, () => {
  let capabilityId = "";
  beforeAll(async () => {
    capabilityId = (
      await prisma.capability.create({
        data: { name: `Test PrvEvents Capability ${f.suffix}`, controls: { connect: [{ id: f.controls.perSystem.id }] } },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.controlAssessment.updateMany({ where: { fulfilledByCapabilityId: capabilityId }, data: { fulfilledByCapabilityId: null } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
  });

  it("a Capability the Provider declares auto-fulfils the Control: its dependents are told", async () => {
    const providerId = await f.makeSystem({ isProvider: true, name: `Test PrvEvents Cap Provider ${f.suffix}` });
    await f.offer(providerId, f.controls.perSystem.id);
    await f.assess(providerId, f.controls.perSystem.id, "NOT_STARTED", null); // untouched, so the Capability may fulfil it
    const dependent = await f.makeSystem();
    await f.depend(dependent, providerId);

    const response = await declareCapability(requestAs(`/api/systems/${providerId}/capabilities`, f.users.owner, "POST", { capabilityId }), sysCtx(providerId));

    expect(response.status).toBe(201);
    expect((await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: providerId, controlId: f.controls.perSystem.id } } })).status).toBe("FULFILLED");
    expect((await movedEvents(dependent)).map((e) => e.detail)).toEqual([
      inheritedNow(f.controls.perSystem.code, `Test PrvEvents Cap Provider ${f.suffix}`),
    ]);
  });

  it("a Provider's classification change that makes an offered Control stop applying takes the credit away, and logs it", async () => {
    const name = `Test PrvEvents Reclass ${f.suffix}`;
    const providerId = await f.makeSystem({ isProvider: true, name });
    await f.offer(providerId, f.controls.stale.id);
    await f.assess(providerId, f.controls.stale.id, "FULFILLED");
    const dependent = await f.makeSystem();
    await f.depend(dependent, providerId);
    expect(await movedEvents(dependent)).toEqual([]);

    await patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] });

    expect((await movedEvents(dependent)).map((e) => e.detail)).toEqual([noLonger(f.controls.stale.code, name)]);
    // And it starts again when the Control applies once more.
    await patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live, f.facets.stale] });
    expect((await movedEvents(dependent)).map((e) => e.detail).pop()).toBe(inheritedNow(f.controls.stale.code, name));
  });

  // The pool is CI's size (vitest.config.ts: 3 connections). These changes hold no transaction and no lock while they
  // run on their own connections, so any number of them, mixed with the lock-holding transactions, must finish.
  it("several Capability and classification changes on one Provider at once all complete (no pool starvation, no lock held across them)", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.offer(providerId, f.controls.perSystem.id);
      await f.offer(providerId, f.controls.stale.id);
      await f.assess(providerId, f.controls.perSystem.id, "NOT_STARTED", null);
      await f.assess(providerId, f.controls.stale.id, "FULFILLED");
      const dependents = [await f.makeSystem(), await f.makeSystem()];
      for (const id of dependents) await f.depend(id, providerId);

      const [declared, , , , edited, offered] = await Promise.all([
        declareCapability(requestAs(`/api/systems/${providerId}/capabilities`, f.users.owner, "POST", { capabilityId }), sysCtx(providerId)),
        patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] }),
        patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live, f.facets.stale] }),
        patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] }),
        edit(providerId, f.controls.perSystem.id, "IN_PROGRESS"),
        offerVia(providerId, { controlId: f.controls.both.id, type: "FULL" }),
      ]);

      expect([declared.status, edited.status, offered.status]).toEqual([201, 200, 201]);
      // Whatever order they ran in, the dependents' events only ever say a Control became or stopped being inherited from this Provider.
      for (const id of dependents) {
        for (const event of await movedEvents(id)) expect(event.detail).toMatch(/is now Fulfilled, inherited from Provider|is no longer inherited from Provider/);
      }
      await prisma.controlAssessment.updateMany({ where: { fulfilledByCapabilityId: capabilityId }, data: { fulfilledByCapabilityId: null } });
    }
  });
});

describe("concurrent changes (#124)", { timeout: 90_000 }, () => {
  it("two edits of the same Provider Assessment at once don't double the events", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = await scenario();

      const responses = await Promise.all([
        edit(s.providerId, s.control.id, "FULFILLED"),
        edit(s.providerId, s.control.id, "FULFILLED"),
        edit(s.providerId, s.control.id, "FULFILLED"),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
      for (const id of s.listens) expect(await movedEvents(id)).toHaveLength(1);
      for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
      // The Provider's own event isn't doubled either: the previous status is read under the lock.
      expect((await allEvents(s.providerId)).filter((e) => e.action === "ASSESSMENT_STATUS_CHANGED")).toHaveLength(1);
    }
  });

  it("opposite edits at once leave events that agree with the final state", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "FULFILLED");

    await Promise.all([edit(s.providerId, s.control.id, "IN_PROGRESS"), edit(s.providerId, s.control.id, "FULFILLED")]);

    const final = (await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.providerId, controlId: s.control.id } } })).status;
    for (const id of s.listens) {
      const details = (await movedEvents(id)).map((e) => e.detail);
      // Fulfilled at the end: events alternate and end on "now Fulfilled"; otherwise they end on "no longer inherited".
      expect(details.length % 2).toBe(final === "FULFILLED" ? 1 : 0);
      expect(details.at(-1)).toBe(final === "FULFILLED" ? inheritedNow(s.control.code, s.name) : noLonger(s.control.code, s.name));
    }
  });

  it("a Provider edit and an Organization edit of the same Both Control at once log exactly one event on a System that has both sources", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await setOrganization(f.controls.both.id, "NOT_STARTED");
      const providerId = await f.makeSystem({ isProvider: true });
      await f.offer(providerId, f.controls.both.id);
      await f.assess(providerId, f.controls.both.id, "NOT_STARTED");
      const dependent = await f.makeSystem();
      await f.depend(dependent, providerId);

      const [one, two] = await Promise.all([edit(providerId, f.controls.both.id, "FULFILLED"), setOrganizationVia(f.controls.both.id, "FULFILLED")]);

      expect([one.status, two.status]).toEqual([200, 200]);
      expect(await movedEvents(dependent)).toHaveLength(1);
      await setOrganization(f.controls.both.id, "NOT_STARTED");
    }
  });

  it("an Offering added while the Provider's status is being saved ends with exactly one event", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const s = await scenario();
      await prisma.controlOffering.delete({ where: { id: s.offering.id } });

      const [saved, added] = await Promise.all([
        edit(s.providerId, s.control.id, "FULFILLED"),
        offerVia(s.providerId, { controlId: s.control.id, type: "FULL" }),
      ]);

      expect([saved.status, added.status]).toEqual([200, 201]);
      for (const id of s.listens) expect(await movedEvents(id)).toHaveLength(1);
    }
  });

  it("Systems that depend on each other, edited at once, never deadlock", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const a = await f.makeSystem({ isProvider: true });
      const b = await f.makeSystem({ isProvider: true });
      for (const id of [a, b]) {
        await f.offer(id, f.controls.perSystem.id);
        await f.offer(id, f.controls.both.id);
        await f.assess(id, f.controls.perSystem.id, "NOT_STARTED");
        await f.assess(id, f.controls.both.id, "NOT_STARTED");
      }
      await f.depend(a, b);
      await f.depend(b, a);

      const responses = await Promise.all([
        edit(a, f.controls.perSystem.id, "FULFILLED"),
        edit(b, f.controls.both.id, "FULFILLED"),
        edit(b, f.controls.perSystem.id, "FULFILLED"),
        edit(a, f.controls.both.id, "FULFILLED"),
        offerVia(a, { controlId: f.controls.stale.id, type: "FULL" }),
      ]);

      expect(responses.map((r) => r.status).slice(0, 4)).toEqual([200, 200, 200, 200]);
      // Each is the other's only dependent, and each own Assessment is person-set: nothing moves on either.
      expect(await movedEvents(a)).toEqual([]);
      expect(await movedEvents(b)).toEqual([]);
    }
  });
});

describe("the pre-check on the Assessment routes is cheap (#124)", () => {
  it("a System that is not a Provider is written to directly, with no transaction and no lock", async () => {
    let seen: { db: unknown; locked: boolean } | null = null;
    const result = await runProviderAssessmentWrite({ id: "any", isProvider: false }, "any-control", async (db, locked) => {
      seen = { db, locked };
      return "written";
    });
    expect(result).toBe("written");
    expect(seen).toEqual({ db: prisma, locked: false });
  });

  it("a Provider with no credited Offering of the Control, or no dependents, writes inside its transaction and records nothing extra", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.perSystem.id, "SHARED", "Keys"); // Shared: nobody's status can move
    const dependent = await f.makeSystem();
    await f.depend(dependent, providerId);
    const lonely = await f.makeSystem({ isProvider: true });
    await f.offer(lonely, f.controls.perSystem.id);

    for (const id of [providerId, lonely]) {
      let locked: boolean | null = null;
      await runProviderAssessmentWrite({ id, isProvider: true }, f.controls.perSystem.id, async (db, wasLocked) => {
        locked = wasLocked;
        return db === prisma;
      });
      expect(locked).toBe(true);
    }
    expect(await movedEvents(dependent)).toEqual([]);
  });
});
