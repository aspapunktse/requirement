import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CSV_BOM } from "@/lib/csv";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { SOA_CSV_HEADER, soaCsvRows } from "@/lib/statement-of-applicability-csv";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { parseCsv } from "@/test/csv-parse";
import { GET } from "../export/route";

/**
 * GET /api/statement-of-applicability/export (#151): the SoA as a CSV file, the same
 * rows for every signed-in role. The database holds every Control, so the fixtures are
 * looked up by code and nothing asserts a table-wide total.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];
const CODE = (n: number) => `TEST-151-SOA-${SUFFIX}-${n}`;

describe("GET /api/statement-of-applicability/export (#151)", () => {
  const userIds: Record<string, string> = {};
  const controlIds: string[] = [];
  let draftFrameworkId: string;
  let draftName: string;
  let publishedLabel: string;

  const get = async (userId: string | null) => {
    const response = await GET(requestAs("/api/statement-of-applicability/export", userId, "GET"));
    return { response, bytes: new Uint8Array(await response.clone().arrayBuffer()) };
  };
  const rowsOf = (bytes: Uint8Array) => parseCsv(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(CSV_BOM.length));
  const byCode = (rows: string[][], code: string) => rows.filter((row) => row[0] === code);

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-151-soa-${role}-${SUFFIX}@example.com`, name: `Test 151 ${role}`, role } })
      ).id;
    }
    const published = await createFixtureFramework("151 SoA");
    publishedLabel = `${published.name}:${published.version}`;
    const draft = await prisma.framework.create({ data: { name: `Test 151 SoA Draft ${SUFFIX}`, version: "1", status: "DRAFT" } });
    draftFrameworkId = draft.id;
    draftName = draft.name;

    const make = async (n: number, title: string, soaExclusionJustification: string | null = null) => {
      const control = await prisma.control.create({
        data: { code: CODE(n), title, description: "d", category: "Test", applicability: "ORGANIZATIONAL", soaExclusionJustification },
      });
      controlIds.push(control.id);
      return control.id;
    };
    // 1: included (mapped to a Published Framework) and also mapped to a Draft.
    const included = await make(1, "Kryptering, \"stark\"\nåäö");
    // 2: excluded with an authored justification; 3: excluded without one; 4: leading "=" in the title.
    await make(2, "Undantagen", "Inte relevant, se \"policy\"\nÖvrigt: åäö");
    await make(3, "Saknar motivering");
    const formula = await make(4, "=1+1");
    await mapControlsToFramework(published.id, [included, formula]);
    await mapControlsToFramework(draft.id, [included]);
  });

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  it("sends a UTF-8 CSV attachment with a safe filename, never cached, starting with the BOM bytes", async () => {
    const { response, bytes } = await get(userIds.VIEWER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="statement-of-applicability-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("holds the header and each fixture Control once, as the page shows it, with å, ä, ö, quotes and newlines intact", async () => {
    const rows = rowsOf((await get(userIds.VIEWER)).bytes);
    expect(rows[0]).toEqual([...SOA_CSV_HEADER]);
    for (const n of [1, 2, 3, 4]) expect(byCode(rows, CODE(n))).toHaveLength(1);

    // The same rows the page gets from the loader.
    const expected = soaCsvRows(await loadStatementOfApplicability()).map((row) => row.map((value) => String(value ?? "")));
    const unprefixed = rows.slice(1).map((row) => row.map((value) => (value.startsWith("'") ? value.slice(1) : value)));
    for (const n of [1, 2, 3, 4]) {
      expect(unprefixed.filter((row) => row[0] === CODE(n))).toEqual(expected.filter((row) => row[0] === CODE(n)));
    }

    const [included] = byCode(rows, CODE(1));
    expect(included[1]).toBe("Kryptering, \"stark\"\nåäö");
    expect(included[3]).toBe("Included");
    expect(included[4].startsWith(`${publishedLabel} TEST-FX-`)).toBe(true);
    expect(included[5]).toBe("");
    expect(included[6]).toBe("No");
    expect(included[7]).toBe("Not Started");

    const [excluded] = byCode(rows, CODE(2));
    expect(excluded.slice(3, 7)).toEqual(["Excluded", "", "Inte relevant, se \"policy\"\nÖvrigt: åäö", "No"]);
    const [missing] = byCode(rows, CODE(3));
    expect(missing.slice(3, 7)).toEqual(["Excluded", "", "", "Yes"]);
    expect(byCode(rows, CODE(4))[0][1]).toBe("'=1+1");
  });

  it("leaves a Draft Framework's mapping out of the SoA for a curator and for anyone else", async () => {
    for (const role of ROLES) {
      const { bytes } = await get(userIds[role]);
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      const [included] = byCode(parseCsv(text.slice(CSV_BOM.length)), CODE(1));
      expect(included[4]).toContain(publishedLabel);
      expect(text).not.toContain(draftName);
    }
  });

  it.each(ROLES)("lets a %s download it", async (role) => {
    const { response, bytes } = await get(userIds[role]);
    expect(response.status).toBe(200);
    const mine = byCode(rowsOf(bytes), CODE(2));
    expect(mine).toHaveLength(1);
  });

  it("refuses an unauthenticated request (401)", async () => {
    expect((await get(null)).response.status).toBe(401);
  });
});
