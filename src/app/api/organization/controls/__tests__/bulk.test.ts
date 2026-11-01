import { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import * as changeEvents from "@/lib/change-events";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";
import { PATCH } from "../route";

/**
 * The bulk "Set status…" (#284, decision 2a): `PATCH /api/organization/controls` applies one status, and
 * optionally one description, to several Controls in one transaction. Order of checks: 401, the body (400),
 * every Control exists and is Organizational or Both (404), the user may edit every one (403), the reason
 * rule on each Control's resulting values (400). A refusal changes nothing. Self-contained fixtures:
 * Organizational Controls mapped to nothing, and one Facet-scoped Both Control with a System that has the
 * Facet, so nothing here touches a seeded Control or System.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: Record<string, UserRole> = {
  admin: "ADMIN",
  complianceManager: "COMPLIANCE_MANAGER",
  systemOwner: "SYSTEM_OWNER",
  viewer: "VIEWER",
  other: "VIEWER",
  internalAuditor: "INTERNAL_AUDITOR",
};

function bulk(userId: string | null, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return PATCH(new NextRequest("http://localhost/api/organization/controls", { method: "PATCH", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

describe("PATCH /api/organization/controls (bulk, #284)", () => {
  const users: Record<string, string> = {};
  const controlIds: string[] = [];
  const codes = new Map<string, string>();
  let facetId: string;
  let systemId: string;
  let counter = 0;

  const makeControl = async (applicability: "ORGANIZATIONAL" | "BOTH" | "PER_SYSTEM", over: Record<string, unknown> = {}) => {
    const control = await prisma.control.create({
      data: {
        code: `TEST-BULK-${SUFFIX}-${++counter}`,
        title: `Test bulk control ${counter}`,
        description: "d",
        category: "Test",
        applicability,
        ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?" }),
        ...over,
      },
    });
    controlIds.push(control.id);
    codes.set(control.id, control.code);
    return control.id;
  };
  const rowOf = (id: string) => prisma.organizationControlImplementation.findUnique({ where: { controlId: id } });
  const setRow = (controlId: string, status: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED", description: string | null) =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId },
      create: { controlId, status, description, updatedById: users.admin },
      update: { status, description, updatedById: users.admin },
    });
  const orgEvents = (id: string) =>
    prisma.changeEvent.findMany({ where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", detail: { contains: codes.get(id)! } }, orderBy: { createdAt: "asc" } });
  const systemEvents = () => prisma.changeEvent.findMany({ where: { systemId } });
  const snapshot = async (ids: string[]) => ({
    rows: await Promise.all(ids.map(rowOf)),
    events: await Promise.all(ids.map(orgEvents)),
    system: await systemEvents(),
  });

  beforeAll(async () => {
    for (const [key, role] of Object.entries(ROLES)) {
      users[key] = (await prisma.user.create({ data: { email: `test-bulk-${key}-${SUFFIX}@example.com`, name: `Test Bulk ${key}`, role } })).id;
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test Bulk Facet ${SUFFIX}` } })).id;
    systemId = (
      await prisma.system.create({
        data: { name: `Test Bulk System ${SUFFIX}`, ownerId: users.systemOwner, status: "ONBOARDED", deploymentFacets: { connect: { id: facetId } } },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.changeEvent.deleteMany({ where: { systemId } });
    await prisma.changeEvent.deleteMany({ where: { systemId: null, detail: { contains: `TEST-BULK-${SUFFIX}` } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("refusals change nothing", () => {
    it("refuses a request with nobody signed in (401)", async () => {
      const id = await makeControl("ORGANIZATIONAL");
      expect((await bulk(null, { controlIds: [id], status: "FULFILLED" })).status).toBe(401);
      expect(await rowOf(id)).toBeNull();
    });

    it.each([
      ["not JSON", "{"],
      ["no Controls", { controlIds: [], status: "FULFILLED" }],
      ["no status", { controlIds: ["x"] }],
      ["an unknown status", { controlIds: ["x"], status: "DONE" }],
      ["a non-string id", { controlIds: [1], status: "FULFILLED" }],
      ["more Controls than the cap", { controlIds: Array.from({ length: 101 }, (_, i) => `c${i}`), status: "FULFILLED" }],
    ])("refuses %s (400)", async (_name, body) => {
      const id = await makeControl("ORGANIZATIONAL");
      const before = await snapshot([id]);
      expect((await bulk(users.admin, body)).status).toBe(400);
      expect(await snapshot([id])).toEqual(before);
    });

    it("refuses an unknown Control and a Per-System Control (404), naming them, and writes nothing for the rest", async () => {
      const ok = await makeControl("ORGANIZATIONAL");
      const perSystem = await makeControl("PER_SYSTEM");
      const before = await snapshot([ok, perSystem]);
      const response = await bulk(users.admin, { controlIds: [ok, perSystem, "no-such-control"], status: "FULFILLED" });
      expect(response.status).toBe(404);
      expect((await response.json()).refusedIds).toEqual([perSystem, "no-such-control"]);
      expect(await snapshot([ok, perSystem])).toEqual(before);
    });

    it.each(["viewer", "other", "systemOwner"])("refuses a %s who owns none of the Controls (403)", async (who) => {
      const a = await makeControl("ORGANIZATIONAL");
      const b = await makeControl("ORGANIZATIONAL");
      const before = await snapshot([a, b]);
      expect((await bulk(users[who], { controlIds: [a, b], status: "FULFILLED" })).status).toBe(403);
      expect(await snapshot([a, b])).toEqual(before);
    });

    it("refuses the whole request when one of the Controls isn't the user's (403), naming it, and changes none", async () => {
      const mine = await makeControl("ORGANIZATIONAL", { ownerId: users.viewer });
      const theirs = await makeControl("ORGANIZATIONAL", { ownerId: users.other });
      const unowned = await makeControl("ORGANIZATIONAL");
      const before = await snapshot([mine, theirs, unowned]);
      const response = await bulk(users.viewer, { controlIds: [mine, theirs, unowned], status: "FULFILLED", description: "Done" });
      expect(response.status).toBe(403);
      expect((await response.json()).refusedIds).toEqual([theirs, unowned]);
      expect(await snapshot([mine, theirs, unowned])).toEqual(before);
    });

    it("refuses an internalAuditor even as the Control Owner (403): strictly read-only", async () => {
      const id = await makeControl("ORGANIZATIONAL", { ownerId: users.internalAuditor });
      expect((await bulk(users.internalAuditor, { controlIds: [id], status: "FULFILLED", description: "Done" })).status).toBe(403);
      expect(await rowOf(id)).toBeNull();
    });

    it("needs a reason for Waived and Not Applicable on every Control's resulting description (400), naming those without one", async () => {
      const described = await makeControl("ORGANIZATIONAL");
      const bare = await makeControl("ORGANIZATIONAL");
      await setRow(described, "IN_PROGRESS", "Already explained");
      const before = await snapshot([described, bare]);
      const response = await bulk(users.admin, { controlIds: [described, bare], status: "WAIVED" });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "A description is required to set the status to Waived or Not Applicable",
        refusedIds: [bare],
      });
      // A blank description is no description either
      expect((await bulk(users.admin, { controlIds: [described, bare], status: "NOT_APPLICABLE", description: "   " })).status).toBe(400);
      expect(await snapshot([described, bare])).toEqual(before);
    });
  });

  describe("a successful bulk edit", () => {
    it("applies one status and description to every Control and returns the saved rows, with the events of one edit each", async () => {
      const a = await makeControl("ORGANIZATIONAL");
      const b = await makeControl("ORGANIZATIONAL");
      await setRow(b, "FULFILLED", "Old text");
      const response = await bulk(users.complianceManager, { controlIds: [a, b], status: "WAIVED", description: "Accepted by the risk committee" });
      expect(response.status).toBe(200);
      const { controls } = await response.json();
      expect(controls.map((c: { id: string }) => c.id)).toEqual([a, b]);
      for (const control of controls) {
        expect(control.implementation).toMatchObject({ status: "WAIVED", description: "Accepted by the risk committee", updatedBy: { id: users.complianceManager } });
      }
      expect(await rowOf(a)).toMatchObject({ status: "WAIVED", description: "Accepted by the risk committee", updatedById: users.complianceManager });
      expect(await rowOf(b)).toMatchObject({ status: "WAIVED", description: "Accepted by the risk committee" });
      for (const [id, from] of [[a, "Not Started"], [b, "Fulfilled"]] as const) {
        const events = await orgEvents(id);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ systemId: null, actorId: users.complianceManager });
        expect(events[0].detail).toBe(`${codes.get(id)} Organization Control Implementation changed from ${from} to Waived`);
      }
    });

    it("keeps each Control's own description when none is given, or when it is null or blank", async () => {
      const a = await makeControl("ORGANIZATIONAL");
      const b = await makeControl("ORGANIZATIONAL");
      await setRow(a, "NOT_STARTED", "Text of A");
      await setRow(b, "NOT_STARTED", "Text of B");
      for (const description of [undefined, null, "", "  "]) {
        const response = await bulk(users.admin, { controlIds: [a, b], status: "IN_PROGRESS", ...(description !== undefined && { description }) });
        expect(response.status).toBe(200);
        expect((await rowOf(a))!.description).toBe("Text of A");
        expect((await rowOf(b))!.description).toBe("Text of B");
        await setRow(a, "NOT_STARTED", "Text of A");
        await setRow(b, "NOT_STARTED", "Text of B");
      }
      // Waived is allowed without a new description when every Control has one
      expect((await bulk(users.admin, { controlIds: [a, b], status: "WAIVED" })).status).toBe(200);
      expect((await rowOf(b))!.description).toBe("Text of B");
    });

    it("writes the System-less event for a Both Control too, next to its per-System events, and none for a Control already at that status", async () => {
      const both = await makeControl("BOTH", { deploymentFacets: { connect: { id: facetId } } });
      await mapControlsToBase([both]);
      const organizational = await makeControl("ORGANIZATIONAL");
      const already = await makeControl("ORGANIZATIONAL");
      await setRow(already, "FULFILLED", "Yes");
      expect(await systemEvents()).toHaveLength(0);

      const response = await bulk(users.admin, { controlIds: [both, organizational, already], status: "FULFILLED", description: "In place" });
      expect(response.status).toBe(200);

      const bothEvents = await orgEvents(both);
      expect(bothEvents).toHaveLength(1);
      expect(bothEvents[0]).toMatchObject({ systemId: null, actorId: users.admin });
      expect(bothEvents[0].detail).toBe(`${codes.get(both)} Organization Control Implementation changed from Not Started to Fulfilled`);
      const perSystem = await systemEvents();
      expect(perSystem).toHaveLength(1);
      expect(perSystem[0]).toMatchObject({ action: "ASSESSMENT_STATUS_CHANGED", actorId: SYSTEM_ACTOR });
      expect(perSystem[0].detail).toContain(codes.get(both));
      expect(await orgEvents(organizational)).toHaveLength(1);
      expect(await orgEvents(already)).toHaveLength(0);
      // The description still changed on the Control that was already Fulfilled
      expect((await rowOf(already))!.description).toBe("In place");
    });

    it("lets a Control Owner set the Controls they own, and treats a repeated id once", async () => {
      const a = await makeControl("ORGANIZATIONAL", { ownerId: users.viewer });
      const b = await makeControl("ORGANIZATIONAL", { ownerId: users.viewer });
      const response = await bulk(users.viewer, { controlIds: [a, b, a], status: "IN_PROGRESS" });
      expect(response.status).toBe(200);
      expect((await response.json()).controls).toHaveLength(2);
      expect(await rowOf(a)).toMatchObject({ status: "IN_PROGRESS", updatedById: users.viewer });
      expect(await orgEvents(a)).toHaveLength(1);
    });

    it("rolls everything back when a write fails part-way (all or nothing)", async () => {
      const ids = [await makeControl("ORGANIZATIONAL"), await makeControl("ORGANIZATIONAL")];
      const [first, second] = [...ids].sort(); // the order the Controls are written in
      const before = await snapshot(ids);
      const original = changeEvents.logChangeEvent;
      // The second Control's event can't be written: the first one's row and event are already in the transaction.
      const spy = vi.spyOn(changeEvents, "logChangeEvent").mockImplementation((...args) => {
        if (args[2].includes(codes.get(second)!)) throw new Error("boom");
        return original(...args);
      });
      try {
        await expect(bulk(users.admin, { controlIds: ids, status: "FULFILLED", description: "Done" })).rejects.toThrow("boom");
        expect(spy).toHaveBeenCalledTimes(2);
      } finally {
        spy.mockRestore();
      }
      expect(await snapshot(ids)).toEqual(before);
      expect(await rowOf(first)).toBeNull();
    });
  });
});
