import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT } from "@/lib/soa-exclusion-justification";
import { EXCLUSION_JUSTIFICATION_MAX_LENGTH } from "@/lib/statement-of-applicability-rules";
import { PUT } from "../route";

/**
 * PUT /api/statement-of-applicability/[controlId]/exclusion-justification (#150).
 * Fixtures only. The excluded Control is an Organizational Control mapped to no
 * Framework; the included one is mapped to a fixture Published Framework.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ALLOWED: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];
const DENIED: UserRole[] = ["SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"];
const CODE_PREFIX = `TEST-150-${SUFFIX}`;

describe("PUT /api/statement-of-applicability/[controlId]/exclusion-justification (#150)", () => {
  const userIds: Record<string, string> = {};
  let excludedId: string;
  let excludedCode: string;
  let includedId: string;

  const put = (userId: string | null, controlId: string, body: unknown) =>
    PUT(requestAs(`/api/statement-of-applicability/${controlId}/exclusion-justification`, userId, "PUT", body), {
      params: Promise.resolve({ controlId }),
    } as never);

  const stored = async (id: string) => (await prisma.control.findUniqueOrThrow({ where: { id } })).soaExclusionJustification;
  const events = (code: string) =>
    prisma.changeEvent.findMany({
      where: { systemId: null, action: "SOA_JUSTIFICATION_CHANGED", detail: { contains: `Control ${code} ` } },
      orderBy: { createdAt: "asc" },
    });
  const reset = async () => {
    await prisma.control.updateMany({ where: { id: { in: [excludedId, includedId] } }, data: { soaExclusionJustification: null } });
    await prisma.changeEvent.deleteMany({ where: { systemId: null, action: "SOA_JUSTIFICATION_CHANGED", detail: { contains: CODE_PREFIX } } });
  };

  beforeAll(async () => {
    for (const role of [...ALLOWED, ...DENIED]) {
      userIds[role] = (
        await prisma.user.create({ data: { email: `test-150-${role}-${SUFFIX}@example.com`, name: `Test 150 ${role}`, role } })
      ).id;
    }
    const make = (suffix: string) =>
      prisma.control.create({
        data: { code: `${CODE_PREFIX}-${suffix}`, title: `Test 150 ${suffix}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      });
    const excluded = await make("EX");
    const included = await make("IN");
    excludedId = excluded.id;
    excludedCode = excluded.code;
    includedId = included.id;
    const framework = await createFixtureFramework("SOA justification");
    await mapControlsToFramework(framework.id, [includedId]);
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: null, action: "SOA_JUSTIFICATION_CHANGED", detail: { contains: CODE_PREFIX } } });
    await prisma.control.deleteMany({ where: { id: { in: [excludedId, includedId] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  it("the fixture is as expected: one excluded Control, one included", async () => {
    const rows = await loadStatementOfApplicability();
    expect(rows.find((row) => row.controlId === excludedId)?.included).toBe(false);
    expect(rows.find((row) => row.controlId === includedId)?.included).toBe(true);
  });

  it.each(DENIED)("refuses a %s with 403 and changes nothing", async (role) => {
    await reset();
    const response = await put(userIds[role], excludedId, { justification: "Nope" });
    expect(response.status).toBe(403);
    expect(await stored(excludedId)).toBeNull();
    expect(await events(excludedCode)).toHaveLength(0);
  });

  it("refuses nobody signed in with 401 and changes nothing", async () => {
    await reset();
    expect((await put(null, excludedId, { justification: "Nope" })).status).toBe(401);
    expect(await stored(excludedId)).toBeNull();
    expect(await events(excludedCode)).toHaveLength(0);
  });

  it.each(ALLOWED)("lets a %s save, change and clear, one System-less Change Event each, actor the user", async (role) => {
    await reset();
    const actor = userIds[role];

    const saved = await put(actor, excludedId, { justification: "  Not in scope  " });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ controlId: excludedId, exclusionJustification: "Not in scope", justificationMissing: false });
    expect(await stored(excludedId)).toBe("Not in scope");

    expect((await put(actor, excludedId, { justification: "Out of scope for the Organization" })).status).toBe(200);
    expect(await stored(excludedId)).toBe("Out of scope for the Organization");

    const cleared = await put(actor, excludedId, { justification: null });
    expect(await cleared.json()).toEqual({ controlId: excludedId, exclusionJustification: null, justificationMissing: true });
    expect(await stored(excludedId)).toBeNull();

    const written = await events(excludedCode);
    expect(written).toHaveLength(3);
    expect(written.every((event) => event.systemId === null && event.actorId === actor)).toBe(true);
    expect(written[0].detail).toContain('none → "Not in scope"');
    expect(written[1].detail).toContain('"Not in scope" → "Out of scope for the Organization"');
    expect(written[2].detail).toContain('"Out of scope for the Organization" → none');
  });

  it("treats blank text as cleared", async () => {
    await reset();
    const actor = userIds.COMPLIANCE_MANAGER;
    await put(actor, excludedId, { justification: "Something" });
    const response = await put(actor, excludedId, { justification: "   \n " });
    expect(await response.json()).toMatchObject({ exclusionJustification: null, justificationMissing: true });
    expect(await stored(excludedId)).toBeNull();
    const written = await events(excludedCode);
    expect(written).toHaveLength(2);
    expect(written[1].detail).toContain('"Something" → none');
  });

  it("writes no Change Event for an unchanged save, a blank save of nothing, or a trim-equal save", async () => {
    await reset();
    const actor = userIds.ADMIN;
    expect((await put(actor, excludedId, { justification: "   " })).status).toBe(200);
    expect(await events(excludedCode)).toHaveLength(0);

    await put(actor, excludedId, { justification: "Same" });
    expect((await put(actor, excludedId, { justification: "Same" })).status).toBe(200);
    expect((await put(actor, excludedId, { justification: " Same " })).status).toBe(200);
    expect(await events(excludedCode)).toHaveLength(1);
    expect(await stored(excludedId)).toBe("Same");
  });

  it("caps long text in the Change Event detail but stores it whole", async () => {
    await reset();
    const long = "x".repeat(EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT + 300);
    expect((await put(userIds.ADMIN, excludedId, { justification: long })).status).toBe(200);
    expect(await stored(excludedId)).toBe(long);
    const [event] = await events(excludedCode);
    expect(event.detail).toContain(`"${"x".repeat(EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT)}…"`);
    expect(event.detail).not.toContain("x".repeat(EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT + 1));
  });

  it("rejects a bad body or too long a text with 400 and changes nothing", async () => {
    await reset();
    const actor = userIds.ADMIN;
    for (const body of [{}, { justification: 5 }, null, { justification: "x".repeat(EXCLUSION_JUSTIFICATION_MAX_LENGTH + 1) }]) {
      expect((await put(actor, excludedId, body)).status).toBe(400);
    }
    expect(await stored(excludedId)).toBeNull();
    expect(await events(excludedCode)).toHaveLength(0);
  });

  it("answers 404 for an unknown Control", async () => {
    const response = await put(userIds.ADMIN, `no-such-control-${SUFFIX}`, { justification: "x" });
    expect(response.status).toBe(404);
  });

  it("refuses to write text for an included Control (409) but lets a kept one be cleared", async () => {
    await reset();
    const actor = userIds.COMPLIANCE_MANAGER;
    const refused = await put(actor, includedId, { justification: "Why not" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/included/);
    expect(await stored(includedId)).toBeNull();
    expect(await events(`${CODE_PREFIX}-IN`)).toHaveLength(0);

    // A kept justification (written while excluded, the Control since included).
    await prisma.control.update({ where: { id: includedId }, data: { soaExclusionJustification: "Kept" } });
    const cleared = await put(actor, includedId, { justification: "" });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ controlId: includedId, exclusionJustification: null, justificationMissing: false });
    expect(await stored(includedId)).toBeNull();
    const written = await events(`${CODE_PREFIX}-IN`);
    expect(written).toHaveLength(1);
    expect(written[0].detail).toContain('"Kept" → none');
  });

  it("is reflected by the Statement of Applicability read path", async () => {
    await reset();
    await put(userIds.ADMIN, excludedId, { justification: "Shown on the page" });
    const rows = await loadStatementOfApplicability();
    expect(rows.find((row) => row.controlId === excludedId)).toMatchObject({
      exclusionJustification: "Shown on the page",
      justificationMissing: false,
    });
  });
});
