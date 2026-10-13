import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { getAllOpenRisks } from "@/lib/dashboard";
import { roleView } from "@/app/home/role-view";
import { requestAs } from "@/test/provider-fixtures";
import { ALL_ROLES, createCheckUpScenario } from "@/test/check-up-fixtures";
import { getBaseFramework } from "@/test/framework-fixtures";
import { GET as listOrganizationRisks } from "../route";
import { PATCH as manageRisk } from "../[id]/route";
import { GET as listSystemRisks } from "../../systems/[id]/risks/route";
import { PATCH as manageSystemRisk } from "../../systems/[id]/risks/[riskId]/route";
import { GET as businessRiskOwnerRisks } from "../../business-risk-owner/risks/route";
import { GET as businessRiskOwnerPortfolio } from "../../business-risk-owner/portfolio/route";

/**
 * Risks that belong to no System (#157): who sees and manages them, and that every existing Risk
 * view still works with one in the table. The Risk is opened by a real Organization-level
 * Nonconformity, since the database refuses a Risk with neither a System nor a Check-up.
 */

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("Risks with no System (#157)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let organizationRiskId: string;
  let systemRiskId: string;
  let businessRiskOwnerAtBase: string;

  const list = (userId: string | null, scope = "organization") => listOrganizationRisks(requestAs(`/api/risks?scope=${scope}`, userId, "GET"));
  const manage = (userId: string | null, id: string, body: unknown) => manageRisk(requestAs(`/api/risks/${id}`, userId, "PATCH", body), ctx(id));

  beforeAll(async () => {
    s = await createCheckUpScenario("157r", { systemControls: 1, organizationControls: 1 });
    const auditor = { id: s.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" as UserRole };
    // One Organization-level and one System-level Nonconformity.
    const org = s.find(s.organizationControls[0].code, true);
    await s.answer(org.id, s.controlOwner);
    await evaluateCheckUp(org.id, auditor, { outcome: "NONCONFORMITY", comment: "Organization gap" });
    const sys = s.find(s.systemControls[0].code, false);
    await s.answer(sys.id, s.systemOwner);
    await evaluateCheckUp(sys.id, auditor, { outcome: "NONCONFORMITY", comment: "System gap" });
    organizationRiskId = (await prisma.risk.findUniqueOrThrow({ where: { checkUpId: org.id } })).id;
    systemRiskId = (await prisma.risk.findUniqueOrThrow({ where: { checkUpId: sys.id } })).id;
    // A Business Risk Owner who owns the base Framework sees every System: the widest scope there is.
    const base = await getBaseFramework();
    businessRiskOwnerAtBase = (
      await prisma.user.create({
        data: { email: `test-157r-bro-base-${s.suffix}@example.com`, name: "Test 157r BRO at base", role: "BUSINESS_RISK_OWNER", frameworkScopes: { connect: [{ id: base.id }] } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: `test-157r-bro-base-${s.suffix}@example.com` } });
    await s.cleanup();
  });

  describe("who reads them", () => {
    it.each<UserRole>(["RISK_OWNER", "ADMIN", "INTERNAL_AUDITOR"])("lets a %s list them", async (role) => {
      const response = await list(s.roleUser[role]);
      expect(response.status).toBe(200);
      const { risks } = await response.json();
      const found = risks.find((r: { id: string }) => r.id === organizationRiskId);
      expect(found).toMatchObject({ systemId: null, status: "OPEN", checkUp: { id: expect.any(String) } });
      // Only System-less Risks: the System's own is not listed here.
      expect(risks.some((r: { id: string }) => r.id === systemRiskId)).toBe(false);
    });

    it.each<UserRole>(["COMPLIANCE_MANAGER", "SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"])("refuses a %s", async (role) => {
      expect((await list(s.roleUser[role])).status).toBe(403);
    });

    it("refuses nobody signed in and any other scope", async () => {
      expect((await list(null)).status).toBe(401);
      expect((await list(s.roleUser.ADMIN, "system")).status).toBe(400);
    });
  });

  describe("who manages them", () => {
    it.each<UserRole>(["RISK_OWNER", "ADMIN"])("lets a %s change the status, mitigation plan and owner, logging a System-less event", async (role) => {
      const riskOwner = s.roleUser.RISK_OWNER;
      const response = await manage(s.roleUser[role], organizationRiskId, { status: "MITIGATED", mitigationPlan: "Rewrite the process", ownerId: riskOwner });
      expect(response.status).toBe(200);
      const { risk } = await response.json();
      expect(risk).toMatchObject({ status: "MITIGATED", mitigationPlan: "Rewrite the process", ownerId: riskOwner });
      const events = await prisma.changeEvent.findMany({ where: { systemId: null, action: "RISK_STATUS_CHANGED", actorId: s.roleUser[role], detail: { contains: s.suffix } } });
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain("from OPEN to MITIGATED");
      // Back to Open for the next role, owner unassigned.
      expect((await manage(s.roleUser[role], organizationRiskId, { status: "OPEN", ownerId: null })).status).toBe(200);
      expect((await prisma.risk.findUniqueOrThrow({ where: { id: organizationRiskId } })).ownerId).toBeNull();
      await prisma.changeEvent.deleteMany({ where: { actorId: s.roleUser[role], action: "RISK_STATUS_CHANGED", systemId: null } });
    });

    it("refuses the Internal Auditor and every other role", async () => {
      for (const role of ALL_ROLES.filter((r) => r !== "RISK_OWNER" && r !== "ADMIN")) {
        expect((await manage(s.roleUser[role], organizationRiskId, { status: "CLOSED" })).status, role).toBe(403);
      }
      expect((await manage(null, organizationRiskId, { status: "CLOSED" })).status).toBe(401);
      expect((await prisma.risk.findUniqueOrThrow({ where: { id: organizationRiskId } })).status).toBe("OPEN");
    });

    it("keeps the System route's rules: Mitigated needs a plan, an unknown or System Risk is a 404, the owner must be a Risk Owner or an Admin", async () => {
      expect((await manage(s.roleUser.RISK_OWNER, organizationRiskId, { status: "MITIGATED" })).status).toBe(400);
      expect((await manage(s.roleUser.RISK_OWNER, "no-such-risk", { status: "OPEN" })).status).toBe(404);
      // A Risk that belongs to a System is managed through its System, not here.
      expect((await manage(s.roleUser.RISK_OWNER, systemRiskId, { status: "CLOSED" })).status).toBe(404);
      expect((await manage(s.roleUser.RISK_OWNER, organizationRiskId, { status: "OPEN", ownerId: s.systemOwner })).status).toBe(400);
      expect((await manage(s.roleUser.RISK_OWNER, organizationRiskId, { status: "nonsense" })).status).toBe(400);
      // And the System route does not manage an Organization Risk either.
      const viaSystem = await manageSystemRisk(
        requestAs(`/api/systems/${s.systemId}/risks/${organizationRiskId}`, s.roleUser.RISK_OWNER, "PATCH", { status: "CLOSED" }),
        { params: Promise.resolve({ id: s.systemId, riskId: organizationRiskId }) } as never,
      );
      expect(viaSystem.status).toBe(404);
      expect((await prisma.risk.findUniqueOrThrow({ where: { id: organizationRiskId } })).status).toBe("OPEN");
    });
  });

  describe("the existing Risk views with one in the table", () => {
    it("never lists it in a Business Risk Owner's scoped views, nor in the Admin's use of them", async () => {
      for (const userId of [businessRiskOwnerAtBase, s.roleUser.ADMIN]) {
        const risks = await businessRiskOwnerRisks(requestAs("/api/business-risk-owner/risks", userId, "GET"));
        expect(risks.status).toBe(200);
        const body = (await risks.json()).risks as { id: string }[];
        expect(body.some((r) => r.id === organizationRiskId)).toBe(false);
        // The System Risk is a Risk like any other for them.
        expect(body.some((r) => r.id === systemRiskId)).toBe(true);
        const portfolio = await businessRiskOwnerPortfolio(requestAs("/api/business-risk-owner/portfolio", userId, "GET"));
        expect(portfolio.status).toBe(200);
      }
    });

    it("lists the System's Risk on its System and the Organization Risk nowhere on a System", async () => {
      const response = await listSystemRisks(requestAs(`/api/systems/${s.systemId}/risks`, s.roleUser.RISK_OWNER, "GET"), ctx(s.systemId));
      expect(response.status).toBe(200);
      const { risks } = await response.json();
      expect(risks.map((r: { id: string }) => r.id)).toEqual([systemRiskId]);
      expect(risks[0].checkUp).toMatchObject({ id: expect.any(String) });
    });

    it("shows it to a Risk Owner on /home as an Organization task, and counts it", async () => {
      const view = await roleView({ id: s.roleUser.RISK_OWNER, name: "Risk Owner", role: "RISK_OWNER" });
      const row = view.tasks!.find((t) => t.id === organizationRiskId);
      expect(row).toMatchObject({ kind: "Risk", subtitle: "Organization", href: "/risks/organization" });
      // The System Risk keeps linking to its System.
      expect(view.tasks!.find((t) => t.id === systemRiskId)).toMatchObject({ subtitle: s.systemName, href: `/systems/${s.systemId}` });
      expect(view.stats.find((stat) => stat.label === "Open risks")!.value).toBeGreaterThanOrEqual(2);
      expect(view.tiles.map((t) => t.href)).toContain("/risks/organization");
    });

    it("keeps it off a Business Risk Owner's /home, even one at the base Framework, and offers the page to the roles that read it", async () => {
      const bro = await roleView({ id: businessRiskOwnerAtBase, name: "BRO", role: "BUSINESS_RISK_OWNER" });
      expect(bro.tasks!.some((t) => t.id === organizationRiskId)).toBe(false);
      expect(bro.tasks!.some((t) => t.id === systemRiskId)).toBe(true);
      expect(bro.tiles.map((t) => t.href)).not.toContain("/risks/organization");
      for (const role of ["ADMIN", "INTERNAL_AUDITOR"] as const) {
        const view = await roleView({ id: s.roleUser[role], name: role, role });
        expect(view.tiles.map((t) => t.href), role).toContain("/risks/organization");
      }
      for (const role of ["SYSTEM_OWNER", "REVIEWER", "VIEWER", "COMPLIANCE_MANAGER"] as const) {
        const view = await roleView({ id: s.roleUser[role], name: role, role });
        expect(view.tiles.map((t) => t.href), role).not.toContain("/risks/organization");
      }
    });

    it("keeps the dashboard's open-Risk list working: a System-less Risk reads with no System", async () => {
      const risks = await getAllOpenRisks();
      expect(risks.find((r) => r.id === organizationRiskId)?.system).toBeNull();
      expect(risks.find((r) => r.id === systemRiskId)?.system?.id).toBe(s.systemId);
    });
  });

  describe("the schema keeps a Risk from being orphaned", () => {
    it("refuses a Risk with neither a System nor a Check-up, and a second Risk for one Check-up", async () => {
      await expect(prisma.risk.create({ data: { title: "t", description: "d", severity: "LOW", likelihood: "LOW" } })).rejects.toThrow();
      const checkUpId = (await prisma.risk.findUniqueOrThrow({ where: { id: organizationRiskId } })).checkUpId!;
      await expect(prisma.risk.create({ data: { checkUpId, title: "t", description: "d", severity: "LOW", likelihood: "LOW" } })).rejects.toThrow();
      // A Check-up with a Risk can't be deleted from under it (Restrict).
      await expect(prisma.checkUp.delete({ where: { id: checkUpId } })).rejects.toThrow();
    });
  });
});
