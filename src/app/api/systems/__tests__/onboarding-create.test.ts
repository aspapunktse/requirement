import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { applyFrameworkScopeDeclared } from "@/lib/framework-scope";
import { declareProviderDependency } from "@/lib/provider-dependencies";
import { POST } from "../route";

/**
 * POST /api/systems with the onboarding interview's answers (#258): Framework Scope and Provider
 * dependencies in the same transaction as the System, with the result of creating the System and then
 * declaring them on the Profile and Providers tabs.
 */
describe("POST /api/systems: Framework Scope and Providers in one transaction", () => {
  const fx = setupProviderFixtures("onboarding-create");
  const NAME = `Test onboarding create ${process.pid}-${Date.now()}`;
  let providerId: string;
  let notOnboardedProviderId: string;
  let plainSystemId: string;
  let draftFrameworkId: string;
  let baseId: string;

  const create = (userId: string | null, body: Record<string, unknown>) =>
    POST(requestAs("/api/systems", userId, "POST", { name: NAME, deploymentFacetIds: [fx.facets.live], ...body }));

  /** Tracks a created System for cleanup and returns its id. */
  async function created(response: Response) {
    const id = (await response.json()).system.id as string;
    fx.systemIds.push(id);
    return id;
  }

  /** Everything the acting owner owns, so a refused create that left a System behind shows up whatever its name. */
  const owned = () => prisma.system.count({ where: { ownerId: fx.users.owner } });
  const dependencyCount = () => prisma.providerDependency.count({ where: { providerId: { in: [providerId, notOnboardedProviderId] } } });

  beforeAll(async () => {
    baseId = (await getBaseFramework()).id;
    providerId = await fx.makeSystem({ isProvider: true, name: `Test onboarding create Provider ${fx.suffix}` });
    notOnboardedProviderId = await fx.makeSystem({ isProvider: true, status: "DRAFT", name: `Test onboarding create Draft Provider ${fx.suffix}` });
    plainSystemId = await fx.makeSystem();
    // The Provider fully offers perSystem (Fulfilled) and shares both: a new dependent's perSystem moves to Fulfilled.
    await fx.offer(providerId, fx.controls.perSystem.id, "FULL");
    await fx.assess(providerId, fx.controls.perSystem.id, "FULFILLED");
    await fx.offer(providerId, fx.controls.both.id, "SHARED", "Review the access list");
    draftFrameworkId = (await prisma.framework.create({ data: { name: `Test onboarding create Draft ${fx.suffix}`, version: "1", status: "DRAFT" } })).id;
  });

  afterAll(async () => {
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
  });

  it("creates the System with its Framework Scope, Provider dependency and every Change Event", async () => {
    const response = await create(fx.users.owner, {
      vendor: "Acme",
      confidentialityImpactLevel: "HIGH",
      frameworkScopeIds: [fx.frameworkId],
      providerIds: [providerId],
    });
    expect(response.status).toBe(201);
    const id = await created(response);

    const system = await prisma.system.findUniqueOrThrow({
      where: { id },
      include: { frameworkScopes: true, deploymentFacets: true, providerDependencies: true },
    });
    expect(system).toMatchObject({ name: NAME, vendor: "Acme", status: "DRAFT", ownerId: fx.users.owner, confidentialityImpactLevel: "HIGH" });
    expect(system.frameworkScopes.map((f) => f.id)).toEqual([fx.frameworkId]);
    expect(system.deploymentFacets.map((f) => f.id)).toEqual([fx.facets.live]);
    expect(system.providerDependencies.map((d) => d.providerId)).toEqual([providerId]);

    const events = await prisma.changeEvent.findMany({ where: { systemId: id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.action, e.actorId])).toEqual([
      ["SYSTEM_CREATED", fx.users.owner],
      ["CLASSIFICATION_CHANGED", fx.users.owner],
      ["CLASSIFICATION_CHANGED", fx.users.owner],
      ["ASSESSMENT_STATUS_CHANGED", "system"],
    ]);
    expect(events[1].detail).toMatch(/^Framework Scope ".+" added \(\+\d+\/-0 Control Assessment\(s\)\)$/);
    expect(events[2].detail).toBe(`Provider dependency on "Test onboarding create Provider ${fx.suffix}" added`);
  });

  it("gives the same result as creating the System and then declaring the scope and the dependency", async () => {
    const body = { frameworkScopeIds: [fx.frameworkId], providerIds: [providerId] };
    const oneStep = await created(await create(fx.users.owner, body));

    const twoSteps = await created(await create(fx.users.owner, {}));
    const bare = await prisma.system.findUniqueOrThrow({ where: { id: twoSteps }, include: { deploymentFacets: true, frameworkScopes: true } });
    const framework = await prisma.framework.findUniqueOrThrow({ where: { id: fx.frameworkId } });
    await applyFrameworkScopeDeclared(bare, framework, fx.users.owner);
    expect(await declareProviderDependency({ id: twoSteps }, providerId, { id: fx.users.owner, role: "SYSTEM_OWNER" })).toEqual({ ok: true, value: null });

    const snapshot = async (id: string) => ({
      events: (await prisma.changeEvent.findMany({ where: { systemId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => [e.action, e.detail, e.actorId]),
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId: id }, orderBy: { controlId: "asc" } })).map((a) => [a.controlId, a.status, a.assessedById]),
      scopes: (await prisma.system.findUniqueOrThrow({ where: { id }, include: { frameworkScopes: true } })).frameworkScopes.map((f) => f.id),
      dependencies: (await prisma.providerDependency.findMany({ where: { dependentId: id } })).map((d) => d.providerId),
    });
    const [a, b] = [await snapshot(oneStep), await snapshot(twoSteps)];
    expect(a.events.length).toBeGreaterThanOrEqual(4);
    expect(a).toEqual(b);
  });

  it("ignores repeated ids", async () => {
    const id = await created(await create(fx.users.owner, { frameworkScopeIds: [fx.frameworkId, fx.frameworkId], providerIds: [providerId, providerId] }));
    expect(await prisma.providerDependency.count({ where: { dependentId: id } })).toBe(1);
    expect(await prisma.changeEvent.count({ where: { systemId: id, detail: { startsWith: "Framework Scope" } } })).toBe(1);
  });

  it("allows a Provider that is not Onboarded: it only counts once it is", async () => {
    const id = await created(await create(fx.users.owner, { providerIds: [notOnboardedProviderId] }));
    expect(await prisma.providerDependency.count({ where: { dependentId: id, providerId: notOnboardedProviderId } })).toBe(1);
  });

  describe("refusals create nothing", () => {
    const refusals: [string, () => Record<string, unknown>, number][] = [
      ["a Draft Framework", () => ({ frameworkScopeIds: [draftFrameworkId] }), 400],
      ["the base Framework", () => ({ frameworkScopeIds: [baseId] }), 400],
      ["an unknown Framework", () => ({ frameworkScopeIds: ["nope"] }), 400],
      ["a System that is not a Provider", () => ({ providerIds: [plainSystemId] }), 400],
      ["an unknown Provider", () => ({ providerIds: ["nope"] }), 400],
      // The valid Framework Scope was declared before the bad Provider was found: it must roll back with the System.
      ["a good Framework Scope with a bad Provider", () => ({ frameworkScopeIds: [fx.frameworkId], providerIds: [providerId, plainSystemId] }), 400],
      ["a missing name", () => ({ name: "" }), 400],
      ["no Deployment Facet", () => ({ deploymentFacetIds: [] }), 400],
      ["an unknown Deployment Facet", () => ({ deploymentFacetIds: ["nope"] }), 400],
      ["ids that are not lists", () => ({ providerIds: "x" }), 400],
    ];

    it.each(refusals)("%s", async (_label, body, status) => {
      const [systems, dependencies] = [await owned(), await dependencyCount()];
      const response = await create(fx.users.owner, body());
      expect(response.status).toBe(status);
      expect((await response.json()).error).toEqual(expect.any(String));
      expect(await owned()).toBe(systems);
      expect(await dependencyCount()).toBe(dependencies);
    });

    it("a role that can't create a System (403) and nobody signed in (401)", async () => {
      const [systems, dependencies] = [await owned(), await dependencyCount()];
      const body = { frameworkScopeIds: [fx.frameworkId], providerIds: [providerId] };
      for (const role of ["viewer", "complianceManager", "reviewer"] as const) {
        expect((await create(fx.users[role], body)).status).toBe(403);
      }
      expect((await create(null, body)).status).toBe(401);
      expect(await owned()).toBe(systems);
      expect(await dependencyCount()).toBe(dependencies);
    });
  });
});
