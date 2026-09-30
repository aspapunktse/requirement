import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as patchSystem } from "../systems/[id]/route";
import { POST as declareCapability } from "../systems/[id]/capabilities/route";
import { DELETE as removeCapability } from "../systems/[id]/capabilities/[capabilityId]/route";
import { POST as declareBusinessUnit } from "../systems/[id]/business-units/route";
import { DELETE as removeBusinessUnit } from "../systems/[id]/business-units/[businessUnitId]/route";
import { POST as declareFrameworkScope } from "../systems/[id]/framework-scopes/route";
import { DELETE as removeFrameworkScope } from "../systems/[id]/framework-scopes/[frameworkId]/route";
import { POST as logRisk } from "../systems/[id]/risks/route";
import { POST as onboard } from "../systems/[id]/onboard/route";

/**
 * "The System's owner" is `ownerId` alone, whatever the owner's role (#91):
 * every owner action goes through `isSystemOwnerOrAdmin`, so an owning
 * RISK_OWNER / REVIEWER / VIEWER can do them, a SYSTEM_OWNER who doesn't own
 * the System can't, and a COMPLIANCE_MANAGER is refused even when recorded as
 * the owner (#71). Role grants that aren't about ownership are unchanged: a
 * RISK_OWNER (and ADMIN) may log a Risk on any System.
 *
 * Fixtures are self-contained (the CI test database isn't seeded); nothing
 * here depends on seeded data.
 */

const SUFFIX = Date.now();

function req(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const RISK_BODY = { title: "Test Owner Rule Risk", description: "Something bad", severity: "HIGH", likelihood: "MEDIUM" };

/** Roles that can own a System and then do every owner action on it. */
const OWNING_ROLES: UserRole[] = ["SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER"];

describe("The System's owner is ownerId, whatever the role (#91)", () => {
  const users = {} as Record<string, string>;
  const systemIds: string[] = [];
  let facetA: string;
  let facetB: string;
  let capabilityId: string;
  let businessUnitId: string;
  let frameworkId: string;

  async function makeSystem(ownerKey: string, status: "DRAFT" | "APPROVED" | "ONBOARDED" = "DRAFT") {
    const system = await prisma.system.create({
      data: {
        name: `Test OwnerRule System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[ownerKey],
        status,
        deploymentFacets: { connect: { id: facetA } },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }

  /** Everything about a System an owner action could touch. */
  async function snapshot(systemId: string) {
    const system = await prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: {
        deploymentFacets: true,
        capabilities: true,
        businessUnits: true,
        frameworkScopes: true,
      },
    });
    return {
      status: system.status,
      onboardedAt: system.onboardedAt,
      facets: system.deploymentFacets.map((f) => f.id).sort(),
      capabilities: system.capabilities.map((c) => c.id).sort(),
      businessUnits: system.businessUnits.map((b) => b.id).sort(),
      frameworkScopes: system.frameworkScopes.map((f) => f.id).sort(),
      risks: await prisma.risk.count({ where: { systemId } }),
      assessments: await prisma.controlAssessment.count({ where: { systemId } }),
      changeEvents: await prisma.changeEvent.count({ where: { systemId } }),
    };
  }

  type Action = {
    name: string;
    /** Status when the acting user may do it (a Draft System for `onboard`: permitted, then wrong status). */
    ok: number;
    /** Roles allowed to do it on any System, on top of the owner and ADMIN. */
    grantedTo?: UserRole[];
    run: (systemId: string, userId: string) => Promise<Response>;
  };

  const actions = (): Action[] => [
    {
      name: "change classification",
      ok: 200,
      run: (id, u) =>
        patchSystem(req(`/api/systems/${id}`, "PATCH", u, { deploymentFacetIds: [facetB] }), {
          params: Promise.resolve({ id }),
        }),
    },
    {
      name: "declare a Capability",
      ok: 201,
      run: (id, u) =>
        declareCapability(req(`/api/systems/${id}/capabilities`, "POST", u, { capabilityId }), {
          params: Promise.resolve({ id }),
        }),
    },
    {
      name: "remove a Capability",
      ok: 200,
      run: (id, u) =>
        removeCapability(req(`/api/systems/${id}/capabilities/${capabilityId}`, "DELETE", u), {
          params: Promise.resolve({ id, capabilityId }),
        }),
    },
    {
      name: "declare a Business Unit",
      ok: 201,
      run: (id, u) =>
        declareBusinessUnit(req(`/api/systems/${id}/business-units`, "POST", u, { businessUnitId }), {
          params: Promise.resolve({ id }),
        }),
    },
    {
      name: "remove a Business Unit",
      ok: 200,
      run: (id, u) =>
        removeBusinessUnit(req(`/api/systems/${id}/business-units/${businessUnitId}`, "DELETE", u), {
          params: Promise.resolve({ id, businessUnitId }),
        }),
    },
    {
      name: "declare a Framework Scope",
      ok: 201,
      run: (id, u) =>
        declareFrameworkScope(req(`/api/systems/${id}/framework-scopes`, "POST", u, { frameworkId }), {
          params: Promise.resolve({ id }),
        }),
    },
    {
      name: "remove a Framework Scope",
      ok: 200,
      run: (id, u) =>
        removeFrameworkScope(req(`/api/systems/${id}/framework-scopes/${frameworkId}`, "DELETE", u), {
          params: Promise.resolve({ id, frameworkId }),
        }),
    },
    {
      name: "log a Risk",
      ok: 201,
      grantedTo: ["RISK_OWNER"],
      run: (id, u) => logRisk(req(`/api/systems/${id}/risks`, "POST", u, RISK_BODY), { params: Promise.resolve({ id }) }),
    },
    {
      // Permitted on a Draft System means "wrong status" (400), not "wrong person" (403).
      name: "mark Onboarded",
      ok: 400,
      run: (id, u) => onboard(req(`/api/systems/${id}/onboard`, "POST", u), { params: Promise.resolve({ id }) }),
    },
  ];

  /** The owner sequence: every action succeeds in order, then Onboarding once Approved. */
  async function expectAllOwnerActionsAllowed(systemId: string, userKey: string) {
    for (const action of actions()) {
      const response = await action.run(systemId, users[userKey]);
      expect(response.status, `${userKey}: ${action.name}`).toBe(action.ok);
    }
    await prisma.system.update({ where: { id: systemId }, data: { status: "APPROVED" } });
    const onboarded = await onboard(req(`/api/systems/${systemId}/onboard`, "POST", users[userKey]), {
      params: Promise.resolve({ id: systemId }),
    });
    expect(onboarded.status, `${userKey}: mark Onboarded once Approved`).toBe(200);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status).toBe("ONBOARDED");
  }

  /** Every action is refused with `status` (Risk logging excepted for `grantedTo` roles) and changes nothing. */
  async function expectAllRefused(systemId: string, userKey: string, role: UserRole, status: number) {
    for (const action of actions()) {
      const before = await snapshot(systemId);
      const response = await action.run(systemId, users[userKey]);
      if (action.grantedTo?.includes(role) && status === 403) {
        expect(response.status, `${userKey}: ${action.name} (role grant)`).toBe(action.ok);
        continue;
      }
      expect(response.status, `${userKey}: ${action.name}`).toBe(status);
      expect(await snapshot(systemId), `${userKey}: ${action.name} changed something`).toEqual(before);
    }
  }

  beforeAll(async () => {
    const roles: [string, UserRole][] = [
      ["SYSTEM_OWNER", "SYSTEM_OWNER"],
      ["RISK_OWNER", "RISK_OWNER"],
      ["REVIEWER", "REVIEWER"],
      ["VIEWER", "VIEWER"],
      ["BUSINESS_RISK_OWNER", "BUSINESS_RISK_OWNER"],
      ["COMPLIANCE_MANAGER", "COMPLIANCE_MANAGER"],
      ["ADMIN", "ADMIN"],
      ["otherSystemOwner", "SYSTEM_OWNER"],
    ];
    for (const [key, role] of roles) {
      const user = await prisma.user.create({
        data: { email: `test-owner-rule-${key}-${SUFFIX}@example.com`, name: `Test OwnerRule ${key}`, role },
      });
      users[key] = user.id;
    }
    facetA = (await prisma.deploymentFacet.create({ data: { name: `Test OwnerRule Facet A ${SUFFIX}` } })).id;
    facetB = (await prisma.deploymentFacet.create({ data: { name: `Test OwnerRule Facet B ${SUFFIX}` } })).id;
    capabilityId = (await prisma.capability.create({ data: { name: `Test OwnerRule Capability ${SUFFIX}` } })).id;
    businessUnitId = (await prisma.businessUnit.create({ data: { name: `Test OwnerRule BU ${SUFFIX}` } })).id;
    frameworkId = (
      await prisma.framework.create({
        data: { name: `Test OwnerRule Framework ${SUFFIX}`, version: "1", status: "PUBLISHED" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.framework.deleteMany({ where: { id: frameworkId } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetA, facetB] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  it.each(OWNING_ROLES)(
    "lets an owning %s do every owner action: classification, capabilities, business units, framework scope, log a Risk, onboard",
    async (role) => {
      const systemId = await makeSystem(role);
      await expectAllOwnerActionsAllowed(systemId, role);
    },
  );

  it("lets an ADMIN do every owner action on a System someone else owns", async () => {
    const systemId = await makeSystem("otherSystemOwner");
    await expectAllOwnerActionsAllowed(systemId, "ADMIN");
  });

  it.each(["REVIEWER", "RISK_OWNER", "COMPLIANCE_MANAGER"] as const)(
    "refuses a %s who doesn't own a Draft System they can see (a RISK_OWNER may still log a Risk on any System)",
    async (role) => {
      const systemId = await makeSystem("otherSystemOwner");
      await expectAllRefused(systemId, role, role, 403);
    },
  );

  it("refuses a SYSTEM_OWNER who doesn't own the System: 403 when they can see it, 404 (invisible Draft) otherwise", async () => {
    const onboarded = await makeSystem("SYSTEM_OWNER", "ONBOARDED");
    await expectAllRefused(onboarded, "otherSystemOwner", "SYSTEM_OWNER", 403);
    const draft = await makeSystem("SYSTEM_OWNER", "DRAFT");
    await expectAllRefused(draft, "otherSystemOwner", "SYSTEM_OWNER", 404);
  });

  it("refuses a VIEWER who doesn't own the System, and one who can't even see it", async () => {
    const onboarded = await makeSystem("SYSTEM_OWNER", "ONBOARDED");
    await expectAllRefused(onboarded, "VIEWER", "VIEWER", 403);
    const draft = await makeSystem("SYSTEM_OWNER", "DRAFT");
    await expectAllRefused(draft, "VIEWER", "VIEWER", 404);
  });

  it("refuses a COMPLIANCE_MANAGER even when recorded as the System's owner (read-only, #71)", async () => {
    const draft = await makeSystem("COMPLIANCE_MANAGER", "DRAFT");
    await expectAllRefused(draft, "COMPLIANCE_MANAGER", "COMPLIANCE_MANAGER", 403);
    const approved = await makeSystem("COMPLIANCE_MANAGER", "APPROVED");
    await expectAllRefused(approved, "COMPLIANCE_MANAGER", "COMPLIANCE_MANAGER", 403);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: approved } })).status).toBe("APPROVED");
  });

  it.each(["APPROVED", "ONBOARDED"] as const)(
    "lets the owner and an ADMIN change classification, Capabilities and Framework Scope on a %s System, leaving its status alone (no Draft lock, ADR 0006 / #86)",
    async (status) => {
      const classificationActions = actions().filter((a) =>
        /classification|Capability|Framework Scope/.test(a.name),
      );
      expect(classificationActions).toHaveLength(5);
      for (const userKey of ["SYSTEM_OWNER", "ADMIN"]) {
        const systemId = await makeSystem("SYSTEM_OWNER", status);
        if (status === "ONBOARDED") {
          await prisma.system.update({ where: { id: systemId }, data: { onboardedAt: new Date() } });
        }
        const before = await snapshot(systemId);
        for (const action of classificationActions) {
          const response = await action.run(systemId, users[userKey]);
          expect(response.status, `${userKey}: ${action.name} on a ${status} System`).toBe(action.ok);
        }
        const after = await snapshot(systemId);
        expect(after.status, `${userKey}: status`).toBe(status);
        expect(after.onboardedAt, `${userKey}: onboardedAt`).toEqual(before.onboardedAt);
      }
    },
  );

  it("keeps the 400 for onboarding a System that isn't Approved, once the owner is allowed", async () => {
    const systemId = await makeSystem("REVIEWER", "DRAFT");
    const response = await onboard(req(`/api/systems/${systemId}/onboard`, "POST", users.REVIEWER), {
      params: Promise.resolve({ id: systemId }),
    });
    expect(response.status).toBe(400);
    expect((await snapshot(systemId)).status).toBe("DRAFT");
  });
});
