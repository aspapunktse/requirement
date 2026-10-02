import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getSystemAssessments } from "@/lib/control-assessments";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH as markProvider } from "../../provider/route";
import { DELETE } from "../[providerId]/route";
import { GET, POST } from "../route";

/**
 * Declaring and listing a System's Provider dependencies (#124, F-IN.3). Self-contained fixtures
 * (CI's DB is migrated, not seeded). Every System is Onboarded unless a test says otherwise, so
 * every role can see it and the 403s are real 403s; a Draft System is invisible to other owners.
 */

const f = setupProviderFixtures("PrvDep");

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const list = (systemId: string, userId: string | null) =>
  GET(requestAs(`/api/systems/${systemId}/dependencies`, userId, "GET"), ctxFor(systemId));
const declare = (systemId: string, userId: string | null, body: unknown) =>
  POST(requestAs(`/api/systems/${systemId}/dependencies`, userId, "POST", body), ctxFor(systemId));
const remove = (systemId: string, userId: string | null, providerId: string) =>
  DELETE(requestAs(`/api/systems/${systemId}/dependencies/${providerId}`, userId, "DELETE"), {
    params: Promise.resolve({ id: systemId, providerId }),
  });

const dependencies = (dependentId: string) => prisma.providerDependency.findMany({ where: { dependentId } });
const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });
const assessments = (systemId: string) => prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } });

describe("POST /api/systems/[id]/dependencies (#124)", { timeout: 30_000 }, () => {
  describe("who may declare", () => {
    it.each([
      ["owner", "owner"],
      ["owner who is a Risk Owner", "riskOwnerOwner"],
      ["owner who is a Viewer", "viewerOwner"],
      ["owner who is a Reviewer", "reviewerOwner"],
    ] as const)("lets the %s declare a dependency for their System", async (_name, userKey) => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem({ ownerId: f.users[userKey] });

      const response = await declare(systemId, f.users[userKey], { providerId });

      expect(response.status).toBe(201);
      expect((await dependencies(systemId)).map((d) => d.providerId)).toEqual([providerId]);
    });

    it("lets an Admin who is not the owner declare one, and records the Admin as the actor", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();
      expect((await declare(systemId, f.users.admin, { providerId })).status).toBe(201);
      expect((await events(systemId))[0].actorId).toBe(f.users.admin);
    });

    it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager"] as const)(
      "refuses a %s who is not the owner with 403 and changes nothing",
      async (userKey) => {
        const providerId = await f.makeSystem({ isProvider: true });
        const systemId = await f.makeSystem();

        const response = await declare(systemId, f.users[userKey], { providerId });

        expect(response.status).toBe(403);
        expect(await dependencies(systemId)).toEqual([]);
        expect(await events(systemId)).toEqual([]);
      },
    );

    it("refuses a Compliance Manager recorded as the owner", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem({ ownerId: f.users.complianceManagerOwner });
      expect((await declare(systemId, f.users.complianceManagerOwner, { providerId })).status).toBe(403);
      expect(await dependencies(systemId)).toEqual([]);
    });

    it("answers 401 when nobody is signed in, and 404 for a System the user cannot see (before any 403)", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();
      expect((await declare(systemId, null, { providerId })).status).toBe(401);

      const draft = await f.makeSystem({ status: "DRAFT" });
      expect((await declare(draft, f.users.viewer, { providerId })).status).toBe(404);
      expect((await declare(draft, f.users.otherOwner, { providerId })).status).toBe(404);
      expect((await declare("no-such-system", f.users.admin, { providerId })).status).toBe(404);
      expect(await dependencies(draft)).toEqual([]);
      expect(await dependencies(systemId)).toEqual([]);
    });

    it("works at any lifecycle stage of either System", async () => {
      const draftProvider = await f.makeSystem({ isProvider: true, status: "DRAFT" });
      const draftSystem = await f.makeSystem({ status: "DRAFT" });
      const response = await declare(draftSystem, f.users.owner, { providerId: draftProvider });
      expect(response.status).toBe(201);
      expect((await response.json()).dependency).toMatchObject({ providerId: draftProvider, onboarded: false });
    });
  });

  describe("what is refused, with nothing written", () => {
    it.each([
      ["no body", undefined],
      ["an empty object", {}],
      ["a number", { providerId: 5 }],
      ["an empty id", { providerId: "" }],
    ])("answers 400 for %s", async (_label, body) => {
      const systemId = await f.makeSystem();
      expect((await declare(systemId, f.users.owner, body)).status).toBe(400);
      expect(await dependencies(systemId)).toEqual([]);
      expect(await events(systemId)).toEqual([]);
    });

    it.each([false, true])("refuses a dependency on itself with 409 (the System is a Provider: %s)", async (isProvider) => {
      const systemId = await f.makeSystem({ isProvider });
      const before = await assessments(systemId);

      const response = await declare(systemId, f.users.owner, { providerId: systemId });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/itself/);
      expect(await prisma.providerDependency.count({ where: { OR: [{ dependentId: systemId }, { providerId: systemId }] } })).toBe(0);
      expect(await events(systemId)).toEqual([]);
      expect(await assessments(systemId)).toEqual(before);
    });

    it("answers 404 for an unknown System", async () => {
      const systemId = await f.makeSystem();
      expect((await declare(systemId, f.users.owner, { providerId: "no-such-system" })).status).toBe(404);
      expect(await dependencies(systemId)).toEqual([]);
    });

    it("answers 409 for a System that is not a Provider, when the caller can see it", async () => {
      const notProvider = await f.makeSystem({ isProvider: false });
      const systemId = await f.makeSystem();

      const response = await declare(systemId, f.users.owner, { providerId: notProvider });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Provider/);
      expect(await dependencies(systemId)).toEqual([]);
      expect(await events(systemId)).toEqual([]);
    });

    it("answers 404, exactly like an unknown id, for a non-Provider System the caller cannot see (existence does not leak)", async () => {
      // A Draft System another owner owns: the caller may see neither it nor learn it exists.
      const hidden = await f.makeSystem({ isProvider: false, status: "DRAFT" });
      const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });

      const unknown = await declare(systemId, f.users.otherOwner, { providerId: "no-such-system" });
      const hiddenResponse = await declare(systemId, f.users.otherOwner, { providerId: hidden });

      expect(hiddenResponse.status).toBe(404);
      expect(hiddenResponse.status).toBe(unknown.status);
      expect(await hiddenResponse.json()).toEqual(await unknown.json());
      expect(await dependencies(systemId)).toEqual([]);

      // Whereas a caller who can see it is told it is not a Provider.
      expect((await declare(systemId, f.users.admin, { providerId: hidden })).status).toBe(409);
    });

    it("answers 409 for a dependency that is already declared, without a second row or event", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();
      expect((await declare(systemId, f.users.owner, { providerId })).status).toBe(201);
      const eventsAfterFirst = (await events(systemId)).length;

      const again = await declare(systemId, f.users.owner, { providerId });

      expect(again.status).toBe(409);
      expect(await dependencies(systemId)).toHaveLength(1);
      expect(await events(systemId)).toHaveLength(eventsAfterFirst);
    });
  });

  describe("what a caller who cannot see the Provider is told", () => {
    it("lets the owner of any System pick any Provider, visible to them or not", async () => {
      // A Draft Provider owned by someone else: other System Owners can't open it.
      const hidden = await f.makeSystem({ isProvider: true, status: "DRAFT", ownerId: f.users.owner });
      await f.offer(hidden, f.controls.perSystem.id);
      await f.assess(hidden, f.controls.perSystem.id, "FULFILLED");
      const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });

      const response = await declare(systemId, f.users.otherOwner, { providerId: hidden });

      expect(response.status).toBe(201);
      const { dependency } = await response.json();
      expect(dependency.canSee).toBe(false);
      // The name, whether it is Onboarded, its Offering and its own status for it: and nothing else.
      expect(Object.keys(dependency).sort()).toEqual(["canSee", "name", "offerings", "onboarded", "providerId"]);
      expect(dependency.onboarded).toBe(false);
      expect(dependency.offerings).toHaveLength(1);
      expect(Object.keys(dependency.offerings[0]).sort()).toEqual(["appliesToProvider", "control", "customerResponsibility", "providerStatus", "type"]);
      expect(dependency.offerings[0]).toMatchObject({ type: "FULL", providerStatus: "FULFILLED" });
    });
  });

  describe("what it writes", () => {
    it("writes one CLASSIFICATION_CHANGED event on the dependent by the acting User, and nothing into its Assessments", async () => {
      const providerId = await f.makeSystem({ isProvider: true, name: `Test PrvDep Landing Zone ${f.suffix}` });
      await f.offer(providerId, f.controls.perSystem.id);
      await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
      const systemId = await f.makeSystem();
      const before = await assessments(systemId);

      const response = await declare(systemId, f.users.owner, { providerId });

      expect(response.status).toBe(201);
      const written = (await events(systemId)).filter((event) => event.action === "CLASSIFICATION_CHANGED");
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        actorId: f.users.owner,
        detail: `Provider dependency on "Test PrvDep Landing Zone ${f.suffix}" added`,
      });
      expect(await assessments(systemId)).toEqual(before);
    });

    it("writes no event on the Provider itself", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();
      await declare(systemId, f.users.owner, { providerId });
      expect(await events(providerId)).toEqual([]);
    });

    it("allows mutual dependencies: there are no chains, so they are harmless", async () => {
      const a = await f.makeSystem({ isProvider: true });
      const b = await f.makeSystem({ isProvider: true });
      expect((await declare(a, f.users.owner, { providerId: b })).status).toBe(201);
      expect((await declare(b, f.users.owner, { providerId: a })).status).toBe(201);
      expect((await dependencies(a)).map((d) => d.providerId)).toEqual([b]);
      expect((await dependencies(b)).map((d) => d.providerId)).toEqual([a]);
    });
  });
});

describe("GET /api/systems/[id]/dependencies (#124)", { timeout: 30_000 }, () => {
  it("lists the declared Providers by name with their matching Offerings, for every role that can see the System", async () => {
    const zeta = await f.makeSystem({ isProvider: true, name: `Test PrvDep Zeta ${f.suffix}` });
    const alpha = await f.makeSystem({ isProvider: true, name: `Test PrvDep Alpha ${f.suffix}` });
    await f.offer(alpha, f.controls.perSystem.id);
    await f.offer(alpha, f.controls.both.id, "SHARED", "The tenant manages its own keys");
    await f.assess(alpha, f.controls.perSystem.id, "FULFILLED");
    const systemId = await f.makeSystem();
    await f.depend(systemId, zeta);
    await f.depend(systemId, alpha);

    for (const userKey of ["owner", "admin", "reviewer", "riskOwner", "viewer", "complianceManager"] as const) {
      const response = await list(systemId, f.users[userKey]);
      expect(response.status).toBe(200);
      const { dependencies: rows } = await response.json();
      expect(rows.map((row: { name: string }) => row.name)).toEqual([`Test PrvDep Alpha ${f.suffix}`, `Test PrvDep Zeta ${f.suffix}`]);
      expect(rows[0]).toMatchObject({ providerId: alpha, onboarded: true, canSee: true });
      expect(rows[0].offerings.map((o: { control: { code: string }; type: string; providerStatus: string }) => [o.control.code, o.type, o.providerStatus])).toEqual(
        [
          [f.controls.both.code, "SHARED", "NOT_STARTED"],
          [f.controls.perSystem.code, "FULL", "FULFILLED"],
        ].sort((a, b) => a[0].localeCompare(b[0])),
      );
      expect(rows[1].offerings).toEqual([]);
    }
  });

  it("lists only the Offerings that match one of the System's applicable Controls", async () => {
    // The Provider declares a third Facet and offers the Control scoped to it; the dependent doesn't.
    const providerId = await f.makeSystem({ isProvider: true, facets: [f.facets.live, f.facets.elsewhere] });
    await f.offer(providerId, f.controls.perSystem.id);
    await f.offer(providerId, f.controls.elsewhere.id);
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    const { dependencies: rows } = await (await list(systemId, f.users.owner)).json();

    expect(rows[0].offerings.map((o: { control: { id: string } }) => o.control.id)).toEqual([f.controls.perSystem.id]);
  });

  it("says canSee false for a Provider the caller cannot open, and still lists it with its Offerings", async () => {
    const hidden = await f.makeSystem({ isProvider: true, status: "DRAFT", name: `Test PrvDep Hidden ${f.suffix}` });
    await f.offer(hidden, f.controls.perSystem.id);
    const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });
    await f.depend(systemId, hidden);

    const asOwner = await (await list(systemId, f.users.otherOwner)).json();
    expect(asOwner.dependencies[0]).toMatchObject({ providerId: hidden, name: `Test PrvDep Hidden ${f.suffix}`, canSee: false, onboarded: false });
    expect(asOwner.dependencies[0].offerings).toHaveLength(1);

    const asAdmin = await (await list(systemId, f.users.admin)).json();
    expect(asAdmin.dependencies[0].canSee).toBe(true);
  });

  it("answers 401 and 404 like the other System routes", async () => {
    const systemId = await f.makeSystem({ status: "DRAFT" });
    expect((await list(systemId, null)).status).toBe(401);
    expect((await list(systemId, f.users.otherOwner)).status).toBe(404);
    expect((await list("no-such-system", f.users.admin)).status).toBe(404);
  });

  it("is empty for a System with no dependency", async () => {
    const systemId = await f.makeSystem();
    expect(await (await list(systemId, f.users.owner)).json()).toEqual({ dependencies: [] });
  });
});

describe("DELETE /api/systems/[id]/dependencies/[providerId] (#124)", { timeout: 30_000 }, () => {
  it("removes the dependency, logs one CLASSIFICATION_CHANGED event, returns the id and touches no Assessment", async () => {
    const providerId = await f.makeSystem({ isProvider: true, name: `Test PrvDep Gone ${f.suffix}` });
    const keptProvider = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    await f.depend(systemId, keptProvider);
    await f.assess(systemId, f.controls.perSystem.id, "IN_PROGRESS");
    const before = await assessments(systemId);

    const response = await remove(systemId, f.users.owner, providerId);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: providerId });
    expect((await dependencies(systemId)).map((d) => d.providerId)).toEqual([keptProvider]);
    const written = (await events(systemId)).filter((event) => event.action === "CLASSIFICATION_CHANGED");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ actorId: f.users.owner, detail: `Provider dependency on "Test PrvDep Gone ${f.suffix}" removed` });
    expect(await assessments(systemId)).toEqual(before);
  });

  it("answers 404 for a Provider the System doesn't depend on, writing nothing", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    expect((await remove(systemId, f.users.owner, providerId)).status).toBe(404);
    expect(await events(systemId)).toEqual([]);
  });

  it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "complianceManager"] as const)(
    "refuses a %s who is not the owner with 403 and changes nothing",
    async (userKey) => {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();
      await f.depend(systemId, providerId);

      expect((await remove(systemId, f.users[userKey], providerId)).status).toBe(403);

      expect(await dependencies(systemId)).toHaveLength(1);
      expect(await events(systemId)).toEqual([]);
    },
  );

  it("lets an Admin remove it, and answers 401 and 404 like the other routes", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    expect((await remove(systemId, null, providerId)).status).toBe(401);
    expect((await remove("no-such-system", f.users.admin, providerId)).status).toBe(404);
    expect((await remove(systemId, f.users.admin, providerId)).status).toBe(200);
    expect(await dependencies(systemId)).toEqual([]);
  });

  it("makes what the System inherited stop: the Control goes back to its own status, nothing was ever copied", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.perSystem.id);
    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    const systemId = await f.makeSystem();
    const effectiveOf = async () => {
      const system = await prisma.system.findUniqueOrThrow({
        where: { id: systemId },
        include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
      });
      const rows = await getSystemAssessments(system);
      return rows.find((row) => row.control.id === f.controls.perSystem.id)!.effective.status;
    };
    expect(await effectiveOf()).toBe("NOT_STARTED");

    await declare(systemId, f.users.owner, { providerId });
    expect(await effectiveOf()).toBe("FULFILLED");
    expect((await assessments(systemId)).filter((a) => a.controlId === f.controls.perSystem.id).every((a) => a.status === "NOT_STARTED")).toBe(true);

    await remove(systemId, f.users.owner, providerId);
    expect(await effectiveOf()).toBe("NOT_STARTED");
  });
});

describe("a Provider that Systems depend on (#124)", { timeout: 30_000 }, () => {
  it("can't be unmarked while any System depends on it, and can once every dependency is gone", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    const unmark = () =>
      markProvider(requestAs(`/api/systems/${providerId}/provider`, f.users.owner, "PATCH", { isProvider: false }), ctxFor(providerId));
    const providerEventsBefore = (await events(providerId)).length;

    const refused = await unmark();

    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/depend/);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: providerId } })).isProvider).toBe(true);
    expect(await events(providerId)).toHaveLength(providerEventsBefore);

    await remove(systemId, f.users.owner, providerId);
    expect((await unmark()).status).toBe(200);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: providerId } })).isProvider).toBe(false);
  });

  it("is refused by Offerings first and dependents second: both messages stay distinct", async () => {
    const withOffering = await f.makeSystem({ isProvider: true });
    await f.offer(withOffering, f.controls.perSystem.id);
    const dependent = await f.makeSystem();
    await f.depend(dependent, withOffering);
    const response = await markProvider(
      requestAs(`/api/systems/${withOffering}/provider`, f.users.owner, "PATCH", { isProvider: false }),
      ctxFor(withOffering),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Offerings/);
  });

  it("unmarking racing a declare never leaves a dependency on a System that is not a Provider", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const providerId = await f.makeSystem({ isProvider: true });
      const systemId = await f.makeSystem();

      const [declared, unmarked] = await Promise.all([
        declare(systemId, f.users.owner, { providerId }),
        markProvider(requestAs(`/api/systems/${providerId}/provider`, f.users.owner, "PATCH", { isProvider: false }), ctxFor(providerId)),
      ]);

      // Either the dependency went in first (and the unmark was refused) or the unmark did (and the declare was refused).
      const provider = await prisma.system.findUniqueOrThrow({ where: { id: providerId } });
      const count = (await dependencies(systemId)).length;
      expect([declared.status, unmarked.status]).toSatisfy((statuses: number[]) => statuses.join() === "201,409" || statuses.join() === "409,200");
      expect(provider.isProvider ? 1 : 0).toBe(count);
    }
  });

  it("two declares of the same dependency at once write one row and one event", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();

    const responses = await Promise.all([
      declare(systemId, f.users.owner, { providerId }),
      declare(systemId, f.users.owner, { providerId }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await dependencies(systemId)).toHaveLength(1);
    expect((await events(systemId)).filter((event) => event.action === "CLASSIFICATION_CHANGED")).toHaveLength(1);
  });
});

describe("deleting Systems (#124)", { timeout: 30_000 }, () => {
  it("removes a dependent's dependencies with it and leaves the Provider alone", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    await prisma.system.delete({ where: { id: systemId } });

    expect(await dependencies(systemId)).toEqual([]);
    expect((await prisma.system.findUnique({ where: { id: providerId } }))?.isProvider).toBe(true);
  });

  it("removes the dependencies on a Provider with it and leaves the dependents alone", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    await prisma.system.delete({ where: { id: providerId } });

    expect(await dependencies(systemId)).toEqual([]);
    expect(await prisma.system.findUnique({ where: { id: systemId } })).not.toBeNull();
  });
});
