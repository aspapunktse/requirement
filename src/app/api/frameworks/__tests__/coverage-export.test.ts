import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { CSV_BOM } from "@/lib/csv";
import { COVERAGE_CSV_HEADER, coverageCsvRows } from "@/lib/framework-coverage-csv";
import { loadFrameworkCoverage } from "@/lib/framework-coverage";
import { requestAs } from "@/test/provider-fixtures";
import { parseCsv } from "@/test/csv-parse";
import { GET } from "../[id]/coverage/export/route";

/**
 * GET /api/frameworks/[id]/coverage/export (#151): the Coverage view as a CSV file.
 * Every fixture is created here (CI's DB is migrated, not seeded) and removed in afterAll.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];
const CAN_SEE_DRAFTS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

async function download(frameworkId: string, userId: string | null) {
  const response = await GET(requestAs(`/api/frameworks/${frameworkId}/coverage/export`, userId, "GET"), ctxFor(frameworkId));
  return { response, bytes: new Uint8Array(await response.clone().arrayBuffer()) };
}

describe("GET /api/frameworks/[id]/coverage/export (#151)", () => {
  const userIds: Record<string, string> = {};
  let publishedId: string;
  let publishedName: string;
  let draftId: string;
  const controlIds: string[] = [];

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-151-cov-${role}-${SUFFIX}@example.com`, name: `Test 151 ${role}`, role } })
      ).id;
    }
    const published = await prisma.framework.create({
      data: { name: `Test 151 Säkerhet ${SUFFIX}`, version: "2025", status: "PUBLISHED" },
    });
    publishedId = published.id;
    publishedName = published.name;
    draftId = (await prisma.framework.create({ data: { name: `Test 151 Draft ${SUFFIX}`, version: "1", status: "DRAFT" } })).id;

    const makeControl = async (n: number, title: string) => {
      const control = await prisma.control.create({
        data: { code: `TEST-151-COV-${SUFFIX}-${n}`, title, description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      });
      controlIds.push(control.id);
      return control;
    };
    const full = await makeControl(1, "Kryptering, \"stark\" åäö");
    const partial = await makeControl(2, "Loggning");

    await prisma.requirement.create({
      data: {
        frameworkId: publishedId,
        code: "TEST-151-1",
        section: "Artikel 2",
        title: "Krav med å, ä och ö",
        text: "t",
        mappings: {
          create: [
            { controlId: full.id, coverage: "FULL", rationale: "Rad ett,\nrad två med \"citat\"" },
            { controlId: partial.id, coverage: "PARTIAL" },
          ],
        },
      },
    });
    await prisma.requirement.create({
      data: { frameworkId: publishedId, code: "-TEST-151-2", section: "Artikel 1", title: "=HYPERLINK(\"x\")", text: "t" },
    });
    await prisma.requirement.create({
      data: {
        frameworkId: publishedId,
        code: "TEST-151-3",
        section: "Artikel 1",
        title: "Accepterat gap",
        text: "t",
        mappings: { create: [{ controlId: partial.id, coverage: "PARTIAL" }] },
        gapAcceptedAt: new Date(),
        gapAcceptedById: userIds.COMPLIANCE_MANAGER,
        gapJustification: "Utanför omfattning, se \"policy\"\nÖvrigt: åäö",
      },
    });
    await prisma.requirement.create({
      data: { frameworkId: draftId, code: "TEST-151-D", section: "Draft", title: "Draft Requirement", text: "t" },
    });
  });

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { frameworkId: { in: [publishedId, draftId] } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [publishedId, draftId] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  it("sends a UTF-8 CSV attachment with a safe filename, never cached, starting with the BOM bytes", async () => {
    const { response, bytes } = await download(publishedId, userIds.VIEWER);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.csv"$/);
    expect(disposition).toContain("coverage-Test-151-S-kerhet-");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("holds the header and the rows the page shows, with å, ä, ö, commas, quotes and newlines intact", async () => {
    const { bytes } = await download(publishedId, userIds.VIEWER);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(text.slice(CSV_BOM.length));

    expect(parsed[0]).toEqual([...COVERAGE_CSV_HEADER]);
    // Same rows as the loader gives the page (cells compared after the documented formula prefix is stripped).
    const { requirements } = await loadFrameworkCoverage(publishedId);
    const expected = coverageCsvRows(requirements).map((row) => row.map((value) => String(value ?? "")));
    const unprefixed = parsed.slice(1).map((row) => row.map((value) => (value.startsWith("'") ? value.slice(1) : value)));
    expect(unprefixed).toEqual(expected);

    // Page order: Artikel 1 before Artikel 2; one row per Requirement and mapped Control.
    expect(parsed.slice(1).map((row) => [row[0], row[1], row[3]])).toEqual([
      ["Artikel 1", "'-TEST-151-2", ""],
      ["Artikel 1", "TEST-151-3", `TEST-151-COV-${SUFFIX}-2`],
      ["Artikel 2", "TEST-151-1", `TEST-151-COV-${SUFFIX}-1`],
      ["Artikel 2", "TEST-151-1", `TEST-151-COV-${SUFFIX}-2`],
    ]);
    const [gap, accepted, covered, partial] = parsed.slice(1);
    expect(gap[2]).toBe("'=HYPERLINK(\"x\")");
    expect(gap[7]).toBe("Coverage Gap");
    expect(accepted[7]).toBe("Accepted gap");
    expect(accepted[8]).toBe("Utanför omfattning, se \"policy\"\nÖvrigt: åäö");
    expect(covered[2]).toBe("Krav med å, ä och ö");
    expect(covered[4]).toBe("Kryptering, \"stark\" åäö");
    expect(covered[5]).toBe("Full");
    expect(covered[6]).toBe("Rad ett,\nrad två med \"citat\"");
    expect(covered[7]).toBe("Covered");
    expect(partial[5]).toBe("Partial");
    expect(publishedName).toContain("ä");
  });

  it.each(ROLES)("lets a %s download a Published Framework's Coverage", async (role) => {
    expect((await download(publishedId, userIds[role])).response.status).toBe(200);
  });

  it.each(ROLES)("answers a Draft's export for a %s as the Coverage JSON route does", async (role) => {
    const { response, bytes } = await download(draftId, userIds[role]);
    if (CAN_SEE_DRAFTS.includes(role)) {
      expect(response.status).toBe(200);
      expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toContain("TEST-151-D");
    } else {
      expect(response.status).toBe(404);
      expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).not.toContain("TEST-151-D");
    }
  });

  it("is a 404 for an unknown Framework and a 401 without a signed-in user", async () => {
    expect((await download("00000000-0000-0000-0000-000000000000", userIds.ADMIN)).response.status).toBe(404);
    expect((await download(publishedId, null)).response.status).toBe(401);
  });
});
