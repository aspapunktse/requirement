import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { parseCsv } from "@/test/csv-parse";
import { GET } from "../[id]/statement/export/route";

/**
 * GET /api/compliance-boundaries/[id]/statement/export (#421), against real Postgres. Fixtures only (`Test #421 ...`): two non-base
 * Frameworks with an included and an excluded Requirement (one with a formula-like title and a justification that needs escaping),
 * a Boundary with a counted System and a not-yet-operating one, and a retired Boundary.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #421 export ${label} ${suffix}`;

function get(userId: string | null, boundaryId: string, framework?: string) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  const query = framework === undefined ? "" : `?framework=${encodeURIComponent(framework)}`;
  return GET(new NextRequest(`http://localhost/api/compliance-boundaries/${boundaryId}/statement/export${query}`, { method: "GET", headers }), {
    params: Promise.resolve({ id: boundaryId }),
  });
}

// `Response.text()` decodes UTF-8 and drops the byte-order mark, so the BOM is checked on the bytes.
const read = async (response: Response) => parseCsv(await response.text());

describe("GET statement export (#421)", { timeout: 90_000 }, () => {
  const users: Record<string, string> = {};
  const facets: string[] = [];
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];
  let fwA: string;
  let fwB: string;
  let fwOther: string;
  let boundary: string;
  let retired: string;
  let emptyBoundary: string;
  let excludedA: string;

  beforeAll(async () => {
    const roles: Record<string, UserRole> = { admin: "ADMIN", cm: "COMPLIANCE_MANAGER", viewer: "VIEWER", auditor: "INTERNAL_AUDITOR", owner: "SYSTEM_OWNER", other: "SYSTEM_OWNER" };
    for (const [key, role] of Object.entries(roles)) {
      users[key] = (await prisma.user.create({ data: { email: `test-421-export-${key}-${suffix}@example.com`, name: N(key), role } })).id;
    }
    for (const label of ["in", "out"]) facets.push((await prisma.deploymentFacet.create({ data: { name: N(`Facet ${label}`) } })).id);
    fwA = (await createFixtureFramework("421 export A")).id;
    fwB = (await createFixtureFramework("421 export B")).id;
    fwOther = (await createFixtureFramework("421 export other")).id;
    const make = async (code: string, facet: string) => {
      const control = await prisma.control.create({ data: { code: `T421E-${code}-${suffix}`, title: N(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facet }] } } });
      controlIds.push(control.id);
      return control.id;
    };
    await mapControlsToFramework(fwA, [await make("A-IN", facets[0])]);
    excludedA = await mapControlsToFramework(fwA, [await make("A-OUT", facets[1])]);
    await mapControlsToFramework(fwB, [await make("B-IN", facets[0])]);
    await mapControlsToFramework(fwOther, [await make("OTHER", facets[0])]);
    await prisma.requirement.update({ where: { id: excludedA }, data: { title: '=HYPERLINK("http://x","click"), "quoted"' } });

    const counted = await prisma.system.create({ data: { name: N("Counted"), ownerId: users.other, status: "ONBOARDED", deploymentFacets: { connect: [{ id: facets[0] }] } } });
    const pending = await prisma.system.create({ data: { name: N("Pending"), ownerId: users.other, status: "DRAFT", deploymentFacets: { connect: [{ id: facets[0] }] } } });
    // Counted through an ATO, but not Onboarded: only its owner and the full-visibility roles may see it (ADR 0004).
    const approved = await prisma.system.create({ data: { name: N("Hidden"), ownerId: users.other, status: "APPROVED", deploymentFacets: { connect: [{ id: facets[0] }] } } });
    systemIds.push(counted.id, pending.id, approved.id);
    const created = async (name: string, data: object) => (await prisma.complianceBoundary.create({ data: { name, boundaryOwnerId: users.owner, ...data } })).id;
    boundary = await created(N("Boundary ÅÄÖ"), { frameworks: { create: [{ frameworkId: fwA }, { frameworkId: fwB }] }, systems: { create: [{ systemId: counted.id }, { systemId: pending.id }, { systemId: approved.id }] } });
    retired = await created(N("Retired"), { retiredAt: new Date(), frameworks: { create: [{ frameworkId: fwA }] } });
    emptyBoundary = await created(N("Empty"), { frameworks: { create: [{ frameworkId: fwA }] } });
    boundaryIds.push(boundary, retired, emptyBoundary);
    await prisma.boundaryExclusionJustification.create({ data: { boundaryId: boundary, requirementId: excludedA, text: 'Out of scope, "really"\n=2+2', updatedById: users.cm } });
  }, 60_000);

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facets } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  }, 60_000);

  const dataRows = (rows: string[][]) => rows.slice(rows.findIndex((row) => row[0] === "Framework") + 1);

  it("exports the whole statement: the Boundary's facts, then a row per Requirement of every Framework", async () => {
    const response = await get(users.admin, boundary);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const rows = await read(response);
    expect(rows[0]).toEqual(["Compliance Boundary", N("Boundary ÅÄÖ")]);
    const fact = (label: string) => rows.find((row) => row[0] === label)?.[1];
    expect(fact("Boundary Owner")).toBe(N("owner"));
    expect(fact("Export")).toBe("Whole statement");
    expect(fact("Frameworks")).toContain("Test 421 export A Framework");
    expect(fact("Frameworks")).toContain("Test 421 export B Framework");
    expect(fact("Frameworks")).not.toContain("other");
    expect(fact("Counted Systems")).toBe(`2: ${N("Counted")}; ${N("Hidden")}`);
    expect(fact("Not yet operating, not counted")).toBe(N("Pending"));
    expect(fact("Exported")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows.find((row) => row[0] === "Framework")).toEqual(["Framework", "Requirement code", "Requirement title", "In the statement", "Exclusion justification", "Worst status", "Met on", N("Counted"), N("Hidden")]);
    const data = dataRows(rows);
    expect(data).toHaveLength(3);
    expect(data.map((row) => row[3]).sort()).toEqual(["Excluded", "Included", "Included"]);
    const included = data.find((row) => row[3] === "Included" && row[0].includes("export A"))!;
    expect(included.slice(4)).toEqual(["", "Not met", "Met on 0 of 2 Systems", "Not met", "Not met"]);
    // The excluded Requirement applies to no System, so that System's cell says so.
    expect(data.find((row) => row[3] === "Excluded")!.slice(7)).toEqual(["Not applicable", "Not applicable"]);
    expect(fact("Systems not shown (no access)")).toBeUndefined();
  });

  it("exports one Framework's section with ?framework=", async () => {
    const response = await get(users.admin, boundary, fwA);
    expect(response.status).toBe(200);
    const rows = await read(response);
    const data = dataRows(rows);
    expect(data).toHaveLength(2);
    expect(data.every((row) => row[0].includes("export A"))).toBe(true);
    expect(rows.find((row) => row[0] === "Export")?.[1]).toMatch(/^Section: .*export A/);
    expect(rows.find((row) => row[0] === "Frameworks")?.[1]).not.toContain("export B");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="statement-Test-421-export-Boundary-[\w.-]+-Test-421-export-A-Framework-[\w.-]+-\d{4}-\d{2}-\d{2}\.csv"$/);
  });

  it("names the file after the Boundary and the date for the whole statement", async () => {
    const disposition = (await get(users.admin, boundary)).headers.get("content-disposition");
    expect(disposition).toMatch(/^attachment; filename="statement-Test-421-export-Boundary-[\w.-]+-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(disposition).not.toContain("Framework");
  });

  it("escapes quotes and line breaks, neutralises a formula in a title and in a justification, and keeps å, ä, ö", async () => {
    const response = await get(users.admin, boundary, fwA);
    const text = await response.clone().text();
    expect([...new Uint8Array(await response.clone().arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const excluded = dataRows(await read(response)).find((row) => row[3] === "Excluded")!;
    expect(excluded[2]).toBe(`'=HYPERLINK("http://x","click"), "quoted"`);
    expect(excluded[4]).toBe('Out of scope, "really"\n=2+2');
    expect(text).toContain('""really""');
    const header = (await read(await get(users.admin, boundary)))[0];
    expect(header[1]).toContain("ÅÄÖ");
  });

  it("leaves the justification empty for an excluded Requirement without one", async () => {
    await prisma.boundaryExclusionJustification.deleteMany({ where: { boundaryId: boundary } });
    try {
      const excluded = dataRows(await read(await get(users.admin, boundary, fwA))).find((row) => row[3] === "Excluded")!;
      expect(excluded[4]).toBe("");
    } finally {
      await prisma.boundaryExclusionJustification.create({ data: { boundaryId: boundary, requirementId: excludedA, text: 'Out of scope, "really"\n=2+2', updatedById: users.cm } });
    }
  });

  it("is readable by every signed-in role, with the same counted Systems in the header", async () => {
    const expected = (await read(await get(users.admin, boundary))).find((row) => row[0] === "Counted Systems");
    for (const key of Object.keys(users)) {
      const response = await get(users[key], boundary);
      expect(response.status, key).toBe(200);
      const rows = await read(response);
      expect(rows.find((row) => row[0] === "Counted Systems"), key).toEqual(expected);
      expect(dataRows(rows), key).toHaveLength(3);
    }
  });

  it("lists a System's status only for a reader who may see it: a Viewer gets no column for an Approved System it can't see, its name only in the facts", async () => {
    const rows = await read(await get(users.viewer, boundary));
    expect(rows.find((row) => row[0] === "Counted Systems")?.[1]).toBe(`2: ${N("Counted")}; ${N("Hidden")}`);
    expect(rows.find((row) => row[0] === "Systems not shown (no access)")?.[1]).toBe("1");
    const header = rows.find((row) => row[0] === "Framework")!;
    expect(header.slice(7)).toEqual([N("Counted")]);
    for (const row of dataRows(rows)) expect(row).toHaveLength(8);
    expect(dataRows(rows).flat().some((cell) => cell.includes(N("Hidden")))).toBe(false);
  });

  it("shows the System's column to its owner and in a per-Framework section", async () => {
    const rows = await read(await get(users.other, boundary, fwA));
    const header = rows.find((row) => row[0] === "Framework")!;
    expect(header.slice(7)).toEqual([N("Counted"), N("Hidden")]);
    expect(dataRows(rows).map((row) => row[8]).sort()).toEqual(["Not applicable", "Not met"]);
    expect(rows.find((row) => row[0] === "Systems not shown (no access)")).toBeUndefined();
  });

  it("refuses without an acting user (401) and finds nothing for an unknown Boundary, a Framework the Boundary doesn't hold, or an empty one", async () => {
    expect((await get(null, boundary)).status).toBe(401);
    expect((await get(users.admin, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await get(users.admin, boundary, fwOther)).status).toBe(404);
    expect((await get(users.admin, boundary, "")).status).toBe(404);
    expect((await get(users.admin, boundary, "no-such-framework")).status).toBe(404);
    const empty = await get(users.admin, emptyBoundary);
    expect(empty.status).toBe(200);
    expect(dataRows(await read(empty))).toHaveLength(2);
  });

  it("answers 409 for a retired Boundary, which has no statement", async () => {
    const response = await get(users.admin, retired);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/retired/i);
    expect((await get(users.admin, retired, fwA)).status).toBe(409);
  });
});
