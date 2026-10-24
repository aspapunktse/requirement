import { afterAll, describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBaseFramework, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { createInternalAudit } from "@/lib/internal-audits";
import { frameworkLabel } from "@/lib/framework-label";
import { roleView } from "../role-view";
import { loadFrameworkRingsPicture } from "../home-pictures";
import type { HomePicture } from "../home-types";

type Pic<T extends HomePicture["type"]> = Extract<HomePicture, { type: T }>;
function expectType<T extends HomePicture["type"]>(picture: HomePicture, type: T): Pic<T> {
  expect(picture.type).toBe(type);
  return picture as Pic<T>;
}

const DAY = 86_400_000;

describe("each role's picture on /home (#226)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const emails: string[] = [];
  const systemIds: string[] = [];
  const controlIds: string[] = [];
  const businessUnitIds: string[] = [];
  const facetIds: string[] = [];
  const riskIds: string[] = [];

  async function makeUser(key: string, role: UserRole, extra: Record<string, unknown> = {}) {
    const email = `test-home-pic-${key}-${suffix}@example.com`;
    emails.push(email);
    return prisma.user.create({ data: { email, name: `Test Pic ${key}`, role, ...extra } });
  }
  async function makeSystem(ownerId: string, name: string, extra: Record<string, unknown> = {}) {
    const system = await prisma.system.create({ data: { name: `Test Pic ${name} ${suffix}`, ownerId, ...extra } });
    systemIds.push(system.id);
    return system;
  }

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { id: { in: riskIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.reviewRound.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facetIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await prisma.businessUnit.deleteMany({ where: { id: { in: businessUnitIds } } });
  });

  // Every role value has a picture; adding a role to the enum fails this until it is handled.
  const PICTURE_OF_ROLE: Record<UserRole, HomePicture["type"]> = {
    SYSTEM_OWNER: "pipeline",
    REVIEWER: "bars",
    RISK_OWNER: "heat",
    BUSINESS_RISK_OWNER: "portfolio",
    COMPLIANCE_MANAGER: "rings",
    INTERNAL_AUDITOR: "audits",
    ADMIN: "bars",
    VIEWER: "mosaic",
  };

  it.each(Object.values(UserRole))("gives the %s a picture, with a title and an empty message", async (role) => {
    const user = await makeUser(`all-${role}`, role);
    const view = await roleView(user);
    expect(view.picture.type).toBe(PICTURE_OF_ROLE[role]);
    expect(view.picture.title).toBeTruthy();
    expect(view.picture.empty).toBeTruthy();
    expect(view.activity).toBeInstanceOf(Array);
    // Every figure has a weekly trend of seven points, or none.
    for (const stat of view.stats) if (stat.trend) expect(stat.trend).toHaveLength(7);
  });

  describe("System Owner: the pipeline of own Systems with % assessed", () => {
    it("puts each own System in the column of its onboarding status, flags a rejected one and counts what is assessed", async () => {
      const owner = await makeUser("pipeline-owner", "SYSTEM_OWNER");
      const reviewer = await makeUser("pipeline-reviewer", "REVIEWER");
      const facet = await prisma.deploymentFacet.create({ data: { name: `Test Pic facet ${suffix}` } });
      facetIds.push(facet.id);
      const control = await prisma.control.create({
        data: {
          code: `TEST-PIC-${suffix}`,
          title: `Test Pic Control ${suffix}`,
          description: "d",
          category: "Security",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facet.id }] },
        },
      });
      controlIds.push(control.id);
      const base = await getBaseFramework();
      const requirement = await prisma.requirement.create({
        data: { frameworkId: base.id, code: `TEST-PIC-${suffix}`, section: "Test", title: "Test", text: "t", mappings: { create: [{ controlId: control.id, coverage: "FULL" }] } },
      });

      try {
        const draft = await makeSystem(owner.id, "draft", { deploymentFacets: { connect: [{ id: facet.id }] } });
        const rejected = await makeSystem(owner.id, "rejected");
        const round = await prisma.reviewRound.create({ data: { systemId: rejected.id } });
        await prisma.approval.create({ data: { systemId: rejected.id, reviewRoundId: round.id, approverId: reviewer.id, decision: "REJECTED" } });
        const inReview = await makeSystem(owner.id, "in review", { status: "IN_REVIEW" });
        const onboarded = await makeSystem(owner.id, "onboarded", { status: "ONBOARDED" });

        const before = expectType((await roleView(owner)).picture, "pipeline");
        const stageOf = (picture: Pic<"pipeline">, id: string) => picture.items.find((item) => item.id === id)?.stage;
        expect(stageOf(before, draft.id)).toBe(0);
        expect(stageOf(before, rejected.id)).toBe(0);
        expect(stageOf(before, inReview.id)).toBe(1);
        expect(stageOf(before, onboarded.id)).toBe(3);
        expect(before.stages).toEqual(["Draft", "In review", "Approved", "Onboarded"]);
        expect(before.items.find((item) => item.id === rejected.id)?.flag).toBe("Rejected");
        expect(before.items.find((item) => item.id === draft.id)?.href).toBe(`/systems/${draft.id}`);
        expect(before.items).toHaveLength(4);
        const pctBefore = before.items.find((item) => item.id === draft.id)?.pct;
        expect(pctBefore).not.toBeNull();

        // Touching the one fixture Control the draft gets from its facet raises % assessed.
        await prisma.controlAssessment.create({ data: { systemId: draft.id, controlId: control.id, status: "IN_PROGRESS" } });
        const after = expectType((await roleView(owner)).picture, "pipeline");
        const pctAfter = after.items.find((item) => item.id === draft.id)?.pct as number;
        expect(pctAfter).toBeGreaterThan(pctBefore as number);
        expect(pctAfter).toBeLessThanOrEqual(100);
      } finally {
        await prisma.requirement.delete({ where: { id: requirement.id } });
      }
    });

    it("shows only the Systems the user owns", async () => {
      const owner = await makeUser("pipeline-stranger", "SYSTEM_OWNER");
      const other = await makeUser("pipeline-other", "SYSTEM_OWNER");
      await makeSystem(other.id, "not mine");
      const picture = expectType((await roleView(owner)).picture, "pipeline");
      expect(picture.items).toEqual([]);
    });
  });

  describe("Reviewer: how long each review has waited", () => {
    it("draws a bar per System awaiting review, in days since its latest Review Round was submitted", async () => {
      const owner = await makeUser("wait-owner", "SYSTEM_OWNER");
      const reviewer = await makeUser("wait-reviewer", "REVIEWER");
      const waiting = await makeSystem(owner.id, "waiting", { status: "IN_REVIEW" });
      await prisma.reviewRound.create({ data: { systemId: waiting.id, submittedAt: new Date(Date.now() - 40 * DAY) } });
      await prisma.reviewRound.create({ data: { systemId: waiting.id, submittedAt: new Date(Date.now() - 10 * DAY - 3_600_000) } });

      const view = await roleView(reviewer);
      const picture = expectType(view.picture, "bars");
      expect(picture.target).toBe(7);
      expect(picture.unit).toBe("d");
      expect(picture.items.find((item) => item.id === waiting.id)).toMatchObject({ name: waiting.name, value: 10, href: `/systems/${waiting.id}` });
      const oldest = view.stats.find((stat) => stat.label === "Oldest waiting");
      expect(oldest).toMatchObject({ tone: "danger" });
      expect(parseInt(String(oldest?.value))).toBeGreaterThanOrEqual(10);
      // The trend of "Awaiting review" counts the review from the week it was submitted: 2 weeks back, not 3 weeks back.
      const trend = view.stats.find((stat) => stat.label === "Awaiting review")?.trend as number[];
      expect(trend).toHaveLength(7);
      expect(trend[trend.length - 1]).toBeGreaterThanOrEqual(1);
      expect(view.tasks.find((task) => task.id === waiting.id)).toMatchObject({ lane: "you", action: "Review", kind: "System" });
    });
  });

  describe("Risk Owner: open Risks by likelihood and severity", () => {
    it("counts an open Risk in the cell of its likelihood and severity, and not a closed one", async () => {
      const riskOwner = await makeUser("heat-owner", "RISK_OWNER");
      const system = await makeSystem(riskOwner.id, "heat");
      const cell = (picture: Pic<"heat">) => picture.cells[0][3]; // likelihood Critical, severity Critical
      const before = cell(expectType((await roleView(riskOwner)).picture, "heat"));
      const open = await prisma.risk.create({ data: { systemId: system.id, title: `Test Pic open ${suffix}`, description: "d", severity: "CRITICAL", likelihood: "CRITICAL" } });
      const closed = await prisma.risk.create({ data: { systemId: system.id, title: `Test Pic closed ${suffix}`, description: "d", severity: "CRITICAL", likelihood: "CRITICAL", status: "CLOSED" } });
      riskIds.push(open.id, closed.id);

      const view = await roleView(riskOwner);
      expect(cell(expectType(view.picture, "heat"))).toBeGreaterThanOrEqual(before + 1);
      expect(view.tasks.find((task) => task.id === open.id)).toMatchObject({ kind: "Risk", status: "Critical", lane: "you", action: "Update" });
      expect(view.tasks.some((task) => task.id === closed.id)).toBe(false);
      expect(view.stats.find((stat) => stat.label === "Critical")).toMatchObject({ tone: "danger" });
    });
  });

  describe("Business Risk Owner: the portfolio in scope", () => {
    it("draws exactly the Systems of the assigned Business Unit by status, with open Risks, and names the scope", async () => {
      const unit = await prisma.businessUnit.create({ data: { name: `Test Pic Unit ${suffix}` } });
      businessUnitIds.push(unit.id);
      const bro = await makeUser("portfolio-bro", "BUSINESS_RISK_OWNER", { businessUnitScopes: { connect: [{ id: unit.id }] } });
      const owner = await makeUser("portfolio-owner", "SYSTEM_OWNER");
      const onboarded = await makeSystem(owner.id, "portfolio onboarded", { status: "ONBOARDED", businessUnits: { connect: [{ id: unit.id }] } });
      const draft = await makeSystem(owner.id, "portfolio draft", { businessUnits: { connect: [{ id: unit.id }] } });
      await makeSystem(owner.id, "outside the scope");
      const risk = await prisma.risk.create({ data: { systemId: onboarded.id, title: `Test Pic bro risk ${suffix}`, description: "d", severity: "HIGH", likelihood: "LOW" } });
      riskIds.push(risk.id);

      const view = await roleView(bro);
      const picture = expectType(view.picture, "portfolio");
      expect(picture.items.map((item) => item.id).sort()).toEqual([draft.id, onboarded.id].sort());
      expect(picture.items.find((item) => item.id === onboarded.id)).toMatchObject({ stage: 3, risks: 1 });
      expect(picture.items.find((item) => item.id === draft.id)).toMatchObject({ stage: 0, risks: 0 });
      for (const item of picture.items) expect(item.pct === null || (item.pct >= 0 && item.pct <= 100)).toBe(true);
      expect(view.scope).toBe(unit.name);
      expect(view.tasks.find((task) => task.id === risk.id)).toMatchObject({ action: "View", lane: "you", status: "High" });
    });

    it("has no scope chip and an empty portfolio while unassigned", async () => {
      const bro = await makeUser("portfolio-unassigned", "BUSINESS_RISK_OWNER");
      const view = await roleView(bro);
      expect(view.scope).toBeUndefined();
      expect(expectType(view.picture, "portfolio").items).toEqual([]);
    });
  });

  describe("Compliance Manager: Framework coverage rings", () => {
    it("shows the share of a Framework's Requirements that a Full mapping covers", async () => {
      const manager = await makeUser("rings-manager", "COMPLIANCE_MANAGER");
      const framework = await createFixtureFramework("home-rings");
      const control = await prisma.control.create({
        data: { code: `TEST-PIC-RING-${suffix}`, title: `Test Pic ring Control ${suffix}`, description: "d", category: "Security", applicability: "ORGANIZATIONAL" },
      });
      controlIds.push(control.id);
      await mapControlsToFramework(framework.id, [control.id]);
      await mapControlsToFramework(framework.id, []);
      await mapControlsToFramework(framework.id, []);
      await mapControlsToFramework(framework.id, []);

      const picture = expectType(await loadFrameworkRingsPicture(manager, 500), "rings");
      const ring = picture.items.find((item) => item.id === framework.id);
      expect(ring).toMatchObject({ value: 25, href: `/frameworks/${framework.id}/coverage`, name: frameworkLabel(framework) });
      expect(expectType((await roleView(manager)).picture, "rings").items.length).toBeLessThanOrEqual(8);
    });

    it("leaves out a Draft Framework for a role that cannot see Drafts", async () => {
      const draft = await prisma.framework.create({ data: { name: `Test Pic draft Framework ${suffix}`, version: "1", status: "DRAFT" } });
      const requirement = await prisma.requirement.create({ data: { frameworkId: draft.id, code: "R1", section: "Test", title: "t", text: "t" } });
      try {
        const manager = await makeUser("rings-draft-manager", "COMPLIANCE_MANAGER");
        const auditor = await makeUser("rings-draft-auditor", "INTERNAL_AUDITOR");
        expect(expectType(await loadFrameworkRingsPicture(manager, 500), "rings").items.some((item) => item.id === draft.id)).toBe(true);
        expect(expectType(await loadFrameworkRingsPicture(auditor, 500), "rings").items.some((item) => item.id === draft.id)).toBe(false);
      } finally {
        await prisma.requirement.delete({ where: { id: requirement.id } });
        await prisma.framework.delete({ where: { id: draft.id } });
      }
    });
  });

  describe("Internal Auditor: launched audits by Check-up state, and one task per own audit", () => {
    it("counts each Check-up state and turns the user's own audits into rows", async () => {
      const scenario = await createCheckUpScenario("home-audit", { systemControls: 3, organizationControls: 1 });
      try {
        const auditorId = scenario.roleUser.INTERNAL_AUDITOR;
        const [evaluated, toEvaluate, withdrawn] = ["SYS1", "SYS2", "SYS3"].map((n) => scenario.find(`TEST-home-audit-${n}-${scenario.suffix}`));
        await scenario.answer(evaluated.id, scenario.systemOwner);
        await prisma.checkUpEvaluation.create({ data: { checkUpId: evaluated.id, outcome: "CONFORMING", evaluatedById: auditorId } });
        await scenario.answer(toEvaluate.id, scenario.systemOwner);
        await prisma.checkUpWithdrawal.create({ data: { checkUpId: withdrawn.id, reason: "Out of scope", withdrawnById: auditorId } });
        const draftId = await createInternalAudit(
          { title: `Test Pic draft audit ${scenario.suffix}`, dueDate: "2031-01-01", includeOrganization: false, controlIds: [], systemIds: [] },
          auditorId,
        ).catch(() => null);

        const auditor = { id: auditorId, name: "A", role: "INTERNAL_AUDITOR" as const };
        const view = await roleView(auditor);
        const picture = expectType(view.picture, "audits");
        const bar = picture.items.find((item) => item.id === scenario.auditId);
        // [evaluated, to evaluate, not answered, withdrawn]: the Organization Check-up is unanswered.
        expect(bar).toMatchObject({ name: scenario.auditTitle, parts: [1, 1, 1, 1], href: `/internal-audits/${scenario.auditId}` });
        expect(picture.legend.map((entry) => entry.label)).toEqual(["Evaluated", "To evaluate", "Not answered", "Withdrawn"]);

        const row = view.tasks.find((task) => task.id === `${scenario.auditId}:audit`);
        expect(row).toMatchObject({ kind: "Audit", status: "1 to evaluate", lane: "you", action: "Evaluate next", href: `/internal-audits/${scenario.auditId}` });
        // Only the auditor's own audits are rows: another auditor's launched audit is not.
        const second = await roleView({ id: scenario.secondAuditor, name: "B", role: "INTERNAL_AUDITOR" });
        expect(second.tasks.some((task) => task.id === `${scenario.auditId}:audit`)).toBe(false);
        expect(expectType(second.picture, "audits").items.some((item) => item.id === scenario.auditId)).toBe(true);

        if (draftId) {
          expect(view.tasks.find((task) => task.id === `${draftId}:audit`)).toMatchObject({ status: "Draft", lane: "soon", action: "Continue draft" });
        }

        // Evaluate the answered one: nothing left to evaluate, only the owners' answers.
        await prisma.checkUpEvaluation.create({ data: { checkUpId: toEvaluate.id, outcome: "CONFORMING", evaluatedById: auditorId } });
        const later = await roleView(auditor);
        expect(later.tasks.find((task) => task.id === `${scenario.auditId}:audit`)).toMatchObject({ status: "Waiting on owners", lane: "waiting", action: "View" });
      } finally {
        await scenario.cleanup();
      }
    });
  });

  describe("Admin: users by role", () => {
    it("draws a bar per role that has users, adding up to the Users figure", async () => {
      await makeUser("admin-users-a", "VIEWER");
      const admin = await makeUser("admin-users-b", "ADMIN");
      const view = await roleView(admin);
      const picture = expectType(view.picture, "bars");
      const users = view.stats.find((stat) => stat.label === "Users");
      expect(picture.items.reduce((sum, item) => sum + item.value, 0)).toBe(users?.value);
      expect(picture.items.find((item) => item.name === "Viewer")?.value).toBeGreaterThanOrEqual(1);
      expect(picture.items.find((item) => item.name === "Admin")?.value).toBeGreaterThanOrEqual(1);
      expect(picture.note).toBe(`${users?.value} users`);
      const values = picture.items.map((item) => item.value);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    });
  });

  describe("Viewer: Onboarded Systems by Business Unit", () => {
    it("groups Onboarded Systems under their Business Unit, the ones with none last, and leaves out the rest", async () => {
      const unit = await prisma.businessUnit.create({ data: { name: `Test Pic Viewer Unit ${suffix}` } });
      businessUnitIds.push(unit.id);
      const viewer = await makeUser("mosaic-viewer", "VIEWER");
      const owner = await makeUser("mosaic-owner", "SYSTEM_OWNER");
      const inUnit = await makeSystem(owner.id, "mosaic in unit", { status: "ONBOARDED", businessUnits: { connect: [{ id: unit.id }] } });
      const noUnit = await makeSystem(owner.id, "mosaic no unit", { status: "ONBOARDED" });
      const draft = await makeSystem(owner.id, "mosaic draft", { businessUnits: { connect: [{ id: unit.id }] } });

      const picture = expectType((await roleView(viewer)).picture, "mosaic");
      const group = picture.groups.find((g) => g.name === unit.name);
      expect(group?.items).toEqual([{ id: inUnit.id, name: inUnit.name, href: `/systems/${inUnit.id}` }]);
      const none = picture.groups.find((g) => g.name === "No Business Unit");
      expect(none?.items.some((item) => item.id === noUnit.id)).toBe(true);
      expect(picture.groups[picture.groups.length - 1].name).toBe("No Business Unit");
      expect(picture.groups.flatMap((g) => g.items).some((item) => item.id === draft.id)).toBe(false);
    });
  });

  describe("lanes in the role view", () => {
    it("puts an owned System that is In Review in 'Waiting on others'", async () => {
      const owner = await makeUser("lane-owner", "SYSTEM_OWNER");
      const system = await makeSystem(owner.id, "lane in review", { status: "IN_REVIEW" });
      const view = await roleView(owner);
      expect(view.tasks.find((task) => task.id === `${system.id}:in-review`)).toMatchObject({ lane: "waiting", status: "In review", action: "View", kind: "System" });

      // A strictly read-only role gets no owner rows.
      const manager = await makeUser("lane-manager", "COMPLIANCE_MANAGER");
      const managed = await makeSystem(manager.id, "lane manager in review", { status: "IN_REVIEW" });
      expect((await roleView(manager)).tasks.some((task) => task.id === `${managed.id}:in-review`)).toBe(false);
    });

    it("gives every task a lane, days or none, an action and a link", async () => {
      const owner = await makeUser("lane-all", "SYSTEM_OWNER");
      const system = await makeSystem(owner.id, "lane rejected");
      const reviewer = await makeUser("lane-all-reviewer", "REVIEWER");
      const round = await prisma.reviewRound.create({ data: { systemId: system.id } });
      await prisma.approval.create({ data: { systemId: system.id, reviewRoundId: round.id, approverId: reviewer.id, decision: "REJECTED" } });
      const view = await roleView(owner);
      expect(view.tasks.length).toBeGreaterThan(0);
      for (const task of view.tasks) {
        expect(["you", "waiting", "soon"]).toContain(task.lane);
        expect(task.days === null || task.days >= 0).toBe(true);
        expect(task.action).toBeTruthy();
        expect(task.href).toMatch(/^\//);
      }
      expect(view.tasks.find((task) => task.id === `${system.id}:rejected`)).toMatchObject({ lane: "you", action: "Fix and resubmit", status: "Rejected" });
    });
  });
});
