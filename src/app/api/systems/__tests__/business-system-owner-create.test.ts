import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";

/** Naming a Business System Owner in the onboarding interview (#321, F-BSO.1). */

const suffix = `${process.pid}-${Date.now()}`;
const NAME = `Test Bso Create ${suffix}`;
let creatorId: string;
let bsoId: string;
let facetId: string;

beforeAll(async () => {
  creatorId = (await prisma.user.create({ data: { email: `test-bsocreate-creator-${suffix}@example.com`, name: "Test BsoCreate creator", role: "SYSTEM_OWNER" } })).id;
  bsoId = (await prisma.user.create({ data: { email: `test-bsocreate-bso-${suffix}@example.com`, name: "Test BsoCreate bso", role: "VIEWER" } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test Bso Create Facet ${suffix}` } })).id;
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { name: NAME } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: { in: [creatorId, bsoId] } } });
});

const create = (extra: Record<string, unknown>) =>
  POST(requestAs("/api/systems", creatorId, "POST", { name: NAME, deploymentFacetIds: [facetId], ...extra }));
const created = () => prisma.system.findMany({ where: { name: NAME } });

describe("POST /api/systems with a Business System Owner (#321)", { timeout: 30_000 }, () => {
  it("creates a System without one by default", async () => {
    const response = await create({});
    expect(response.status).toBe(201);
    const [system] = await created();
    expect(system.businessSystemOwnerId).toBeNull();
    expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "BUSINESS_SYSTEM_OWNER_CHANGED" } })).toBe(0);
    await prisma.system.deleteMany({ where: { name: NAME } });
  });

  it("creates the System with the Business System Owner, with its own BUSINESS_SYSTEM_OWNER_CHANGED event", async () => {
    const response = await create({ businessSystemOwnerId: bsoId });
    expect(response.status).toBe(201);
    const id = (await response.json()).system.id as string;
    expect((await prisma.system.findUniqueOrThrow({ where: { id } })).businessSystemOwnerId).toBe(bsoId);
    const events = await prisma.changeEvent.findMany({ where: { systemId: id } });
    expect(events.filter((event) => event.action === "SYSTEM_CREATED")).toHaveLength(1);
    const bsoEvents = events.filter((event) => event.action === "BUSINESS_SYSTEM_OWNER_CHANGED");
    expect(bsoEvents).toHaveLength(1);
    expect(bsoEvents[0]).toMatchObject({ actorId: creatorId, detail: "Business System Owner changed from none to Test BsoCreate bso" });
    await prisma.system.deleteMany({ where: { id } });
  });

  it("refuses the creator as Business System Owner with 400 and creates nothing", async () => {
    const response = await create({ businessSystemOwnerId: creatorId });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/can't be you/);
    expect(await created()).toEqual([]);
  });

  it("refuses a user who doesn't exist with 400 and creates nothing", async () => {
    expect((await create({ businessSystemOwnerId: "no-such-user" })).status).toBe(400);
    expect(await created()).toEqual([]);
  });
});
