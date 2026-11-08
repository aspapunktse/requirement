import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadRiskRegister } from "@/lib/risk-register";
import { ALL_ROLES, createCheckUpScenario } from "@/test/check-up-fixtures";

/**
 * Who sees which Risks in the cross-System register (#322): the System rule (`visibleSystemsWhere`) plus
 * Organization Risks for the roles that may read them. Fixtures only (CI's database is migrated, not seeded);
 * the assertions look only at this file's Risks, since other rows may exist.
 */

describe("loadRiskRegister", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let otherOwner: string;
  const risk: Record<"own" | "others" | "organization" | "onboarded", string> = { own: "", others: "", organization: "", onboarded: "" };

  const idsFor = async (userId: string, role: UserRole) => {
    const rows = await loadRiskRegister({ id: userId, role });
    return Object.entries(risk)
      .filter(([, id]) => rows.some((row) => row.id === id))
      .map(([key]) => key)
      .sort();
  };

  beforeAll(async () => {
    s = await createCheckUpScenario("322r", { systemControls: 1, organizationControls: 1 });
    otherOwner = (await prisma.user.create({ data: { email: `test-322r-other-owner-${s.suffix}@example.com`, name: "Test 322r other owner", role: "SYSTEM_OWNER" } })).id;
    const others = await prisma.system.create({ data: { name: `Test 322r Others System ${s.suffix}`, ownerId: otherOwner, status: "DRAFT" } });
    const onboarded = await prisma.system.create({ data: { name: `Test 322r Onboarded System ${s.suffix}`, ownerId: otherOwner, status: "ONBOARDED" } });
    const base = { description: "d", severity: "HIGH" as const, likelihood: "LOW" as const };
    risk.own = (await prisma.risk.create({ data: { ...base, title: "Test 322r own", systemId: s.systemId, source: "AD_HOC" } })).id;
    risk.others = (await prisma.risk.create({ data: { ...base, title: "Test 322r others", systemId: others.id, source: "REQUIREMENT_NONCONFORMANCE", ownerId: s.roleUser.VIEWER } })).id;
    risk.onboarded = (await prisma.risk.create({ data: { ...base, title: "Test 322r onboarded", systemId: onboarded.id, source: "AD_HOC" } })).id;
    const orgCheckUp = s.find(s.organizationControls[0].code, true);
    risk.organization = (await prisma.risk.create({ data: { ...base, title: "Test 322r organization", systemId: null, checkUpId: orgCheckUp.id, source: "AUDIT_FINDING" } })).id;
  });

  afterAll(async () => {
    await s.cleanup();
  });

  it("shows a System Owner the Risks on their own Systems and on Onboarded ones, never another's Draft System or an Organization Risk", async () => {
    expect(await idsFor(s.systemOwner, "SYSTEM_OWNER")).toEqual(["onboarded", "own"]);
    expect(await idsFor(otherOwner, "SYSTEM_OWNER")).toEqual(["onboarded", "others"]);
  });

  it("shows a Viewer only the Risks on Onboarded Systems", async () => {
    expect(await idsFor(s.roleUser.VIEWER, "VIEWER")).toEqual(["onboarded"]);
  });

  it.each<UserRole>(["ADMIN", "RISK_OWNER", "INTERNAL_AUDITOR"])("shows a %s every Risk, the Organization Risk included", async (role) => {
    expect(await idsFor(s.roleUser[role], role)).toEqual(["onboarded", "organization", "others", "own"]);
  });

  it.each<UserRole>(["REVIEWER", "COMPLIANCE_MANAGER"])("shows a %s the Risks on every System but not the Organization Risk", async (role) => {
    expect(await idsFor(s.roleUser[role], role)).toEqual(["onboarded", "others", "own"]);
  });

  it("never shows an Organization Risk to a role that may not read them", async () => {
    for (const role of ALL_ROLES.filter((r) => !["ADMIN", "RISK_OWNER", "INTERNAL_AUDITOR"].includes(r))) {
      expect(await idsFor(s.roleUser[role], role), role).not.toContain("organization");
    }
  });

  it("returns each Risk with its source, System (null for an Organization Risk), owner and an ISO opened date", async () => {
    const rows = await loadRiskRegister({ id: s.roleUser.ADMIN, role: "ADMIN" });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(risk.own)).toMatchObject({ source: "AD_HOC", system: { id: s.systemId, name: s.systemName }, owner: null, severity: "HIGH", likelihood: "LOW", status: "OPEN" });
    expect(byId.get(risk.others)).toMatchObject({ source: "REQUIREMENT_NONCONFORMANCE", owner: { id: s.roleUser.VIEWER } });
    expect(byId.get(risk.organization)).toMatchObject({ source: "AUDIT_FINDING", system: null });
    expect(byId.get(risk.own)!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
