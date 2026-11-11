import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";

/** "About the system" on create (#357): the vendor, service, data location and contract details, and the vendor rule. */

const suffix = `${process.pid}-${Date.now()}`;
const NAME = `Test Vendor Create ${suffix}`;
let creatorId: string;
let plainFacetId: string;
let vendorFacetId: string;

beforeAll(async () => {
  creatorId = (await prisma.user.create({ data: { email: `test-vendorcreate-${suffix}@example.com`, name: "Test VendorCreate creator", role: "SYSTEM_OWNER" } })).id;
  plainFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test Vendor Create Plain ${suffix}` } })).id;
  vendorFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test Vendor Create Vendor ${suffix}`, requiresVendorDetails: true } })).id;
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { name: NAME } });
  await prisma.deploymentFacet.deleteMany({ where: { id: { in: [plainFacetId, vendorFacetId] } } });
  await prisma.user.deleteMany({ where: { id: creatorId } });
});

const create = (extra: Record<string, unknown>, facetIds = [plainFacetId]) =>
  POST(requestAs("/api/systems", creatorId, "POST", { name: NAME, deploymentFacetIds: facetIds, ...extra }));
const created = () => prisma.system.findMany({ where: { name: NAME } });

const FULL = {
  vendor: "  Acme  ",
  vendorWebsiteUrl: "https://www.acme.example",
  serviceUrl: "https://app.acme.example/login",
  productPlan: "Acme Cloud Premium",
  vendorTrustUrl: "http://trust.acme.example/security",
  dataLocation: "EU_EEA",
  dataProcessingAgreement: "IN_PROGRESS",
  contractReference: "C-2026-14",
  contractRenewalDate: "2027-03-31",
  noticePeriodMonths: 3,
};

describe("POST /api/systems with About the system details (#357)", { timeout: 30_000 }, () => {
  it("stores every detail, trimmed, and keeps the renewal date as the day it was given", async () => {
    const response = await create(FULL, [vendorFacetId]);
    expect(response.status).toBe(201);
    const [system] = await created();
    expect(system).toMatchObject({
      vendor: "Acme",
      vendorWebsiteUrl: "https://www.acme.example",
      serviceUrl: "https://app.acme.example/login",
      productPlan: "Acme Cloud Premium",
      vendorTrustUrl: "http://trust.acme.example/security",
      dataLocation: "EU_EEA",
      dataProcessingAgreement: "IN_PROGRESS",
      contractReference: "C-2026-14",
      noticePeriodMonths: 3,
    });
    expect(system.contractRenewalDate?.toISOString().slice(0, 10)).toBe("2027-03-31");
    await prisma.system.deleteMany({ where: { name: NAME } });
  });

  it("creates a System with none of the new details, and they are all null", async () => {
    expect((await create({})).status).toBe(201);
    const [system] = await created();
    expect(system).toMatchObject({
      vendor: null,
      vendorWebsiteUrl: null,
      serviceUrl: null,
      productPlan: null,
      vendorTrustUrl: null,
      dataLocation: null,
      dataProcessingAgreement: null,
      contractReference: null,
      contractRenewalDate: null,
      noticePeriodMonths: null,
    });
    await prisma.system.deleteMany({ where: { name: NAME } });
  });

  it.each([
    ["a javascript: vendor website", { vendorWebsiteUrl: "javascript:alert(1)" }],
    ["an ftp: service URL", { serviceUrl: "ftp://files.example/app" }],
    ["a data: trust page", { vendorTrustUrl: "data:text/html,hi" }],
    ["a service URL that is not a URL", { serviceUrl: "acme dot com" }],
    ["a data location that is not listed", { dataLocation: "MARS" }],
    ["a data processing agreement that is not listed", { dataProcessingAgreement: "MAYBE" }],
    ["a renewal date that is not a date", { contractRenewalDate: "2027-02-30" }],
    ["a renewal date in the wrong format", { contractRenewalDate: "31/03/2027" }],
    ["a notice period below 0", { noticePeriodMonths: -1 }],
    ["a notice period above 120", { noticePeriodMonths: 121 }],
    ["a notice period that is not whole", { noticePeriodMonths: 1.5 }],
    ["a notice period that is text", { noticePeriodMonths: "three" }],
    ["a product and plan over 200 characters", { productPlan: "p".repeat(201) }],
  ])("refuses %s with 400 and creates nothing", async (_label, extra) => {
    const response = await create(extra);
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(await created()).toEqual([]);
  });

  it("accepts the limits of the notice period", async () => {
    expect((await create({ noticePeriodMonths: 0 })).status).toBe(201);
    await prisma.system.deleteMany({ where: { name: NAME } });
    expect((await create({ noticePeriodMonths: 120 })).status).toBe(201);
    await prisma.system.deleteMany({ where: { name: NAME } });
  });

  describe("a Deployment Facet that needs vendor details", () => {
    it.each([
      ["neither vendor name nor service URL", {}],
      ["no service URL", { vendor: "Acme" }],
      ["no vendor name", { serviceUrl: "https://app.acme.example" }],
      ["a blank vendor name", { vendor: "   ", serviceUrl: "https://app.acme.example" }],
      ["a blank service URL", { vendor: "Acme", serviceUrl: "  " }],
    ])("refuses %s with 400 and creates nothing", async (_label, extra) => {
      const response = await create(extra, [vendorFacetId]);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/vendor name and service URL/);
      expect(await created()).toEqual([]);
    });

    it("applies when any declared Facet needs them, not only when it is the one declared", async () => {
      expect((await create({}, [plainFacetId, vendorFacetId])).status).toBe(400);
      expect(await created()).toEqual([]);
    });

    it("creates the System once both are given", async () => {
      const response = await create({ vendor: "Acme", serviceUrl: "https://app.acme.example" }, [vendorFacetId]);
      expect(response.status).toBe(201);
      expect(await created()).toHaveLength(1);
      await prisma.system.deleteMany({ where: { name: NAME } });
    });

    it("stops applying when an Admin turns the flag off", async () => {
      await prisma.deploymentFacet.update({ where: { id: vendorFacetId }, data: { requiresVendorDetails: false } });
      try {
        expect((await create({}, [vendorFacetId])).status).toBe(201);
      } finally {
        await prisma.deploymentFacet.update({ where: { id: vendorFacetId }, data: { requiresVendorDetails: true } });
        await prisma.system.deleteMany({ where: { name: NAME } });
      }
    });
  });

  it("writes no Change Event for a refused create", async () => {
    const before = await prisma.changeEvent.count({ where: { actorId: creatorId } });
    expect((await create({ serviceUrl: "ftp://x" })).status).toBe(400);
    expect(await prisma.changeEvent.count({ where: { actorId: creatorId } })).toBe(before);
  });
});
