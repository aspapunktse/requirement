import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../details/route";

/** Editing the vendor, service, data location and contract details in System details (#357). */

const suffix = `${process.pid}-${Date.now()}`;
const EMAIL = (key: string) => `test-357-${key}-${suffix}@example.com`;
let ownerId: string;
let otherId: string;
let adminId: string;
let flaggedFacetId: string;
let plainFacetId: string;
let systemId: string;

function patch(userId: string | null, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return PATCH(
    new NextRequest(`http://localhost/api/systems/${systemId}/details`, { method: "PATCH", headers, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: systemId }) },
  );
}

beforeAll(async () => {
  ownerId = (await prisma.user.create({ data: { email: EMAIL("owner"), name: "Test 357 owner", role: "SYSTEM_OWNER" } })).id;
  otherId = (await prisma.user.create({ data: { email: EMAIL("other"), name: "Test 357 other", role: "SYSTEM_OWNER" } })).id;
  adminId = (await prisma.user.create({ data: { email: EMAIL("admin"), name: "Test 357 admin", role: "ADMIN" } })).id;
  flaggedFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test 357 Flagged ${suffix}`, requiresVendorDetails: true } })).id;
  plainFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test 357 Plain ${suffix}` } })).id;
});

afterAll(async () => {
  await prisma.deploymentFacet.deleteMany({ where: { id: { in: [flaggedFacetId, plainFacetId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId, adminId] } } });
});

async function makeSystem(facetId: string, data: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: {
      name: "Test 357 System",
      ownerId,
      status: "ONBOARDED",
      vendor: "Test 357 Vendor",
      serviceUrl: "https://app.example.com",
      deploymentFacets: { connect: [{ id: facetId }] },
      ...data,
    },
  });
  systemId = system.id;
}

afterEach(async () => {
  await prisma.changeEvent.deleteMany({ where: { systemId } });
  await prisma.system.deleteMany({ where: { id: systemId } });
});

const events = () => prisma.changeEvent.findMany({ where: { systemId, action: "SYSTEM_DETAILS_CHANGED" } });
const row = () => prisma.system.findUniqueOrThrow({ where: { id: systemId } });

describe("PATCH /api/systems/[id]/details with About the system details (#357)", { timeout: 30_000 }, () => {
  describe("on a System with a Deployment Facet that needs vendor details", () => {
    beforeEach(() => makeSystem(flaggedFacetId));

    it.each([["owner"], ["admin"]])("lets the %s set every detail and logs one Change Event with old and new values", async (who) => {
      const response = await patch(who === "owner" ? ownerId : adminId, {
        vendorWebsiteUrl: "https://acme.example",
        serviceUrl: "https://app.acme.example",
        productPlan: "Premium",
        vendorTrustUrl: "https://trust.acme.example",
        dataLocation: "SWEDEN",
        dataProcessingAgreement: "SIGNED",
        contractReference: "C-1",
        contractRenewalDate: "2027-06-30",
        noticePeriodMonths: 6,
      });
      expect(response.status).toBe(200);
      const system = await row();
      expect(system).toMatchObject({
        vendorWebsiteUrl: "https://acme.example",
        serviceUrl: "https://app.acme.example",
        productPlan: "Premium",
        vendorTrustUrl: "https://trust.acme.example",
        dataLocation: "SWEDEN",
        dataProcessingAgreement: "SIGNED",
        contractReference: "C-1",
        noticePeriodMonths: 6,
        status: "ONBOARDED",
      });
      expect(system.contractRenewalDate?.toISOString().slice(0, 10)).toBe("2027-06-30");
      const logged = await events();
      expect(logged).toHaveLength(1);
      const detail = logged[0].detail!;
      expect(detail).toContain("https://app.example.com");
      expect(detail).toContain("https://app.acme.example");
      expect(detail).toContain("C-1");
      expect(detail).toContain("6 months");
    });

    it.each([
      ["a javascript: URL", { serviceUrl: "javascript:alert(1)" }],
      ["a non-http vendor website", { vendorWebsiteUrl: "ftp://x.example" }],
      ["an unknown data location", { dataLocation: "MARS" }],
      ["an unknown agreement status", { dataProcessingAgreement: "MAYBE" }],
      ["a notice period of 121", { noticePeriodMonths: 121 }],
      ["a notice period of -1", { noticePeriodMonths: -1 }],
      ["a fractional notice period", { noticePeriodMonths: 2.5 }],
      ["an impossible date", { contractRenewalDate: "2027-13-01" }],
    ])("refuses %s with 400 and changes nothing", async (_label, body) => {
      const before = await row();
      expect((await patch(ownerId, { ...body, productPlan: "Changed" })).status).toBe(400);
      expect(await row()).toEqual(before);
      expect(await events()).toHaveLength(0);
    });

    it.each([
      ["vendor", { vendor: "" }],
      ["vendor as null", { vendor: null }],
      ["service URL", { serviceUrl: "  " }],
      ["service URL as null", { serviceUrl: null }],
    ])("refuses clearing the %s with 400 and changes nothing", async (_label, body) => {
      const before = await row();
      const response = await patch(ownerId, { ...body, contractReference: "Changed" });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/vendor name and service URL/);
      expect(await row()).toEqual(before);
      expect(await events()).toHaveLength(0);
    });

    it("refuses a non-owner with 403 and an unauthenticated request with 401, changing nothing", async () => {
      const before = await row();
      expect((await patch(otherId, { productPlan: "Nope" })).status).toBe(403);
      expect((await patch(null, { productPlan: "Nope" })).status).toBe(401);
      expect(await row()).toEqual(before);
      expect(await events()).toHaveLength(0);
    });

    it("refuses with 409 once the evaluation is closed, and changes nothing", async () => {
      await prisma.system.update({ where: { id: systemId }, data: { evaluationClosedAt: new Date() } });
      const before = await row();
      expect((await patch(ownerId, { productPlan: "Late" })).status).toBe(409);
      expect(await row()).toEqual(before);
      expect(await events()).toHaveLength(0);
    });
  });

  it("does not block a legacy flagged System that lacks vendor and service URL from editing other fields", async () => {
    await makeSystem(flaggedFacetId, { vendor: null, serviceUrl: null });
    expect((await patch(ownerId, { productPlan: "Plan", description: "Text" })).status).toBe(200);
    expect(await row()).toMatchObject({ productPlan: "Plan", description: "Text", vendor: null, serviceUrl: null });
    expect(await events()).toHaveLength(1);
  });

  it("allows clearing vendor and service URL when no declared Facet needs them", async () => {
    await makeSystem(plainFacetId);
    expect((await patch(ownerId, { vendor: null, serviceUrl: null })).status).toBe(200);
    expect(await row()).toMatchObject({ vendor: null, serviceUrl: null });
    expect(await events()).toHaveLength(1);
  });

  it("writes nothing when the details sent equal what is stored", async () => {
    await makeSystem(plainFacetId, { dataLocation: "EU_EEA", noticePeriodMonths: 3 });
    expect((await patch(ownerId, { dataLocation: "EU_EEA", noticePeriodMonths: 3 })).status).toBe(200);
    expect(await events()).toHaveLength(0);
  });
});
