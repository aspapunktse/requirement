import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { POST } from "../route";

/**
 * POST /api/systems with Information Types, from the onboarding interview (#304, ADR 0012): connected in the same
 * transaction as the System, and the same floor as on the Profile tab, so a refused create leaves nothing behind.
 */
describe("POST /api/systems: Information Types", () => {
  const fx = setupProviderFixtures("types-create");
  const NAME = `Test #304 create ${process.pid}-${Date.now()}`;
  let payrollId: string; // Highly Sensitive (4)
  let codeId: string; // Sensitive (3)

  const create = (userId: string | null, body: Record<string, unknown>) =>
    POST(requestAs("/api/systems", userId, "POST", { name: NAME, deploymentFacetIds: [fx.facets.live], ...body }));

  const systemsNamed = () => prisma.system.count({ where: { name: NAME } });

  beforeAll(async () => {
    payrollId = (await prisma.informationType.create({ data: { name: `Test #304 create Payroll ${fx.suffix}`, sensitivityLevel: 4 } })).id;
    codeId = (await prisma.informationType.create({ data: { name: `Test #304 create Source code ${fx.suffix}`, sensitivityLevel: 3 } })).id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { name: NAME } });
    await prisma.informationType.deleteMany({ where: { id: { in: [payrollId, codeId] } } });
  });

  it("creates the System with its types and a Change Event naming them", async () => {
    const response = await create(fx.users.owner, { sensitivityLevel: 4, informationTypeIds: [payrollId, codeId, payrollId] });
    expect(response.status).toBe(201);
    const id = (await response.json()).system.id as string;
    fx.systemIds.push(id);

    const system = await prisma.system.findUniqueOrThrow({ where: { id }, include: { informationTypes: true } });
    expect(system.sensitivityLevel).toBe(4);
    expect(system.informationTypes.map((t) => t.id).sort()).toEqual([payrollId, codeId].sort());
    const events = await prisma.changeEvent.findMany({ where: { systemId: id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["SYSTEM_CREATED", "CLASSIFICATION_CHANGED"]);
    expect(events[1]).toMatchObject({ actorId: fx.users.owner });
    expect(events[1].detail).toBe(`Information Types: none → Test #304 create Payroll ${fx.suffix}, Test #304 create Source code ${fx.suffix}`);
  });

  it("refuses a level below the highest type, and creates nothing", async () => {
    const before = await systemsNamed();
    const response = await create(fx.users.owner, { sensitivityLevel: 3, informationTypeIds: [payrollId] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(`Test #304 create Payroll ${fx.suffix}`);
    expect(await systemsNamed()).toBe(before);
  });

  it("refuses types with no level, and creates nothing", async () => {
    const before = await systemsNamed();
    const response = await create(fx.users.owner, { informationTypeIds: [codeId] });
    expect(response.status).toBe(400);
    expect(await systemsNamed()).toBe(before);
  });

  it("refuses an unknown type id, and creates nothing", async () => {
    const before = await systemsNamed();
    const response = await create(fx.users.owner, { sensitivityLevel: 5, informationTypeIds: ["no-such-type"] });
    expect(response.status).toBe(400);
    expect(await systemsNamed()).toBe(before);
  });

  it("creates a System with no types as before, level free", async () => {
    const response = await create(fx.users.owner, { sensitivityLevel: 1 });
    expect(response.status).toBe(201);
    const id = (await response.json()).system.id as string;
    fx.systemIds.push(id);
    expect(await prisma.system.findUniqueOrThrow({ where: { id }, include: { informationTypes: true } })).toMatchObject({ sensitivityLevel: 1, informationTypes: [] });
    expect(await prisma.changeEvent.count({ where: { systemId: id, action: "CLASSIFICATION_CHANGED" } })).toBe(0);
  });
});
