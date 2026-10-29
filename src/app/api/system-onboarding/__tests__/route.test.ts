import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import type { OnboardingCatalog } from "@/lib/onboarding-interview";
import { GET } from "../route";

describe("GET /api/system-onboarding", () => {
  const fx = setupProviderFixtures("onboarding-read");
  let onboardedId: string;
  let draftProviderId: string;
  let strangerProviderId: string;
  let draftFrameworkId: string;
  let publishedWithQuestionId: string;

  const get = (userId: string | null) => GET(requestAs("/api/system-onboarding", userId, "GET"));
  async function catalog(): Promise<OnboardingCatalog> {
    const response = await get(fx.users.owner);
    expect(response.status).toBe(200);
    return response.json();
  }

  beforeAll(async () => {
    // Onboarded Provider: Full (Fulfilled) perSystem, Shared both, and an Offering of a Control it no longer takes.
    onboardedId = await fx.makeSystem({ isProvider: true, name: `Test onboarding read Provider ${fx.suffix}` });
    await fx.offer(onboardedId, fx.controls.perSystem.id, "FULL");
    await fx.assess(onboardedId, fx.controls.perSystem.id, "FULFILLED");
    await fx.offer(onboardedId, fx.controls.both.id, "SHARED", "Review the access list");
    // Provider that is not Onboarded: its Offerings must not be revealed.
    draftProviderId = await fx.makeSystem({ isProvider: true, status: "DRAFT", name: `Test onboarding read Draft Provider ${fx.suffix}` });
    await fx.offer(draftProviderId, fx.controls.perSystem.id, "FULL");
    await fx.assess(draftProviderId, fx.controls.perSystem.id, "FULFILLED");
    // Onboarded Provider without the Facet the Control is scoped to: the Control doesn't apply to it, so the Offering doesn't count.
    strangerProviderId = await fx.makeSystem({ isProvider: true, facets: [fx.facets.elsewhere], name: `Test onboarding read Other Provider ${fx.suffix}` });
    await fx.offer(strangerProviderId, fx.controls.perSystem.id, "FULL");
    await fx.assess(strangerProviderId, fx.controls.perSystem.id, "FULFILLED");

    draftFrameworkId = (
      await prisma.framework.create({
        data: { name: `Test onboarding read Draft ${fx.suffix}`, version: "1", status: "DRAFT", onboardingQuestion: "Never shown?" },
      })
    ).id;
    publishedWithQuestionId = (
      await prisma.framework.update({
        where: { id: fx.frameworkId },
        data: { onboardingQuestion: "Does it hold personal data?", onboardingHint: "Customers, employees." },
      })
    ).id;
    await prisma.organizationControlImplementation.create({
      data: { controlId: fx.controls.both.id, status: "FULFILLED" },
    });
  });

  afterAll(async () => {
    await prisma.organizationControlImplementation.deleteMany({ where: { controlId: fx.controls.both.id } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
  });

  it("refuses nobody signed in (401) and every role that can't create a System (403)", async () => {
    expect((await get(null)).status).toBe(401);
    for (const role of ["viewer", "complianceManager", "reviewer", "businessRiskOwner"] as const) {
      const response = await get(fx.users[role]);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only a System Owner, Risk Owner or Admin can create a System" });
    }
    for (const role of ["owner", "riskOwner", "admin"] as const) expect((await get(fx.users[role])).status).toBe(200);
  });

  it("lists the Deployment Facets and only the Published Frameworks, with their onboarding question", async () => {
    const body = await catalog();
    expect(body.deploymentFacets.map((f) => f.id)).toEqual(expect.arrayContaining([fx.facets.live, fx.facets.stale, fx.facets.elsewhere]));
    const ids = body.frameworks.map((f) => f.id);
    expect(ids).toContain((await getBaseFramework()).id);
    expect(ids).toContain(publishedWithQuestionId);
    expect(ids).not.toContain(draftFrameworkId);
    expect(body.frameworks.find((f) => f.id === publishedWithQuestionId)).toMatchObject({
      isBase: false,
      onboardingQuestion: "Does it hold personal data?",
      onboardingHint: "Customers, employees.",
    });
    expect(JSON.stringify(body)).not.toContain("Never shown?");
  });

  it("carries the Per-System and Both Control library with what applicability needs, and no Organizational Control", async () => {
    const body = await catalog();
    const byId = new Map(body.controls.map((c) => [c.id, c]));
    expect(byId.has(fx.controls.organizational.id)).toBe(false);
    expect(byId.get(fx.controls.perSystem.id)).toMatchObject({
      code: fx.controls.perSystem.code,
      title: fx.controls.perSystem.title,
      applicability: "PER_SYSTEM",
      deploymentFacetIds: [fx.facets.live],
      frameworkIds: [fx.frameworkId],
      organizationFulfilled: false,
    });
    expect(byId.get(fx.controls.both.id)).toMatchObject({ applicability: "BOTH", organizationFulfilled: true });
    expect(body.controls.map((c) => c.code)).toEqual([...body.controls.map((c) => c.code)].sort());
  });

  it("counts a Provider's Offerings only while it is Onboarded and the Control still applies to it, and reveals nothing else", async () => {
    const body = await catalog();
    const names = Object.fromEntries(body.providers.map((p) => [p.id, p]));
    expect(names[onboardedId]).toEqual({ id: onboardedId, name: `Test onboarding read Provider ${fx.suffix}`, onboarded: true });
    expect(names[draftProviderId]).toEqual({ id: draftProviderId, name: `Test onboarding read Draft Provider ${fx.suffix}`, onboarded: false });
    // A System that is not a Provider is not listed.
    expect(body.providers.some((p) => p.id === fx.users.owner)).toBe(false);

    const perSystem = body.controls.find((c) => c.id === fx.controls.perSystem.id)!;
    expect(perSystem.offerings).toEqual([{ providerId: onboardedId, type: "FULL", customerResponsibility: null, fulfilled: true }]);
    const both = body.controls.find((c) => c.id === fx.controls.both.id)!;
    expect(both.offerings).toEqual([{ providerId: onboardedId, type: "SHARED", customerResponsibility: "Review the access list", fulfilled: false }]);

    // Nothing of the not-Onboarded Provider's Offerings, and none of any Provider's own state beyond the booleans above.
    const text = JSON.stringify(body);
    expect(text).not.toContain(draftProviderId + '","type"');
    expect(body.controls.flatMap((c) => c.offerings.map((o) => o.providerId))).not.toContain(draftProviderId);
    expect(body.controls.flatMap((c) => c.offerings.map((o) => o.providerId))).not.toContain(strangerProviderId);
    expect(Object.keys(body.providers[0]).sort()).toEqual(["id", "name", "onboarded"]);
    for (const control of body.controls) for (const offering of control.offerings) expect(Object.keys(offering).sort()).toEqual(["customerResponsibility", "fulfilled", "providerId", "type"]);
  });
});
