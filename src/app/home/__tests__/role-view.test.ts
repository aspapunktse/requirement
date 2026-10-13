import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { raiseQuery } from "@/lib/assessment-queries";
import { roleView } from "../role-view";

describe("roleView: owner tasks for any role (#98)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const emails: string[] = [];
  const systemIds: string[] = [];
  let approverId: string;
  let controlId: string;

  async function makeUser(key: string, role: UserRole) {
    const email = `test-home-owner-${key}-${suffix}@example.com`;
    emails.push(email);
    return prisma.user.create({ data: { email, name: `Test Home ${key}`, role } });
  }

  async function makeSystem(ownerId: string, name: string, status: "DRAFT" | "IN_REVIEW" = "DRAFT") {
    const system = await prisma.system.create({ data: { name: `Test Home ${name} ${suffix}`, ownerId, status } });
    systemIds.push(system.id);
    return system;
  }

  /** A rejected Draft owned by `ownerId`, plus a Query on it awaiting the owner's reply. */
  async function ownedSystemWithQuery(ownerId: string, name: string) {
    const system = await makeSystem(ownerId, name);
    await prisma.approval.create({ data: { systemId: system.id, approverId, decision: "REJECTED" } });
    const query = await raiseQuery(system, controlId, approverId, "Please explain");
    return { system, query };
  }

  const ids = (view: { tasks?: { id: string }[] }) => (view.tasks ?? []).map((t) => t.id);
  const labels = (view: { stats: { label: string }[] }) => view.stats.map((s) => s.label);

  beforeAll(async () => {
    approverId = (await makeUser("approver", "REVIEWER")).id;
    const control = await prisma.control.create({
      data: {
        code: `TEST-HOME-${suffix}`,
        title: `Test home Control ${suffix}`,
        description: "desc",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      },
    });
    controlId = control.id;
  });

  afterAll(async () => {
    await prisma.assessmentQuery.deleteMany({ where: { controlAssessment: { systemId: { in: systemIds } } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it("shows an owning REVIEWER the owner rows first, then their own, with each Query once", async () => {
    const reviewer = await makeUser("reviewer", "REVIEWER");
    const { system, query } = await ownedSystemWithQuery(reviewer.id, "reviewer-owned");
    // The REVIEWER's own task: someone else's System awaiting review.
    const otherOwner = await makeUser("reviewer-other-owner", "SYSTEM_OWNER");
    const awaiting = await makeSystem(otherOwner.id, "awaiting review", "IN_REVIEW");

    const view = await roleView(reviewer);
    const taskIds = ids(view);

    // The reviewer's all-Systems Query list also contains this Query (owner-side semantics on an owned System):
    // it must appear once, as the owner's row.
    expect(taskIds.filter((id) => id === query.id)).toHaveLength(1);
    expect(view.tasks?.find((t) => t.id === query.id)?.status).toBe("Awaiting your reply");
    expect(new Set(taskIds).size).toBe(taskIds.length);

    expect(taskIds).toContain(`${system.id}:rejected`);
    expect(taskIds).toContain(awaiting.id);
    // Owner rows come before the role's own.
    expect(taskIds.indexOf(`${system.id}:rejected`)).toBeLessThan(taskIds.indexOf(awaiting.id));
    expect(taskIds.indexOf(query.id)).toBeLessThan(taskIds.indexOf(awaiting.id));
    expect(view.tasks?.find((t) => t.id === awaiting.id)?.status).toBe("Awaiting review");

    // Role stats kept; one owner stat added; "Open questions" not repeated.
    expect(labels(view)).toEqual(["Awaiting review", "Open questions", "Your Systems needing attention"]);
    expect(view.stats.find((s) => s.label === "Your Systems needing attention")?.value).toBe(1);
    expect(view.tiles.map((t) => t.title)).toEqual(["Browse Systems", "Statement of Applicability"]);
  });

  it("creates the My tasks list for an owning VIEWER, who has none today", async () => {
    const viewer = await makeUser("viewer", "VIEWER");
    const { system, query } = await ownedSystemWithQuery(viewer.id, "viewer-owned");

    const view = await roleView(viewer);
    expect(ids(view).sort()).toEqual([`${system.id}:rejected`, query.id].sort());
    expect(labels(view)).toEqual(["Onboarded systems", "Your Systems needing attention", "Open questions"]);
    expect(view.stats.find((s) => s.label === "Open questions")?.value).toBe(1);
  });

  it("shows an owning ADMIN, RISK_OWNER and BUSINESS_RISK_OWNER the owner rows without duplicates", async () => {
    for (const role of ["ADMIN", "RISK_OWNER", "BUSINESS_RISK_OWNER"] as const) {
      const user = await makeUser(`owning-${role}`, role);
      const { system, query } = await ownedSystemWithQuery(user.id, `${role}-owned`);
      const view = await roleView(user);
      const taskIds = ids(view);
      expect(taskIds, role).toContain(`${system.id}:rejected`);
      expect(taskIds.filter((id) => id === query.id), role).toHaveLength(1);
      expect(new Set(taskIds).size, role).toBe(taskIds.length);
    }
  });

  it("leaves a user who owns no System with exactly their role view", async () => {
    // Someone else's rejected System must not leak into a non-owner's view.
    const stranger = await makeUser("stranger-owner", "SYSTEM_OWNER");
    await ownedSystemWithQuery(stranger.id, "stranger-owned");

    for (const role of ["VIEWER", "ADMIN", "REVIEWER"] as const) {
      const user = await makeUser(`none-${role}`, role);
      const view = await roleView(user);
      expect(labels(view), role).not.toContain("Your Systems needing attention");
      expect(ids(view).filter((id) => id.endsWith(":rejected")), role).toEqual([]);
    }
    const viewer = await roleView(await makeUser("none-viewer-2", "VIEWER"));
    expect(viewer.tasks).toBeUndefined();
    expect(labels(viewer)).toEqual(["Onboarded systems"]);
  });

  it("gives a COMPLIANCE_MANAGER no owner tasks even when recorded as an owner", async () => {
    const manager = await makeUser("compliance", "COMPLIANCE_MANAGER");
    await ownedSystemWithQuery(manager.id, "compliance-owned");
    const view = await roleView(manager);
    expect(view.tasks).toBeUndefined();
    expect(labels(view)).toEqual(["Controls", "Frameworks"]);
  });

  describe("SYSTEM_OWNER is unchanged", () => {
    it("shows the owner rows and the two owner stats, each row once", async () => {
      const owner = await makeUser("system-owner", "SYSTEM_OWNER");
      const { system, query } = await ownedSystemWithQuery(owner.id, "system-owner-owned");

      const view = await roleView(owner);
      expect(ids(view).sort()).toEqual([`${system.id}:rejected`, query.id].sort());
      expect(view.tasks?.find((t) => t.id === query.id)).toMatchObject({
        kind: "Query",
        status: "Awaiting your reply",
        subtitle: system.name,
      });
      expect(view.stats).toEqual([
        { label: "Needing attention", value: 1 },
        { label: "Open questions", value: 1 },
      ]);
      expect(view.tiles.map((t) => t.title)).toEqual(["Create a System", "Browse your Systems", "Statement of Applicability"]);
    });

    it("still shows an empty My tasks and zeroed stats while owning nothing", async () => {
      const owner = await makeUser("system-owner-empty", "SYSTEM_OWNER");
      const view = await roleView(owner);
      expect(view.tasks).toEqual([]);
      expect(view.stats).toEqual([
        { label: "Needing attention", value: 0 },
        { label: "Open questions", value: 0 },
      ]);
    });
  });

  describe("the Statement of Applicability tile (#145)", () => {
    const ALL_ROLES: UserRole[] = [
      "ADMIN",
      "COMPLIANCE_MANAGER",
      "SYSTEM_OWNER",
      "RISK_OWNER",
      "REVIEWER",
      "BUSINESS_RISK_OWNER",
      "VIEWER",
    ];

    it.each(ALL_ROLES)("is on the %s's home", async (role) => {
      const user = await makeUser(`soa-tile-${role}`, role);
      const tiles = (await roleView(user)).tiles.filter((t) => t.href === "/statement-of-applicability");
      expect(tiles).toHaveLength(1);
      expect(tiles[0].title).toBe("Statement of Applicability");
    });
  });
});
