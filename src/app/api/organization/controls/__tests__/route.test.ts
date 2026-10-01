import { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

/**
 * Reading the Organization's Controls with their implementations (#120): every signed-in role,
 * Organizational and Both Controls only, a missing row reads as Not Started. Fixtures only;
 * the assertions look at this file's own Controls, because other files create Controls too.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];

function get(userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return GET(new NextRequest("http://localhost/api/organization/controls", { headers }));
}

describe("GET /api/organization/controls (#120)", () => {
  const userIds: Record<string, string> = {};
  const controlIds: string[] = [];
  let orgWithRow: string;
  let orgWithoutRow: string;
  let both: string;
  let perSystem: string;
  let editorId: string;
  let facetId: string;

  const make = async (applicability: "ORGANIZATIONAL" | "BOTH" | "PER_SYSTEM", key: string) => {
    const control = await prisma.control.create({
      data: {
        code: `TEST-OCI-GET-${SUFFIX}-${key}`,
        title: `Test OCI read ${key}`,
        description: "d",
        category: "Test",
        applicability,
        // Scoped to a fixture Facet no System has, so a BOTH / PER_SYSTEM fixture cannot leak into other files' Systems.
        ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?", deploymentFacets: { connect: { id: facetId } } }),
      },
    });
    controlIds.push(control.id);
    return control.id;
  };

  beforeAll(async () => {
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test OCI Get Facet ${SUFFIX}` } })).id;
    for (const role of ROLES) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-oci-get-${role}-${SUFFIX}@example.com`, name: `Test OCI Get ${role}`, role } })
      ).id;
    }
    editorId = userIds.ADMIN;
    orgWithRow = await make("ORGANIZATIONAL", "a-org-row");
    orgWithoutRow = await make("ORGANIZATIONAL", "b-org-norow");
    both = await make("BOTH", "c-both");
    perSystem = await make("PER_SYSTEM", "d-persystem");
    await prisma.control.update({ where: { id: orgWithRow }, data: { ownerId: userIds.VIEWER } });
    await prisma.organizationControlImplementation.create({
      data: { controlId: orgWithRow, status: "IN_PROGRESS", description: "Drafting", updatedById: editorId },
    });
    await prisma.organizationControlImplementation.create({ data: { controlId: both } });
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  const own = async (userId: string) => {
    const response = await get(userId);
    expect(response.status).toBe(200);
    const body = await response.json();
    return (body.controls as { id: string }[]).filter((c) => controlIds.includes(c.id));
  };

  it.each(ROLES)("lets a %s read it", async (role) => {
    const rows = await own(userIds[role]);
    expect(rows.map((r) => r.id)).toEqual([orgWithRow, orgWithoutRow, both]);
  });

  it("refuses an unauthenticated request (401)", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("lists Organizational and Both Controls and never a Per-System one", async () => {
    const ids = (await own(userIds.VIEWER)).map((r) => r.id);
    expect(ids).toContain(orgWithRow);
    expect(ids).toContain(both);
    expect(ids).not.toContain(perSystem);
  });

  it("returns code, title, applicability, the Control Owner and the implementation", async () => {
    const rows = (await own(userIds.VIEWER)) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r.id === orgWithRow)!;
    expect(row).toMatchObject({
      code: `TEST-OCI-GET-${SUFFIX}-a-org-row`,
      title: "Test OCI read a-org-row",
      applicability: "ORGANIZATIONAL",
      owner: { id: userIds.VIEWER, name: "Test OCI Get VIEWER" },
      implementation: {
        status: "IN_PROGRESS",
        description: "Drafting",
        updatedBy: { id: editorId, name: "Test OCI Get ADMIN" },
      },
    });
    expect(typeof (row.implementation as { updatedAt: unknown }).updatedAt).toBe("string");
    // Names only: no email leaves the API.
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("reads a Control with no implementation row as Not Started, and an unowned Control with owner null", async () => {
    const rows = (await own(userIds.VIEWER)) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r.id === orgWithoutRow)!;
    expect(row.owner).toBeNull();
    expect(row.implementation).toEqual({ status: "NOT_STARTED", description: null, updatedBy: null, updatedAt: null });
    // Reading creates nothing.
    expect(await prisma.organizationControlImplementation.count({ where: { controlId: orgWithoutRow } })).toBe(0);
  });

  it("reads a Both Control's migrated-style row (Not Started, no editor) the same way", async () => {
    const rows = (await own(userIds.VIEWER)) as unknown as Record<string, unknown>[];
    const row = rows.find((r) => r.id === both)!;
    expect(row.implementation).toMatchObject({ status: "NOT_STARTED", description: null, updatedBy: null });
  });
});
