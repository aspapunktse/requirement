import { NextRequest } from "next/server";
import { afterAll, beforeAll } from "vitest";
import type { ControlAssessmentStatus, ControlOfferingType, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { PATCH as patchSystem } from "@/app/api/systems/[id]/route";

/**
 * Fixtures for the Provider / Control Offering tests (#123), self-contained so
 * they pass on CI's migrated-but-unseeded database. Call `setupProviderFixtures`
 * inside a `describe`: it registers its own `beforeAll`/`afterAll`, and the
 * returned object is filled in by then.
 *
 * - Users: one per role, a second System Owner, and owners recorded with a role
 *   that doesn't normally own Systems (Risk Owner, Viewer, Reviewer, and a
 *   Compliance Manager, who is read-only even as the recorded owner).
 * - Controls are scoped to fixture Deployment Facets and mapped to a fixture
 *   Published Framework that only the fixture Systems declare, so nothing here
 *   applies to a seeded or other test file's System. `perSystem`, `both` and
 *   `stale` (scoped to a Facet a Provider can drop) apply to a Provider that
 *   declares the right Facet; `elsewhere` (a third Facet nobody declares) and
 *   `organizational` never do.
 * - Systems are Onboarded unless a test says otherwise, so every role can see them.
 */

function createContext() {
  return {
    suffix: `${process.pid}-${Date.now()}`,
    users: {} as Record<
      | "owner"
      | "otherOwner"
      | "reviewer"
      | "riskOwner"
      | "complianceManager"
      | "viewer"
      | "businessRiskOwner"
      | "admin"
      | "riskOwnerOwner"
      | "viewerOwner"
      | "reviewerOwner"
      | "complianceManagerOwner",
      string
    >,
    facets: {} as Record<"live" | "stale" | "elsewhere", string>,
    controls: {} as Record<"perSystem" | "both" | "stale" | "elsewhere" | "organizational", { id: string; code: string; title: string }>,
    frameworkId: "",
    systemIds: [] as string[],
  };
}

const USER_ROLES: Record<keyof ReturnType<typeof createContext>["users"], UserRole> = {
  owner: "SYSTEM_OWNER",
  otherOwner: "SYSTEM_OWNER",
  reviewer: "REVIEWER",
  riskOwner: "RISK_OWNER",
  complianceManager: "COMPLIANCE_MANAGER",
  viewer: "VIEWER",
  businessRiskOwner: "BUSINESS_RISK_OWNER",
  admin: "ADMIN",
  riskOwnerOwner: "RISK_OWNER",
  viewerOwner: "VIEWER",
  reviewerOwner: "REVIEWER",
  complianceManagerOwner: "COMPLIANCE_MANAGER",
};

export function setupProviderFixtures(label: string) {
  const ctx = createContext();

  beforeAll(async () => {
    for (const [key, role] of Object.entries(USER_ROLES)) {
      ctx.users[key as keyof typeof ctx.users] = (
        await prisma.user.create({
          data: { email: `test-${label}-${key}-${ctx.suffix}@example.com`, name: `Test ${label} ${key}`, role },
        })
      ).id;
    }
    for (const key of ["live", "stale", "elsewhere"] as const) {
      ctx.facets[key] = (await prisma.deploymentFacet.create({ data: { name: `Test ${label} Facet ${key} ${ctx.suffix}` } })).id;
    }

    const makeControl = async (
      key: keyof typeof ctx.controls,
      applicability: "BOTH" | "PER_SYSTEM" | "ORGANIZATIONAL",
      facetId: string | null,
    ) => {
      const created = await prisma.control.create({
        data: {
          code: `TEST-${label}-${key}-${ctx.suffix}`,
          title: `Test ${label} ${key}`,
          description: "d",
          category: "Test",
          applicability,
          mandatory: true,
          question: applicability === "ORGANIZATIONAL" ? null : "Does it?",
          ...(facetId && { deploymentFacets: { connect: { id: facetId } } }),
        },
      });
      ctx.controls[key] = { id: created.id, code: created.code, title: created.title };
    };
    await makeControl("perSystem", "PER_SYSTEM", ctx.facets.live);
    await makeControl("both", "BOTH", ctx.facets.live);
    await makeControl("stale", "PER_SYSTEM", ctx.facets.stale);
    await makeControl("elsewhere", "PER_SYSTEM", ctx.facets.elsewhere);
    await makeControl("organizational", "ORGANIZATIONAL", null);

    ctx.frameworkId = (await createFixtureFramework(label)).id;
    await mapControlsToFramework(ctx.frameworkId, Object.values(ctx.controls).map((control) => control.id));
  });

  afterAll(async () => {
    // Offerings, Assessments and Change Events cascade with the System.
    await prisma.system.deleteMany({ where: { id: { in: ctx.systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: Object.values(ctx.controls).map((control) => control.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: Object.values(ctx.facets) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ctx.users) } } });
  });

  /**
   * A System in the fixture Framework's scope declaring `facets` (default: the live
   * and the stale Facet, so `perSystem`, `both` and `stale` all apply).
   */
  async function makeSystem(
    options: {
      ownerId?: string;
      status?: "ONBOARDED" | "DRAFT";
      isProvider?: boolean;
      facets?: string[];
    } = {},
  ) {
    const system = await prisma.system.create({
      data: {
        name: `Test ${label} System ${ctx.suffix}-${ctx.systemIds.length}`,
        ownerId: options.ownerId ?? ctx.users.owner,
        status: options.status ?? "ONBOARDED",
        isProvider: options.isProvider ?? false,
        deploymentFacets: { connect: (options.facets ?? [ctx.facets.live, ctx.facets.stale]).map((id) => ({ id })) },
        frameworkScopes: { connect: [{ id: ctx.frameworkId }] },
      },
    });
    ctx.systemIds.push(system.id);
    return system.id;
  }

  /** Sets the System's own Assessment of a Control (a person set it unless `assessedById` is null). */
  async function assess(systemId: string, controlId: string, status: ControlAssessmentStatus, assessedById: string | null = ctx.users.owner) {
    return prisma.controlAssessment.upsert({
      where: { systemId_controlId: { systemId, controlId } },
      create: { systemId, controlId, status, assessedById },
      update: { status, assessedById },
    });
  }

  /** An Offering written straight to the DB (the routes are what the tests exercise elsewhere). */
  function offer(providerId: string, controlId: string, type: ControlOfferingType = "FULL", customerResponsibility: string | null = null) {
    return prisma.controlOffering.create({ data: { providerId, controlId, type, customerResponsibility } });
  }

  // Assigned onto the context object, not spread, so `frameworkId` (set in beforeAll) stays current.
  return Object.assign(ctx, { makeSystem, assess, offer });
}

/** A request acting as `userId` (null = nobody signed in). */
export function requestAs(url: string, userId: string | null, method: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** PATCH /api/systems/[id] as `userId`: changes the declared Facets and so recomputes the System's applicable Controls. */
export async function patchSystemClassification(systemId: string, userId: string, body: { deploymentFacetIds: string[] }) {
  const response = await patchSystem(requestAs(`/api/systems/${systemId}`, userId, "PATCH", body), {
    params: Promise.resolve({ id: systemId }),
  });
  if (response.status !== 200) throw new Error(`classification change failed: ${response.status}`);
}
