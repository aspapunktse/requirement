import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH as editAssessment } from "../[controlId]/route";
import { PATCH as answer } from "../[controlId]/answer/route";
import { POST as onboard } from "../../onboard/route";
import { POST as addOffering } from "../../offerings/route";
import { DELETE as removeOffering, PATCH as changeOffering } from "../../offerings/[offeringId]/route";
import { DELETE as removeDependency } from "../../dependencies/[providerId]/route";
import { POST as declareDependency } from "../../dependencies/route";
import { PATCH as editOrganization } from "@/app/api/organization/controls/[controlId]/route";

/**
 * F-IN.7 with Shared Offerings (#125): a change to a Provider's status, onboarding, an Offering or a
 * dependency logs one "system" event on each dependent whose effective status moved, now including
 * the dependents whose own Assessment is Fulfilled (their half) in both directions, and the
 * dependent's own edit says in its own event what the Control effectively is. Nothing is ever
 * written to a dependent's Assessment rows. Self-contained fixtures (CI's DB is migrated, not seeded).
 */

const f = setupProviderFixtures("ShrEvents");
const TEXT = "The tenant manages its own keys";

const idCtx = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) });
const sysCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const edit = (systemId: string, controlId: string, status: ControlAssessmentStatus, userId = f.users.owner) =>
  editAssessment(requestAs(`/api/systems/${systemId}/assessments/${controlId}`, userId, "PATCH", { status }), idCtx(systemId, controlId));
const answerYes = (systemId: string, controlId: string, userId = f.users.owner) =>
  answer(requestAs(`/api/systems/${systemId}/assessments/${controlId}/answer`, userId, "PATCH", { answer: "YES" }), idCtx(systemId, controlId));
const onboardIt = (systemId: string, userId = f.users.owner) =>
  onboard(requestAs(`/api/systems/${systemId}/onboard`, userId, "POST"), sysCtx(systemId));
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

const movedEvents = (systemId: string) =>
  prisma.changeEvent.findMany({ where: { systemId, actorId: "system", action: "ASSESSMENT_STATUS_CHANGED" }, orderBy: { createdAt: "asc" } });
const details = async (systemId: string) => (await movedEvents(systemId)).map((e) => e.detail);
const allEvents = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });
const rows = (systemIds: string[]) =>
  prisma.controlAssessment.findMany({ where: { systemId: { in: systemIds } }, orderBy: [{ systemId: "asc" }, { controlId: "asc" }] });

/** How many system events each System has now, so a step can be judged by the events it added. */
async function snapshot(ids: string[]) {
  return new Map(await Promise.all(ids.map(async (id) => [id, (await details(id)).length] as const)));
}
const addedSince = async (id: string, marks: Map<string, number>) => (await details(id)).slice(marks.get(id) ?? 0);

const fulfilledVia = (code: string, name: string) => `${code} is now Fulfilled, inherited from Provider "${name}" (Shared)`;
const waiting = (code: string, name: string) => `${code} is now In Progress: waiting for Provider "${name}" to provide its half`;

/**
 * A Shared Provider and the dependents around it: who has done their half (and should hear about a change in
 * the Provider's), and who should not.
 */
async function scenario(options: { providerStatus?: "ONBOARDED" | "DRAFT"; type?: "SHARED" | "FULL" } = {}) {
  const name = `Test ShrEvents Provider ${f.suffix}-${Math.random().toString(36).slice(2, 7)}`;
  const providerId = await f.makeSystem({ isProvider: true, name, status: options.providerStatus });
  const control = f.controls.perSystem;
  const offering = await f.offer(providerId, control.id, options.type ?? "SHARED", options.type === "FULL" ? null : TEXT);
  await f.assess(providerId, control.id, "NOT_STARTED");

  const ownDone = await f.makeSystem();
  await f.assess(ownDone, control.id, "FULFILLED");
  const capabilityDone = await f.makeSystem();
  await f.assess(capabilityDone, control.id, "FULFILLED", null); // a Capability's auto-fulfilment: the customer's half (D3)
  const ownOpen = await f.makeSystem(); // untouched: the owner's half is open, so the Provider's changes can't move it
  const ownInProgress = await f.makeSystem();
  await f.assess(ownInProgress, control.id, "IN_PROGRESS");
  const waived = await f.makeSystem();
  await f.assess(waived, control.id, "WAIVED");
  const coveredByFull = await f.makeSystem(); // own Fulfilled, and another Provider's Full Offering gives credit anyway
  await f.assess(coveredByFull, control.id, "FULFILLED");
  const fullProvider = await f.makeSystem({ isProvider: true });
  await f.offer(fullProvider, control.id, "FULL");
  await f.assess(fullProvider, control.id, "FULFILLED");
  const doesNotTake = await f.makeSystem({ facets: [f.facets.stale] }); // the Control is scoped to the live Facet
  await f.assess(doesNotTake, f.controls.stale.id, "FULFILLED");
  const stranger = await f.makeSystem(); // depends on nobody
  await f.assess(stranger, control.id, "FULFILLED");

  for (const dependent of [ownDone, capabilityDone, ownOpen, ownInProgress, waived, coveredByFull, doesNotTake]) await f.depend(dependent, providerId);
  await f.depend(coveredByFull, fullProvider);

  const listens = [ownDone, capabilityDone];
  const silent = [ownOpen, ownInProgress, waived, coveredByFull, doesNotTake, stranger];
  return { providerId, name, control, offering, ownOpen, listens, silent, all: [...listens, ...silent, fullProvider] };
}

describe("a Provider's own Assessment status changes (F-IN.7, #125)", { timeout: 90_000 }, () => {
  it("logs now-Fulfilled on the dependents that did their half, none on the others, and waiting when it drops back; no row of a dependent changes", async () => {
    const s = await scenario({ providerStatus: "ONBOARDED" });
    const before = await rows(s.all);

    expect((await edit(s.providerId, s.control.id, "FULFILLED")).status).toBe(200);

    for (const id of s.listens) {
      const events = await movedEvents(id);
      expect(events.map((e) => e.detail)).toEqual([fulfilledVia(s.control.code, s.name)]);
      expect(events[0]).toMatchObject({ action: "ASSESSMENT_STATUS_CHANGED", actorId: "system" });
    }
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);

    expect((await edit(s.providerId, s.control.id, "IN_PROGRESS")).status).toBe(200);
    for (const id of s.listens) expect(await details(id)).toEqual([fulfilledVia(s.control.code, s.name), waiting(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);
  });

  it("the Self-Assessment answer route logs them too", async () => {
    const s = await scenario();
    expect((await answerYes(s.providerId, s.control.id)).status).toBe(200);
    for (const id of s.listens) expect(await details(id)).toEqual([fulfilledVia(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
  });

  it("logs nothing for a change between statuses that give nothing, or a repeated save", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "IN_PROGRESS");
    await edit(s.providerId, s.control.id, "WAIVED");
    await edit(s.providerId, s.control.id, "WAIVED");
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });

  it("logs nothing while the Provider is not Onboarded (pending), then on onboarding says the Control is now Fulfilled", async () => {
    const s = await scenario({ providerStatus: "DRAFT" });
    await edit(s.providerId, s.control.id, "FULFILLED");
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);

    await prisma.system.update({ where: { id: s.providerId }, data: { status: "APPROVED" } });
    expect((await onboardIt(s.providerId)).status).toBe(200);

    for (const id of s.listens) expect(await details(id)).toEqual([fulfilledVia(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
  });

  it("a dependent that is itself a Provider: its own edit's event says what the Control effectively is, and its own dependents read its STORED status", async () => {
    // P (Shared, Not Started) <- D (a Provider offering Full, with its own dependent E) : D sets its half Fulfilled.
    const s = await scenario();
    const dName = `Test ShrEvents Middle ${f.suffix}`;
    const middle = await f.makeSystem({ isProvider: true, name: dName });
    await f.offer(middle, s.control.id, "FULL");
    await f.depend(middle, s.providerId);
    const end = await f.makeSystem();
    await f.depend(end, middle);

    expect((await edit(middle, s.control.id, "FULFILLED")).status).toBe(200);

    // D itself: held at In Progress while P's half is missing, and its own event says so.
    const own = (await allEvents(middle)).filter((e) => e.action === "ASSESSMENT_STATUS_CHANGED");
    expect(own.map((e) => [e.actorId, e.detail])).toEqual([
      [f.users.owner, `${s.control.code} status changed from NOT_STARTED to FULFILLED (now In Progress: waiting for Provider "${s.name}" to provide its half)`],
    ]);
    // E reads D's OWN stored status (Fulfilled), never D's effective one: no chain.
    expect(await details(end)).toEqual([`${s.control.code} is now Fulfilled, inherited from Provider "${dName}"`]);
  });
});

describe("an Offering is added, changed or removed (F-IN.7, #125)", { timeout: 90_000 }, () => {
  it("Full to Shared and back: an untouched dependent loses and regains the credit, those that did their half stay Fulfilled, and an unchanged text moves nothing", async () => {
    const s = await scenario({ type: "FULL" });
    await edit(s.providerId, s.control.id, "FULFILLED"); // the untouched dependent is Fulfilled through the Full Offering
    expect(await details(s.ownOpen)).toEqual([`${s.control.code} is now Fulfilled, inherited from Provider "${s.name}"`]);
    const before = await rows(s.all);
    const marks = await snapshot(s.all);
    const others = s.all.filter((id) => id !== s.ownOpen);

    expect((await patchOffering(s.providerId, s.offering.id, { type: "SHARED", customerResponsibility: TEXT })).status).toBe(200);
    // Fulfilled through the Full Offering before, Not Started now: its own half is open.
    expect(await addedSince(s.ownOpen, marks)).toEqual([`${s.control.code} is no longer inherited from Provider "${s.name}" (now Not Started)`]);
    // Those that did their half stay Fulfilled (now through the Shared Offering): the status didn't move.
    for (const id of others) expect(await addedSince(id, marks)).toEqual([]);

    expect((await patchOffering(s.providerId, s.offering.id, { customerResponsibility: "Other keys" })).status).toBe(200);
    expect(await addedSince(s.ownOpen, marks)).toHaveLength(1);

    expect((await patchOffering(s.providerId, s.offering.id, { type: "FULL" })).status).toBe(200);
    expect((await addedSince(s.ownOpen, marks)).pop()).toBe(`${s.control.code} is now Fulfilled, inherited from Provider "${s.name}"`);
    for (const id of others) expect(await addedSince(id, marks)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);
  });

  it("Full to Shared while the Provider is not Fulfilled holds back those that did their half, and Shared to Full releases them", async () => {
    const s = await scenario({ type: "FULL" }); // the Provider's own status is Not Started
    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);

    expect((await patchOffering(s.providerId, s.offering.id, { type: "SHARED", customerResponsibility: TEXT })).status).toBe(200);
    for (const id of s.listens) expect(await details(id)).toEqual([waiting(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);

    expect((await patchOffering(s.providerId, s.offering.id, { type: "FULL" })).status).toBe(200);
    for (const id of s.listens) expect(await details(id)).toEqual([waiting(s.control.code, s.name), `${s.control.code} is now Fulfilled`]);
  });

  it("adding a Shared Offering while the Provider's half is missing holds those that did their half back, and removing it lets them go", async () => {
    const s = await scenario();
    await prisma.controlOffering.delete({ where: { id: s.offering.id } });
    const before = await rows(s.all);

    const added = await offerVia(s.providerId, { controlId: s.control.id, type: "SHARED", customerResponsibility: TEXT });
    expect(added.status).toBe(201);
    const offeringId = (await added.json()).offering.id as string;
    for (const id of s.listens) expect(await details(id)).toEqual([waiting(s.control.code, s.name)]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);

    expect((await deleteOffering(s.providerId, offeringId)).status).toBe(200);
    for (const id of s.listens) expect(await details(id)).toEqual([waiting(s.control.code, s.name), `${s.control.code} is now Fulfilled`]);
    for (const id of s.silent) expect(await movedEvents(id)).toEqual([]);
    expect(await rows(s.all)).toEqual(before);
  });

  it("adding a Shared Offering of a Provider that is already Fulfilled moves nobody: those that did their half just read Fulfilled through it", async () => {
    const s = await scenario();
    await edit(s.providerId, s.control.id, "FULFILLED");
    await prisma.controlOffering.delete({ where: { id: s.offering.id } });
    for (const id of s.all) await prisma.changeEvent.deleteMany({ where: { systemId: id, actorId: "system" } });

    expect((await offerVia(s.providerId, { controlId: s.control.id, type: "SHARED", customerResponsibility: TEXT })).status).toBe(201);

    for (const id of s.all) expect(await movedEvents(id)).toEqual([]);
  });
});

describe("a dependency is declared or removed (F-IN.7, #125)", { timeout: 90_000 }, () => {
  it("declaring one that lowers the System records it: a CLASSIFICATION_CHANGED event and a system event, with no row changed; making the Provider's half Fulfilled brings it back", async () => {
    const s = await scenario();
    const newcomer = await f.makeSystem();
    await f.assess(newcomer, s.control.id, "FULFILLED");
    const bystander = await f.makeSystem();
    const before = await rows([newcomer]);

    expect((await declare(newcomer, s.providerId)).status).toBe(201);

    expect((await allEvents(newcomer)).map((e) => [e.action, e.actorId, e.detail])).toEqual([
      ["CLASSIFICATION_CHANGED", f.users.owner, `Provider dependency on "${s.name}" added`],
      ["ASSESSMENT_STATUS_CHANGED", "system", waiting(s.control.code, s.name)],
    ]);
    expect(await allEvents(bystander)).toEqual([]);
    expect(await rows([newcomer])).toEqual(before);

    expect((await edit(s.providerId, s.control.id, "FULFILLED")).status).toBe(200);
    expect(await details(newcomer)).toEqual([waiting(s.control.code, s.name), fulfilledVia(s.control.code, s.name)]);
    expect(await rows([newcomer])).toEqual(before);
  });

  it("removing a dependency that was holding the Control back lets it go; removing a satisfied one moves nothing", async () => {
    const s = await scenario();
    const held = await f.makeSystem();
    await f.assess(held, s.control.id, "FULFILLED");
    expect((await declare(held, s.providerId)).status).toBe(201);
    expect(await details(held)).toEqual([waiting(s.control.code, s.name)]);

    expect((await undeclare(held, s.providerId)).status).toBe(200);
    expect(await details(held)).toEqual([waiting(s.control.code, s.name), `${s.control.code} is now Fulfilled`]);

    // A satisfied one: declaring it logs nothing (Fulfilled stays Fulfilled), nor does removing it.
    await edit(s.providerId, s.control.id, "FULFILLED");
    const satisfied = await f.makeSystem();
    await f.assess(satisfied, s.control.id, "FULFILLED");
    expect((await declare(satisfied, s.providerId)).status).toBe(201);
    expect((await undeclare(satisfied, s.providerId)).status).toBe(200);
    expect(await movedEvents(satisfied)).toEqual([]);
    expect((await allEvents(satisfied)).map((e) => e.action)).toEqual(["CLASSIFICATION_CHANGED", "CLASSIFICATION_CHANGED"]);
  });

  it("declaring a Shared Provider that is not Onboarded lowers a System that did its half, and moves one that did not", async () => {
    const s = await scenario({ providerStatus: "DRAFT" });
    const open = await f.makeSystem();
    const done = await f.makeSystem();
    await f.assess(done, s.control.id, "FULFILLED");
    await declare(open, s.providerId);
    // Not Onboarded: the Provider's half is missing, so the System that had Fulfilled the Control itself is held at In Progress.
    await declare(done, s.providerId);
    expect(await movedEvents(open)).toEqual([]);
    expect(await details(done)).toEqual([waiting(s.control.code, s.name)]);
  });
});

describe("the dependent's own edit (F-IN.7, #125)", { timeout: 90_000 }, () => {
  async function dependent(providerStatus: ControlAssessmentStatus) {
    const s = await scenario();
    await edit(s.providerId, s.control.id, providerStatus);
    const systemId = await f.makeSystem();
    await f.depend(systemId, s.providerId);
    return { ...s, systemId };
  }
  const ownEvents = async (systemId: string) => (await allEvents(systemId)).filter((e) => e.action === "ASSESSMENT_STATUS_CHANGED");

  it("setting its half Fulfilled while the Provider's is missing logs the stored change and says it is held at In Progress; no extra event", async () => {
    const s = await dependent("IN_PROGRESS");

    expect((await edit(s.systemId, s.control.id, "FULFILLED")).status).toBe(200);

    expect((await ownEvents(s.systemId)).map((e) => [e.actorId, e.detail])).toEqual([
      [f.users.owner, `${s.control.code} status changed from NOT_STARTED to FULFILLED (now In Progress: waiting for Provider "${s.name}" to provide its half)`],
    ]);
    expect((await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId: s.control.id } } })).status).toBe("FULFILLED");
  });

  it("setting it Fulfilled while the Provider's half is done says it is Fulfilled through the Shared Offering", async () => {
    const s = await dependent("FULFILLED");

    await edit(s.systemId, s.control.id, "FULFILLED");

    expect((await ownEvents(s.systemId)).map((e) => e.detail)).toEqual([
      `${s.control.code} status changed from NOT_STARTED to FULFILLED (now Fulfilled, inherited from Provider "${s.name}" (Shared))`,
    ]);
  });

  it("an edit that the stored status describes completely adds nothing", async () => {
    const s = await dependent("FULFILLED");
    await edit(s.systemId, s.control.id, "IN_PROGRESS");
    await edit(s.systemId, s.control.id, "NOT_STARTED");
    expect((await ownEvents(s.systemId)).map((e) => e.detail)).toEqual([
      `${s.control.code} status changed from NOT_STARTED to IN_PROGRESS`,
      `${s.control.code} status changed from IN_PROGRESS to NOT_STARTED`,
    ]);
  });

  it("a Self-Assessment answer of Yes says the same inside its parentheses", async () => {
    const s = await dependent("IN_PROGRESS");

    expect((await answerYes(s.systemId, s.control.id)).status).toBe(200);

    expect((await ownEvents(s.systemId)).map((e) => e.detail)).toEqual([
      `${s.control.code} status changed from NOT_STARTED to FULFILLED (Self-Assessment answer: YES; now In Progress: waiting for Provider "${s.name}" to provide its half)`,
    ]);
  });

  it("a System with no Provider dependency keeps the event wording it always had", async () => {
    const systemId = await f.makeSystem();
    await edit(systemId, f.controls.perSystem.id, "FULFILLED");
    expect((await ownEvents(systemId)).map((e) => e.detail)).toEqual([`${f.controls.perSystem.code} status changed from NOT_STARTED to FULFILLED`]);
  });
});

describe("the Organization's status next to a Shared Offering (#121, #125)", { timeout: 90_000 }, () => {
  it("an Organization change logs on a System held back by a Shared Provider (the Organization's credit lifts it), and not on a System that did nothing yet", async () => {
    const control = f.controls.both;
    await prisma.organizationControlImplementation.upsert({ where: { controlId: control.id }, create: { controlId: control.id, status: "NOT_STARTED" }, update: { status: "NOT_STARTED" } });
    const name = `Test ShrEvents OrgMix ${f.suffix}`;
    const providerId = await f.makeSystem({ isProvider: true, name });
    await f.offer(providerId, control.id, "SHARED", TEXT);
    await f.assess(providerId, control.id, "IN_PROGRESS");
    const held = await f.makeSystem();
    await f.assess(held, control.id, "FULFILLED");
    await f.depend(held, providerId);
    const untouched = await f.makeSystem();
    await f.depend(untouched, providerId);

    const response = await editOrganization(requestAs(`/api/organization/controls/${control.id}`, f.users.admin, "PATCH", { status: "FULFILLED" }), {
      params: Promise.resolve({ controlId: control.id }),
    });

    expect(response.status).toBe(200);
    expect(await details(held)).toEqual([`${control.code} is now Fulfilled`]); // held at In Progress before, Fulfilled now (own Fulfilled and a Full source gives credit)
    expect(await details(untouched)).toEqual([`${control.code} is now Fulfilled, inherited from the Organization`]);
    await prisma.organizationControlImplementation.update({ where: { controlId: control.id }, data: { status: "NOT_STARTED" } });
  });
});
