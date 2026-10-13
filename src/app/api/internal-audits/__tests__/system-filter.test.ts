import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInternalAudit, getInternalAudit, listSystemFilterOptions } from "@/lib/internal-audits";
import { createFixtureFramework, getBaseFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { GET as resolveFilter } from "../system-filter/route";
import { PATCH as patchAudit } from "../[id]/route";

/**
 * Selecting an Internal Audit's Systems by filter (#153). Fixtures only (CI's database is
 * migrated but not seeded), and every assertion is about this file's own Systems: other test
 * files create Systems concurrently and the base Framework matches all of them, so an exact set is
 * asserted only where a fixture Framework, Facet or Business Unit discriminates.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];
const NOT_WRITING = ROLES.filter((role) => role !== "INTERNAL_AUDITOR");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

describe("GET /api/internal-audits/system-filter (#153)", () => {
  const users = {} as Record<UserRole, string>;
  let framework: { id: string };
  let draftFramework: { id: string };
  let facetA: { id: string };
  let facetB: { id: string };
  let unitX: { id: string };
  let unitY: { id: string };
  let controlId: string;
  const systems = {} as Record<"s1" | "s2" | "s3" | "s4" | "s5", string>;
  const extraSystemIds: string[] = [];

  async function makeSystem(name: string, data: Record<string, unknown> = {}) {
    const system = await prisma.system.create({ data: { name: `Test 153 ${name} ${SUFFIX}`, ownerId: users.SYSTEM_OWNER, ...data } });
    return system.id;
  }

  /** Resolves a filter as `role` and returns the response status and (on 200) the matching System ids. */
  async function resolve(query: Record<string, string>, role: UserRole = "INTERNAL_AUDITOR") {
    const response = await resolveFilter(
      requestAs(`/api/internal-audits/system-filter?${new URLSearchParams(query)}`, users[role], "GET") as never,
    );
    const body = await response.json();
    return { status: response.status, body, ids: (body.systems ?? []).map((system: { id: string }) => system.id) as string[] };
  }

  const futureDate = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (
        await prisma.user.create({ data: { email: `test-153-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 153 ${role}`, role } })
      ).id;
    }
    framework = await createFixtureFramework("153");
    draftFramework = await prisma.framework.create({
      data: { name: `Test 153 Draft Framework ${SUFFIX}`, version: "1", status: "DRAFT" },
    });
    facetA = await prisma.deploymentFacet.create({ data: { name: `Test 153 Facet A ${SUFFIX}` } });
    facetB = await prisma.deploymentFacet.create({ data: { name: `Test 153 Facet B ${SUFFIX}` } });
    unitX = await prisma.businessUnit.create({ data: { name: `Test 153 Unit X ${SUFFIX}` } });
    unitY = await prisma.businessUnit.create({ data: { name: `Test 153 Unit Y ${SUFFIX}` } });
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-153-${SUFFIX}`, title: "Test 153 Control", description: "d", category: "Security", applicability: "PER_SYSTEM" },
      })
    ).id;

    systems.s1 = await makeSystem("S1", {
      status: "ONBOARDED",
      deploymentFacets: { connect: [{ id: facetA.id }] },
      businessUnits: { connect: [{ id: unitX.id }] },
      frameworkScopes: { connect: [{ id: framework.id }] },
    });
    systems.s2 = await makeSystem("S2", {
      status: "ONBOARDED",
      deploymentFacets: { connect: [{ id: facetA.id }] },
      businessUnits: { connect: [{ id: unitY.id }] },
    });
    systems.s3 = await makeSystem("S3", {
      status: "IN_REVIEW",
      deploymentFacets: { connect: [{ id: facetB.id }] },
      businessUnits: { connect: [{ id: unitX.id }] },
      frameworkScopes: { connect: [{ id: framework.id }] },
    });
    // Declared nothing at all.
    systems.s4 = await makeSystem("S4");
    // Declared a Draft Framework (inert), and Facet A.
    systems.s5 = await makeSystem("S5", {
      deploymentFacets: { connect: [{ id: facetA.id }] },
      frameworkScopes: { connect: [{ id: draftFramework.id }] },
    });
  });

  afterAll(async () => {
    await prisma.internalAudit.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.framework.deleteMany({ where: { id: draftFramework.id } });
    await prisma.deploymentFacet.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.businessUnit.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("the filter", () => {
    it("by Framework Scope alone: the Systems that declared it", async () => {
      const { status, ids } = await resolve({ frameworkId: framework.id });
      expect(status).toBe(200);
      expect(ids.sort()).toEqual([systems.s1, systems.s3].sort());
    });

    it("by the base Framework alone: every System, including one that declared nothing", async () => {
      const base = await getBaseFramework();
      const { ids } = await resolve({ frameworkId: base.id });
      for (const id of Object.values(systems)) expect(ids).toContain(id);
    });

    it("by Deployment Facet alone", async () => {
      const { ids } = await resolve({ deploymentFacetId: facetA.id });
      expect(ids.sort()).toEqual([systems.s1, systems.s2, systems.s5].sort());
    });

    it("by Business Unit alone", async () => {
      const { ids } = await resolve({ businessUnitId: unitX.id });
      expect(ids.sort()).toEqual([systems.s1, systems.s3].sort());
    });

    it("by onboarding status alone", async () => {
      const { ids } = await resolve({ status: "IN_REVIEW" });
      expect(ids).toContain(systems.s3);
      for (const id of [systems.s1, systems.s2, systems.s4, systems.s5]) expect(ids).not.toContain(id);
    });

    it("combines all four with AND", async () => {
      const { ids } = await resolve({ frameworkId: framework.id, deploymentFacetId: facetA.id, businessUnitId: unitX.id, status: "ONBOARDED" });
      expect(ids).toEqual([systems.s1]);
    });

    it("combines the base Framework with another criterion", async () => {
      const base = await getBaseFramework();
      const { ids } = await resolve({ frameworkId: base.id, deploymentFacetId: facetB.id });
      expect(ids).toEqual([systems.s3]);
    });

    it("gives an empty list when nothing matches", async () => {
      const { status, ids } = await resolve({ deploymentFacetId: facetB.id, businessUnitId: unitY.id });
      expect(status).toBe(200);
      expect(ids).toEqual([]);
    });

    it("with nothing set matches every System", async () => {
      const { ids } = await resolve({});
      for (const id of Object.values(systems)) expect(ids).toContain(id);
    });

    it("treats a blank criterion as not set", async () => {
      const { ids } = await resolve({ frameworkId: "", deploymentFacetId: facetB.id, businessUnitId: "", status: "" });
      expect(ids).toEqual([systems.s3]);
    });

    it("names the System's status, Facets and Business Units for the preview", async () => {
      const { body } = await resolve({ businessUnitId: unitX.id, deploymentFacetId: facetA.id });
      expect(body.systems).toEqual([
        {
          id: systems.s1,
          name: `Test 153 S1 ${SUFFIX}`,
          vendor: null,
          status: "ONBOARDED",
          deploymentFacets: [`Test 153 Facet A ${SUFFIX}`],
          businessUnits: [`Test 153 Unit X ${SUFFIX}`],
        },
      ]);
    });

    it("matches nothing for a Facet or Business Unit that doesn't exist", async () => {
      expect((await resolve({ deploymentFacetId: "nope" })).ids).toEqual([]);
      expect((await resolve({ businessUnitId: "nope" })).ids).toEqual([]);
    });

    it("refuses an onboarding status that doesn't exist", async () => {
      expect((await resolve({ status: "FINISHED" })).status).toBe(400);
    });
  });

  describe("Draft Frameworks", () => {
    it("are not offered as a filter option", async () => {
      const options = await listSystemFilterOptions();
      expect(options.frameworks.map((f) => f.id)).toContain(framework.id);
      expect(options.frameworks.map((f) => f.id)).not.toContain(draftFramework.id);
    });

    it("are refused as a filter, exactly like a Framework that doesn't exist", async () => {
      const draft = await resolve({ frameworkId: draftFramework.id });
      const missing = await resolve({ frameworkId: "no-such-framework" });
      expect(draft.status).toBe(400);
      expect(draft.body).toEqual(missing.body);
      expect(JSON.stringify(draft.body)).not.toContain("Draft Framework");
    });
  });

  describe("who may use it", () => {
    it.each(NOT_WRITING)("%s gets 403", async (role) => {
      const { status, body } = await resolve({ deploymentFacetId: facetA.id }, role);
      expect(status).toBe(403);
      expect(body.systems).toBeUndefined();
    });

    it("answers 401 with no acting user", async () => {
      const response = await resolveFilter(requestAs("/api/internal-audits/system-filter", null, "GET") as never);
      expect(response.status).toBe(401);
    });
  });

  describe("what an audit keeps", () => {
    async function draft(systemIds: string[]) {
      return createInternalAudit(
        { title: `Test 153 Audit ${SUFFIX}`, dueDate: futureDate(), controlIds: [controlId], systemIds },
        users.INTERNAL_AUDITOR,
      );
    }

    it("is the resolved Systems, not the filter: a System created afterwards isn't in it", async () => {
      const filter = { frameworkId: framework.id };
      const { ids } = await resolve(filter);
      const auditId = await draft(ids);

      const later = await makeSystem("Later", { frameworkScopes: { connect: [{ id: framework.id }] } });
      extraSystemIds.push(later);
      expect((await resolve(filter)).ids).toContain(later);

      const audit = await getInternalAudit(auditId);
      expect(audit!.systems.map((system) => system.id).sort()).toEqual([systems.s1, systems.s3].sort());
    });

    it("adding the matching Systems on top of picked ones, as the form does, saves each once", async () => {
      const auditId = await draft([systems.s1, systems.s4]);
      const { ids } = await resolve({ deploymentFacetId: facetA.id });
      const merged = [...new Set([systems.s1, systems.s4, ...ids])];

      const response = await patchAudit(
        requestAs(`/api/internal-audits/${auditId}`, users.INTERNAL_AUDITOR, "PATCH", { systemIds: merged }) as never,
        ctx(auditId),
      );
      expect(response.status).toBe(200);
      const audit = await getInternalAudit(auditId);
      expect(audit!.systems.map((system) => system.id).sort()).toEqual([systems.s1, systems.s2, systems.s4, systems.s5].sort());
    });

    it("can't be changed once the audit is launched: 409, nothing saved", async () => {
      const auditId = await draft([systems.s1]);
      await prisma.internalAudit.update({ where: { id: auditId }, data: { status: "LAUNCHED" } });
      const { ids } = await resolve({ deploymentFacetId: facetA.id });

      const response = await patchAudit(
        requestAs(`/api/internal-audits/${auditId}`, users.INTERNAL_AUDITOR, "PATCH", { systemIds: ids }) as never,
        ctx(auditId),
      );
      expect(response.status).toBe(409);
      expect((await getInternalAudit(auditId))!.systems.map((system) => system.id)).toEqual([systems.s1]);
    });
  });
});
