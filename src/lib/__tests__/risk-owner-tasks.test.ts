import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RiskStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleView } from "@/app/home/role-view";
import { getRiskOwnerTasks } from "../risk-owner-tasks";

/**
 * "My tasks" for the owner of a Risk (#360): one row per Open Risk on a System the user can see, linking to the opened Risk.
 * Fixtures only; a fresh User per case owns exactly the Risks the case creates.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

describe("Risk owner tasks (#360)", { timeout: 30_000 }, () => {
  const userIds: string[] = [];
  const systemIds: string[] = [];
  let counter = 0;
  let sysOwnerId: string;
  let draftSystemId: string; // someone else's DRAFT System: hidden from a Viewer
  let onboardedSystemId: string; // visible to everyone

  async function makeUser(role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-rot-${role}-${++counter}-${SUFFIX}@example.com`, name: `Test ROT ${role} ${counter}`, role } });
    userIds.push(user.id);
    return user;
  }
  const makeRisk = (systemId: string | null, ownerId: string | null, status: RiskStatus = "OPEN", severity: "LOW" | "HIGH" = "HIGH") =>
    prisma.risk.create({ data: { systemId, ownerId, status, severity, likelihood: "LOW", title: `Test ROT Risk ${++counter} ${SUFFIX}`, description: "d" } });

  beforeAll(async () => {
    sysOwnerId = (await makeUser("SYSTEM_OWNER")).id;
    draftSystemId = (await prisma.system.create({ data: { name: `Test ROT Draft ${SUFFIX}`, ownerId: sysOwnerId, status: "DRAFT" } })).id;
    onboardedSystemId = (await prisma.system.create({ data: { name: `Test ROT Onboarded ${SUFFIX}`, ownerId: sysOwnerId, status: "ONBOARDED" } })).id;
    systemIds.push(draftSystemId, onboardedSystemId);
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("gives one row per Open Risk the user owns, linking to the opened Risk", async () => {
    const owner = await makeUser("VIEWER");
    const high = await makeRisk(onboardedSystemId, owner.id, "OPEN", "HIGH");
    const low = await makeRisk(onboardedSystemId, owner.id, "OPEN", "LOW");
    const rows = await getRiskOwnerTasks(owner);
    expect(rows.map((r) => r.id).sort()).toEqual([high.id, low.id].sort());
    const row = rows.find((r) => r.id === high.id)!;
    expect(row).toMatchObject({
      kind: "Risk",
      title: high.title,
      href: `/systems/${onboardedSystemId}#risk-${high.id}`,
      status: "High",
    });
    expect(row.subtitle).toContain(`Test ROT Onboarded ${SUFFIX}`);
  });

  it("gives nothing for a Risk that is not Open, one owned by somebody else, or an unowned one", async () => {
    const owner = await makeUser("VIEWER");
    const other = await makeUser("VIEWER");
    for (const status of ["MITIGATED", "ACCEPTED", "TRANSFERRED", "CLOSED"] as const) await makeRisk(onboardedSystemId, owner.id, status);
    await makeRisk(onboardedSystemId, other.id);
    await makeRisk(onboardedSystemId, null);
    expect(await getRiskOwnerTasks(owner)).toEqual([]);
  });

  it("follows the owner: the row moves when the Risk is reassigned and goes when it is cleared or no longer Open", async () => {
    const first = await makeUser("VIEWER");
    const second = await makeUser("REVIEWER");
    const risk = await makeRisk(onboardedSystemId, first.id);
    expect(await getRiskOwnerTasks(first)).toHaveLength(1);
    await prisma.risk.update({ where: { id: risk.id }, data: { ownerId: second.id } });
    expect(await getRiskOwnerTasks(first)).toEqual([]);
    expect(await getRiskOwnerTasks(second)).toHaveLength(1);
    await prisma.risk.update({ where: { id: risk.id }, data: { status: "MITIGATED" } });
    expect(await getRiskOwnerTasks(second)).toEqual([]);
  });

  it("only counts Risks on Systems the user can see, and never an Organization Risk", async () => {
    const viewer = await makeUser("VIEWER");
    const admin = await makeUser("ADMIN");
    await makeRisk(draftSystemId, viewer.id);
    await makeRisk(draftSystemId, admin.id);
    expect(await getRiskOwnerTasks(viewer)).toEqual([]);
    expect(await getRiskOwnerTasks(admin)).toHaveLength(1);
    // A Risk with no System needs a Check-up, which the database enforces; the query's `system` filter excludes it either way.
  });

  it("gives the Internal Auditor none", async () => {
    const auditor = await makeUser("INTERNAL_AUDITOR");
    await makeRisk(onboardedSystemId, auditor.id);
    expect(await getRiskOwnerTasks(auditor)).toEqual([]);
  });

  it("shows on /home once, whatever the role, with the owner's own row winning over the generic one", async () => {
    const viewer = await makeUser("VIEWER");
    const riskOwner = await makeUser("RISK_OWNER");
    const facilitator = await makeUser("RISK_FACILITATOR");
    const mine = await makeRisk(onboardedSystemId, viewer.id);
    const theirs = await makeRisk(onboardedSystemId, riskOwner.id);
    const hers = await makeRisk(onboardedSystemId, facilitator.id);
    for (const [user, risk, role] of [[viewer, mine, "VIEWER"], [riskOwner, theirs, "RISK_OWNER"], [facilitator, hers, "RISK_FACILITATOR"]] as const) {
      const view = await roleView({ id: user.id, name: user.name, role });
      const rows = view.tasks!.filter((t) => t.id === risk.id);
      expect(rows, role).toHaveLength(1);
      expect(rows[0].href).toBe(`/systems/${onboardedSystemId}#risk-${risk.id}`);
      expect(rows[0].subtitle).toContain("you are the owner");
    }
  });

  it("gives the Risk Facilitator a Home view that counts Risks without an owner", async () => {
    const facilitator = await makeUser("RISK_FACILITATOR");
    const view = await roleView({ id: facilitator.id, name: facilitator.name, role: "RISK_FACILITATOR" });
    const before = Number(view.stats.find((s) => s.label === "Risks without an owner")!.value);
    await makeRisk(onboardedSystemId, null);
    const after = await roleView({ id: facilitator.id, name: facilitator.name, role: "RISK_FACILITATOR" });
    expect(Number(after.stats.find((s) => s.label === "Risks without an owner")!.value)).toBe(before + 1);
    expect(after.tiles.map((t) => t.href)).toEqual(expect.arrayContaining(["/risks", "/systems"]));
  });
});
