import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { canEditControlLibrary, loadControlLibrary } from "../control-library";

const ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

describe("loadControlLibrary (#169)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const publishedCode = `TEST-169-PUB-${suffix}`;
  const draftMappedCode = `TEST-169-DRM-${suffix}`;
  const draftOriginCode = `TEST-169-DRO-${suffix}`;
  const controlIds: string[] = [];
  let publishedName = "";
  let draftName = "";
  let draftFrameworkId = "";
  let ownerId = "";

  beforeAll(async () => {
    const published = await createFixtureFramework("169 published");
    const draft = await prisma.framework.create({
      data: { name: `Test 169 Draft Framework ${suffix}`, version: "9", status: "DRAFT" },
    });
    draftFrameworkId = draft.id;
    publishedName = published.name;
    draftName = draft.name;
    ownerId = (
      await prisma.user.create({
        data: { email: `test-169-owner-${suffix}@example.com`, name: `Test 169 Owner ${suffix}`, role: "SYSTEM_OWNER" },
      })
    ).id;

    const make = async (code: string, extra: object = {}) => {
      const control = await prisma.control.create({
        data: { code, title: `Test 169 ${code}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL", ownerId, ...extra },
      });
      controlIds.push(control.id);
      return control.id;
    };
    const pub = await make(publishedCode, { examples: ["an example"], intent: "why" });
    const drm = await make(draftMappedCode);
    await make(draftOriginCode, { originFrameworkId: draftFrameworkId });
    await mapControlsToFramework(published.id, [pub, drm]);
    await mapControlsToFramework(draft.id, [drm]);
  });

  afterAll(async () => {
    // A Control with an origin Framework is deleted before its Framework.
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  const find = (rows: Awaited<ReturnType<typeof loadControlLibrary>>, code: string) => rows.find((row) => row.code === code);

  it.each(ROLES)("returns the fixture Controls to the %s with owner and Published mapping", async (role) => {
    const rows = await loadControlLibrary({ role });
    const row = find(rows, publishedCode);
    expect(row).toMatchObject({ ownerName: `Test 169 Owner ${suffix}`, examples: ["an example"], intent: "why", origin: null });
    expect(row?.mappings.map((m) => m.framework.label)).toEqual([`${publishedName}:1`]);
    expect(find(rows, draftMappedCode)).toBeDefined();
    expect(find(rows, draftOriginCode)).toBeDefined();
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))(
    "gives the %s no Draft Framework name, in a mapping or as an origin",
    async (role) => {
      const rows = await loadControlLibrary({ role });
      expect(JSON.stringify(rows)).not.toContain(draftName);
      expect(find(rows, draftMappedCode)?.mappings.map((m) => m.draft)).toEqual([false]);
      expect(find(rows, draftOriginCode)?.origin).toBeNull();
    },
  );

  it.each(CURATORS)("shows the %s the Draft mapping, marked, and the Draft origin", async (role) => {
    const rows = await loadControlLibrary({ role });
    expect(find(rows, draftMappedCode)?.mappings.filter((m) => m.draft).map((m) => m.framework.label)).toEqual([`${draftName}:9`]);
    expect(find(rows, draftOriginCode)?.origin).toMatchObject({ label: `${draftName}:9`, draft: true });
  });

  it("gives the editor link to the Compliance Manager and Admin only", () => {
    expect(ROLES.filter((role) => canEditControlLibrary({ role })).sort()).toEqual(["ADMIN", "COMPLIANCE_MANAGER"]);
  });
});
