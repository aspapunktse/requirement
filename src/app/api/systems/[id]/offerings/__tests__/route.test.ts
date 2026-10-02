import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getComplianceForSystems } from "@/lib/compliance";
import { getSystemAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { PATCH as patchSystem } from "../../route";
import { PATCH as markProvider } from "../../provider/route";
import { GET, POST } from "../route";

/**
 * A Provider's Control Offerings: list and add (#123, F-IN.2). Self-contained fixtures (CI's DB is
 * migrated, not seeded). Every System is Onboarded unless a test says otherwise, so every role can
 * see it and the 403s are real 403s.
 */

const f = setupProviderFixtures("PrvOffer");

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const list = (systemId: string, userId: string | null) =>
  GET(requestAs(`/api/systems/${systemId}/offerings`, userId, "GET"), ctxFor(systemId));
const add = (systemId: string, userId: string | null, body: unknown) =>
  POST(requestAs(`/api/systems/${systemId}/offerings`, userId, "POST", body), ctxFor(systemId));

const offerings = (providerId: string) => prisma.controlOffering.findMany({ where: { providerId }, orderBy: { createdAt: "asc" } });
const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });

describe("POST /api/systems/[id]/offerings (#123)", { timeout: 30_000 }, () => {
  describe("who may add", () => {
    it.each([
      ["owner", "owner"],
      ["owner who is a Risk Owner", "riskOwnerOwner"],
      ["owner who is a Viewer", "viewerOwner"],
      ["owner who is a Reviewer", "reviewerOwner"],
    ] as const)("lets the %s add an Offering to their Provider", async (_name, userKey) => {
      const providerId = await f.makeSystem({ ownerId: f.users[userKey], isProvider: true });

      const response = await add(providerId, f.users[userKey], { controlId: f.controls.perSystem.id, type: "FULL" });

      expect(response.status).toBe(201);
      expect((await offerings(providerId)).length).toBe(1);
    });

    it("lets an Admin who is not the owner add one", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const response = await add(providerId, f.users.admin, { controlId: f.controls.perSystem.id, type: "FULL" });
      expect(response.status).toBe(201);
      expect((await events(providerId))[0].actorId).toBe(f.users.admin);
    });

    it.each(["otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager"] as const)(
      "refuses a %s who is not the owner with 403 and changes nothing",
      async (userKey) => {
        const providerId = await f.makeSystem({ isProvider: true });

        const response = await add(providerId, f.users[userKey], { controlId: f.controls.perSystem.id, type: "FULL" });

        expect(response.status).toBe(403);
        expect(await offerings(providerId)).toEqual([]);
        expect(await events(providerId)).toEqual([]);
      },
    );

    it("refuses a Compliance Manager recorded as the owner", async () => {
      const providerId = await f.makeSystem({ ownerId: f.users.complianceManagerOwner, isProvider: true });
      const response = await add(providerId, f.users.complianceManagerOwner, { controlId: f.controls.perSystem.id, type: "FULL" });
      expect(response.status).toBe(403);
      expect(await offerings(providerId)).toEqual([]);
    });

    it("answers 401 when nobody is signed in, and 404 for a System the user cannot see (before any 403)", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const body = { controlId: f.controls.perSystem.id, type: "FULL" };
      expect((await add(providerId, null, body)).status).toBe(401);

      const draft = await f.makeSystem({ status: "DRAFT", isProvider: true });
      expect((await add(draft, f.users.viewer, body)).status).toBe(404);
      expect((await add(draft, f.users.otherOwner, body)).status).toBe(404);
      expect((await add("no-such-system", f.users.admin, body)).status).toBe(404);
      expect(await offerings(draft)).toEqual([]);
      expect(await offerings(providerId)).toEqual([]);
    });
  });

  describe("what an Offering may be", () => {
    it("creates a Full Offering and shows it in the row shape of GET", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");

      const response = await add(providerId, f.users.owner, { controlId: f.controls.perSystem.id, type: "FULL" });

      expect(response.status).toBe(201);
      const { offering } = await response.json();
      expect(offering).toEqual({
        id: expect.any(String),
        control: { id: f.controls.perSystem.id, code: f.controls.perSystem.code, title: f.controls.perSystem.title },
        type: "FULL",
        customerResponsibility: null,
        applies: true,
        providerStatus: "FULFILLED",
      });
      const [stored] = await offerings(providerId);
      expect(stored).toMatchObject({ id: offering.id, controlId: f.controls.perSystem.id, type: "FULL", customerResponsibility: null });
    });

    it("creates a Shared Offering with a trimmed customer responsibility", async () => {
      const providerId = await f.makeSystem({ isProvider: true });

      const response = await add(providerId, f.users.owner, {
        controlId: f.controls.both.id,
        type: "SHARED",
        customerResponsibility: "  The tenant manages its own keys  ",
      });

      expect(response.status).toBe(201);
      expect((await response.json()).offering).toMatchObject({ type: "SHARED", customerResponsibility: "The tenant manages its own keys" });
    });

    it("stores no customer responsibility for a Full Offering, even if one is sent", async () => {
      const providerId = await f.makeSystem({ isProvider: true });

      const response = await add(providerId, f.users.owner, { controlId: f.controls.perSystem.id, type: "FULL", customerResponsibility: "ignored" });

      expect(response.status).toBe(201);
      expect((await offerings(providerId))[0].customerResponsibility).toBeNull();
    });

    it.each([
      ["no text", {}],
      ["a null text", { customerResponsibility: null }],
      ["an empty text", { customerResponsibility: "" }],
      ["a blank text", { customerResponsibility: "  \n " }],
    ])("refuses a Shared Offering with %s with 400 and writes nothing", async (_name, extra) => {
      const providerId = await f.makeSystem({ isProvider: true });

      const response = await add(providerId, f.users.owner, { controlId: f.controls.perSystem.id, type: "SHARED", ...extra });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/customer responsibility/);
      expect(await offerings(providerId)).toEqual([]);
      expect(await events(providerId)).toEqual([]);
    });

    it.each([
      ["no controlId", { type: "FULL" }],
      ["no type", { controlId: "x" }],
      ["an unknown type", { controlId: "x", type: "PARTIAL" }],
      ["a lower-case type", { controlId: "x", type: "full" }],
      ["not an object", null],
    ])("refuses %s with 400", async (_name, body) => {
      const providerId = await f.makeSystem({ isProvider: true });
      expect((await add(providerId, f.users.owner, body)).status).toBe(400);
      expect(await offerings(providerId)).toEqual([]);
    });
  });

  describe("the Provider and the Control", () => {
    it("refuses with 409 when the System is not a Provider", async () => {
      const systemId = await f.makeSystem();

      const response = await add(systemId, f.users.owner, { controlId: f.controls.perSystem.id, type: "FULL" });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/Provider/);
      expect(await offerings(systemId)).toEqual([]);
      expect(await events(systemId)).toEqual([]);
    });

    it("refuses an unknown Control with 404", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const response = await add(providerId, f.users.owner, { controlId: "no-such-control", type: "FULL" });
      expect(response.status).toBe(404);
      expect(await offerings(providerId)).toEqual([]);
    });

    it.each([
      ["a Per-System Control scoped to a Facet the Provider does not declare", "elsewhere"],
      ["an Organizational Control, which no System is assessed on", "organizational"],
    ] as const)("refuses %s with 409", async (_name, key) => {
      const providerId = await f.makeSystem({ isProvider: true });

      const response = await add(providerId, f.users.owner, { controlId: f.controls[key].id, type: "FULL" });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/applies/);
      expect(await offerings(providerId)).toEqual([]);
      expect(await events(providerId)).toEqual([]);
    });

    it("judges applicability on the Provider's own classification", async () => {
      const withStale = await f.makeSystem({ isProvider: true });
      const liveOnly = await f.makeSystem({ isProvider: true, facets: [f.facets.live] });
      const body = { controlId: f.controls.stale.id, type: "FULL" };

      expect((await add(liveOnly, f.users.owner, body)).status).toBe(409);
      expect((await add(withStale, f.users.owner, body)).status).toBe(201);
    });

    it("offers a Control the Provider has no Assessment row for yet: its own status reads Not Started", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const response = await add(providerId, f.users.owner, { controlId: f.controls.both.id, type: "FULL" });
      expect(response.status).toBe(201);
      expect((await response.json()).offering.providerStatus).toBe("NOT_STARTED");
    });

    it("refuses a second Offering of the same Control with 409, and lets two Providers offer the same one", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      const otherProvider = await f.makeSystem({ isProvider: true });
      const body = { controlId: f.controls.perSystem.id, type: "FULL" };

      expect((await add(providerId, f.users.owner, body)).status).toBe(201);
      const duplicate = await add(providerId, f.users.owner, { ...body, type: "SHARED", customerResponsibility: "x" });
      expect(duplicate.status).toBe(409);
      expect((await offerings(providerId)).length).toBe(1);
      expect((await offerings(providerId))[0].type).toBe("FULL");

      expect((await add(otherProvider, f.users.owner, body)).status).toBe(201);
    });
  });

  describe("Change Events", () => {
    it("logs one CONTROL_OFFERING_CHANGED event per added Offering, on the Provider, by the acting User", async () => {
      const providerId = await f.makeSystem({ isProvider: true });

      await add(providerId, f.users.owner, { controlId: f.controls.perSystem.id, type: "FULL" });
      await add(providerId, f.users.admin, { controlId: f.controls.both.id, type: "SHARED", customerResponsibility: "Keys" });

      expect((await events(providerId)).map((event) => [event.action, event.detail, event.actorId])).toEqual([
        ["CONTROL_OFFERING_CHANGED", `Control Offering for ${f.controls.perSystem.code} added (Full)`, f.users.owner],
        ["CONTROL_OFFERING_CHANGED", `Control Offering for ${f.controls.both.code} added (Shared)`, f.users.admin],
      ]);
    });
  });
});

describe("GET /api/systems/[id]/offerings (#123)", { timeout: 30_000 }, () => {
  it.each(["owner", "otherOwner", "reviewer", "riskOwner", "viewer", "businessRiskOwner", "complianceManager", "admin"] as const)(
    "lets a %s who can see the System read its Offerings",
    async (userKey) => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.offer(providerId, f.controls.perSystem.id, "SHARED", "Keys");

      const response = await list(providerId, f.users[userKey]);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.isProvider).toBe(true);
      expect(body.offerings).toHaveLength(1);
      expect(body.offerings[0]).toMatchObject({ type: "SHARED", customerResponsibility: "Keys" });
    },
  );

  it("answers 401 when nobody is signed in, and 404 for a System the user cannot see", async () => {
    const draft = await f.makeSystem({ status: "DRAFT", isProvider: true });
    expect((await list(draft, null)).status).toBe(401);
    expect((await list(draft, f.users.viewer)).status).toBe(404);
    expect((await list("no-such-system", f.users.admin)).status).toBe(404);
  });

  it("reports a System that is not a Provider as one without Offerings", async () => {
    const systemId = await f.makeSystem();
    const response = await list(systemId, f.users.viewer);
    expect(await response.json()).toEqual({ isProvider: false, offerings: [] });
  });

  it("lists the Offerings by Control code", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.stale.id);
    await f.offer(providerId, f.controls.both.id);
    await f.offer(providerId, f.controls.perSystem.id);

    const { offerings: rows } = await (await list(providerId, f.users.owner)).json();

    const codes = rows.map((row: { control: { code: string } }) => row.control.code);
    expect(codes).toEqual([...codes].sort());
    expect(codes).toHaveLength(3);
  });

  describe("the Provider's own status", () => {
    it("is the Provider's own Control Assessment status, and Not Started when it has no row", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.assess(providerId, f.controls.perSystem.id, "IN_PROGRESS");
      await f.assess(providerId, f.controls.stale.id, "FULFILLED");
      await f.offer(providerId, f.controls.perSystem.id);
      await f.offer(providerId, f.controls.stale.id);
      await f.offer(providerId, f.controls.both.id);

      const { offerings: rows } = await (await list(providerId, f.users.owner)).json();

      const statusOf = (code: string) => rows.find((row: { control: { code: string } }) => row.control.code === code).providerStatus;
      expect(statusOf(f.controls.perSystem.code)).toBe("IN_PROGRESS");
      expect(statusOf(f.controls.stale.code)).toBe("FULFILLED");
      expect(statusOf(f.controls.both.code)).toBe("NOT_STARTED");
    });

    it("shows the OWN status of a Both Control the Organization has Fulfilled, not its effective status", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.offer(providerId, f.controls.both.id);
      await prisma.organizationControlImplementation.upsert({
        where: { controlId: f.controls.both.id },
        create: { controlId: f.controls.both.id, status: "FULFILLED" },
        update: { status: "FULFILLED" },
      });
      try {
        // Sanity: the Provider's effective status of the Control IS Fulfilled through the Organization.
        const rows = await getSystemAssessments((await prisma.system.findUniqueOrThrow({
          where: { id: providerId },
          include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
        })));
        expect(rows.find((row) => row.control.id === f.controls.both.id)?.effective.status).toBe("FULFILLED");

        const { offerings: listed } = await (await list(providerId, f.users.owner)).json();

        expect(listed[0].providerStatus).toBe("NOT_STARTED");
      } finally {
        await prisma.organizationControlImplementation.deleteMany({ where: { controlId: f.controls.both.id } });
      }
    });

    it("shows a person-set Not Started row as Not Started and a Waived one as Waived", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.assess(providerId, f.controls.perSystem.id, "WAIVED");
      await f.offer(providerId, f.controls.perSystem.id);
      const { offerings: rows } = await (await list(providerId, f.users.owner)).json();
      expect(rows[0].providerStatus).toBe("WAIVED");
    });
  });

  describe("when the Control stops applying to the Provider", () => {
    it("keeps the Offering, reports applies=false, and lets it be removed", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.offer(providerId, f.controls.stale.id, "SHARED", "Keys");
      const before = (await (await list(providerId, f.users.owner)).json()).offerings[0];
      expect(before.applies).toBe(true);

      // Dropping the Facet the Control is scoped to recomputes the Provider's applicable Controls.
      const dropped = await patchSystem(
        requestAs(`/api/systems/${providerId}`, f.users.owner, "PATCH", { deploymentFacetIds: [f.facets.live] }),
        ctxFor(providerId),
      );
      expect(dropped.status).toBe(200);

      const after = (await (await list(providerId, f.users.owner)).json()).offerings;
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ id: before.id, type: "SHARED", customerResponsibility: "Keys", applies: false });
      expect(await offerings(providerId)).toHaveLength(1);

      // And back again: the same Offering applies once more.
      await patchSystem(
        requestAs(`/api/systems/${providerId}`, f.users.owner, "PATCH", { deploymentFacetIds: [f.facets.live, f.facets.stale] }),
        ctxFor(providerId),
      );
      expect((await (await list(providerId, f.users.owner)).json()).offerings[0]).toMatchObject({ id: before.id, applies: true });
    });

    it("keeps the Offering when a person-set Assessment of the Control is left stale, and shows its own status", async () => {
      const providerId = await f.makeSystem({ isProvider: true });
      await f.assess(providerId, f.controls.stale.id, "FULFILLED");
      await f.offer(providerId, f.controls.stale.id);

      await patchSystem(
        requestAs(`/api/systems/${providerId}`, f.users.owner, "PATCH", { deploymentFacetIds: [f.facets.live] }),
        ctxFor(providerId),
      );

      const [row] = (await (await list(providerId, f.users.owner)).json()).offerings;
      expect(row).toMatchObject({ applies: false, providerStatus: "FULFILLED" });
    });
  });
});

describe("Offerings change nothing else (#123)", { timeout: 30_000 }, () => {
  it("leaves another System that has the same Control untouched: Assessments, effective statuses and derived figures", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const dependentId = await f.makeSystem();
    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    await f.assess(dependentId, f.controls.perSystem.id, "IN_PROGRESS");
    await f.assess(dependentId, f.controls.both.id, "NOT_STARTED", null);

    const snapshot = async () => {
      const dependent = await prisma.system.findUniqueOrThrow({
        where: { id: dependentId },
        include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
      });
      return {
        assessments: await prisma.controlAssessment.findMany({ where: { systemId: dependentId }, orderBy: { id: "asc" } }),
        effective: JSON.parse(JSON.stringify((await getSystemAssessments(dependent)).map((row) => [row.control.id, row.effective]))),
        compliance: await getComplianceForSystems({ id: { in: [providerId, dependentId] } }, { frameworkId: f.frameworkId }),
        unaddressed: (await getUnaddressedMandatoryControls(dependent)).map((control) => control.id).sort(),
        system: await prisma.system.findUniqueOrThrow({ where: { id: dependentId } }),
        events: await events(dependentId),
      };
    };
    const before = await snapshot();

    for (const [controlId, type] of [
      [f.controls.perSystem.id, "FULL"],
      [f.controls.both.id, "SHARED"],
    ] as const) {
      const body = type === "SHARED" ? { controlId, type, customerResponsibility: "Keys" } : { controlId, type };
      expect((await add(providerId, f.users.owner, body)).status).toBe(201);
    }

    expect(await snapshot()).toEqual(before);
  });
});

describe("unmarking racing an add (#123)", { timeout: 30_000 }, () => {
  it("never leaves a System that is not a Provider with an Offering", async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const providerId = await f.makeSystem({ isProvider: true });

      const [added, unmarked] = await Promise.all([
        add(providerId, f.users.owner, { controlId: f.controls.perSystem.id, type: "FULL" }),
        markProvider(requestAs(`/api/systems/${providerId}/provider`, f.users.owner, "PATCH", { isProvider: false }), ctxFor(providerId)),
      ]);

      // Either the Offering went in first (and the unmark was refused) or the unmark did (and the add was refused).
      const system = await prisma.system.findUniqueOrThrow({ where: { id: providerId } });
      const count = (await offerings(providerId)).length;
      expect([added.status, unmarked.status]).toSatisfy((statuses: number[]) => statuses.join() === "201,409" || statuses.join() === "409,200");
      expect(system.isProvider ? 1 : 0).toBe(count);
    }
  });
});

describe("deleting a Provider or a Control (#123)", { timeout: 30_000 }, () => {
  it("removes a System's Offerings with it", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.perSystem.id);
    await f.offer(providerId, f.controls.both.id);
    const keptProvider = await f.makeSystem({ isProvider: true });
    await f.offer(keptProvider, f.controls.perSystem.id);

    await prisma.system.delete({ where: { id: providerId } });

    expect(await offerings(providerId)).toEqual([]);
    expect(await offerings(keptProvider)).toHaveLength(1);
  });

  it("removes a Control's Offerings with it", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    const control = await prisma.control.create({
      data: { code: `TEST-PrvOffer-doomed-${f.suffix}`, title: "Doomed", description: "d", category: "Test", applicability: "PER_SYSTEM" },
    });
    await f.offer(providerId, control.id);

    await prisma.control.delete({ where: { id: control.id } });

    expect(await offerings(providerId)).toEqual([]);
  });
});
