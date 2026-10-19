import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { addQueryMessage, raiseQuery, resolveQuery, NAMED } from "../assessment-queries";
import { getOwnerTasks, mergeTaskRows } from "../owner-tasks";

const OWNING_ROLES: UserRole[] = [
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "VIEWER",
  "ADMIN",
  "BUSINESS_RISK_OWNER",
];

function row(id: string, status = "x"): TaskRow {
  return { id, kind: "System", title: id, tone: "accent", status, href: `/systems/${id}` };
}

describe("mergeTaskRows", () => {
  it("puts owner rows first, then the role's own rows in their existing order", () => {
    expect(mergeTaskRows([row("o1"), row("o2")], [row("r1"), row("r2")]).map((r) => r.id)).toEqual([
      "o1",
      "o2",
      "r1",
      "r2",
    ]);
  });

  it("drops a role row whose id is already an owner row, keeping the owner's version", () => {
    const merged = mergeTaskRows([row("q1", "Awaiting your reply")], [row("q1", "Your turn"), row("q2")]);
    expect(merged.map((r) => [r.id, r.status])).toEqual([
      ["q1", "Awaiting your reply"],
      ["q2", "x"],
    ]);
  });

  it("returns the role rows unchanged when there are no owner rows", () => {
    const roleRows = [row("r1"), row("r2")];
    expect(mergeTaskRows([], roleRows)).toEqual(roleRows);
  });
});

describe("getOwnerTasks", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userIds: Record<string, string> = {};
  const emails: string[] = [];
  const systemIds: string[] = [];
  let approverId: string;
  let controlId: string;
  /** Each owning role's one rejected Draft System. */
  const rejectedSystemByRole: Record<string, string> = {};

  async function makeUser(key: string, role: UserRole) {
    const email = `test-owner-tasks-${key}-${suffix}@example.com`;
    emails.push(email);
    const user = await prisma.user.create({ data: { email, name: `Test Owner Tasks ${key}`, role } });
    userIds[key] = user.id;
    return user;
  }

  async function makeSystem(ownerId: string, name: string, status: "DRAFT" | "IN_REVIEW" = "DRAFT") {
    const system = await prisma.system.create({ data: { name: `Test ${name} ${suffix}`, ownerId, status } });
    systemIds.push(system.id);
    return system;
  }

  beforeAll(async () => {
    approverId = (await makeUser("approver", "REVIEWER")).id;
    // Unmapped, so it applies to no System; only here so an Assessment (and a Query on it) can exist.
    const control = await prisma.control.create({
      data: {
        code: `TEST-OT-${suffix}`,
        title: `Test owner tasks Control ${suffix}`,
        description: "desc",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      },
    });
    controlId = control.id;

    for (const role of [...OWNING_ROLES, "COMPLIANCE_MANAGER" as const, "INTERNAL_AUDITOR" as const]) {
      const user = await makeUser(role, role);
      // A rejected Draft is the cheapest "needs attention" System: no Controls involved.
      const system = await makeSystem(user.id, `rejected ${role}`);
      rejectedSystemByRole[role] = system.id;
      await prisma.approval.create({ data: { systemId: system.id, reviewRoundId: (await prisma.reviewRound.create({ data: { systemId: system.id } })).id, approverId, decision: "REJECTED" } });
    }
    await makeUser("none-viewer", "VIEWER");
    await makeUser("none-admin", "ADMIN");
    await makeUser("none-reviewer", "REVIEWER");
  });

  afterAll(async () => {
    await prisma.assessmentQuery.deleteMany({ where: { controlAssessment: { systemId: { in: systemIds } } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.approval.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
  });

  it.each(OWNING_ROLES)("gives an owning %s the rows for the Systems they own", async (role) => {
    const tasks = await getOwnerTasks({ id: userIds[role], role });
    expect(tasks.ownedCount).toBe(1);
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0]).toMatchObject({
      id: `${rejectedSystemByRole[role]}:rejected`,
      kind: "System",
      status: "Rejected",
      href: `/systems/${rejectedSystemByRole[role]}`,
    });
    expect(tasks.needingAttentionCount).toBe(1);
    expect(tasks.openQuestionCount).toBe(0);
  });

  it("never includes a System someone else owns", async () => {
    const tasks = await getOwnerTasks({ id: userIds["REVIEWER"], role: "REVIEWER" });
    const ids = tasks.rows.map((r) => r.id);
    expect(ids).not.toContain(`${rejectedSystemByRole["VIEWER"]}:rejected`);
    expect(ids).not.toContain(`${rejectedSystemByRole["SYSTEM_OWNER"]}:rejected`);
  });

  it.each([
    ["VIEWER", "none-viewer"],
    ["ADMIN", "none-admin"],
    ["REVIEWER", "none-reviewer"],
  ] as const)("gives %s who owns no System nothing (an ADMIN's rights are not ownership)", async (role, key) => {
    expect(await getOwnerTasks({ id: userIds[key], role })).toEqual({
      ownedCount: 0,
      rows: [],
      needingAttentionCount: 0,
      openQuestionCount: 0,
    });
  });

  it("gives a COMPLIANCE_MANAGER nothing, even though they are recorded as a System's owner", async () => {
    const tasks = await getOwnerTasks({ id: userIds["COMPLIANCE_MANAGER"], role: "COMPLIANCE_MANAGER" });
    expect(tasks).toEqual({ ownedCount: 0, rows: [], needingAttentionCount: 0, openQuestionCount: 0 });
  });

  it("gives an INTERNAL_AUDITOR nothing, even though they are recorded as a System's owner (#147)", async () => {
    const tasks = await getOwnerTasks({ id: userIds["INTERNAL_AUDITOR"], role: "INTERNAL_AUDITOR" });
    expect(tasks).toEqual({ ownedCount: 0, rows: [], needingAttentionCount: 0, openQuestionCount: 0 });
  });

  describe("Queries awaiting the owner's reply", () => {
    it.each(["REVIEWER", "RISK_OWNER", "VIEWER"] as const)(
      "uses owner-side semantics for an owning %s: only Queries whose latest message isn't theirs",
      async (role) => {
        const system = await makeSystem(userIds[role], `queries ${role}`);

        // Raised by the approver (reviewer side): awaiting the owner's reply.
        const awaitingOwner = await raiseQuery(system, controlId, approverId, "Please explain", NAMED);
        const tasks = await getOwnerTasks({ id: userIds[role], role });
        const queryRow = tasks.rows.find((r) => r.id === awaitingOwner.id);
        expect(queryRow).toMatchObject({
          kind: "Query",
          status: "Awaiting your reply",
          subtitle: system.name,
          href: `/systems/${system.id}`,
        });
        expect(tasks.openQuestionCount).toBe(1);

        // Once the owner replies it's the reviewer side's turn, so it isn't the owner's task any more.
        await addQueryMessage(awaitingOwner.id, userIds[role], "Here you go", NAMED);
        const afterReply = await getOwnerTasks({ id: userIds[role], role });
        expect(afterReply.rows.map((r) => r.id)).not.toContain(awaitingOwner.id);
        expect(afterReply.openQuestionCount).toBe(0);

        // A resolved Query is nobody's task.
        await addQueryMessage(awaitingOwner.id, approverId, "Another question", NAMED);
        await resolveQuery(awaitingOwner.id, approverId, NAMED);
        const afterResolve = await getOwnerTasks({ id: userIds[role], role });
        expect(afterResolve.rows.map((r) => r.id)).not.toContain(awaitingOwner.id);
      },
    );

    it("does not list Queries on Systems the user doesn't own, even for a role that can act on them", async () => {
      const otherSystem = await makeSystem(userIds["VIEWER"], "queries elsewhere");
      // The owning REVIEWER's turn would be "the owner has replied" on someone else's System.
      const query = await raiseQuery(otherSystem, controlId, approverId, "Question", NAMED);
      await addQueryMessage(query.id, userIds["VIEWER"], "Answer", NAMED);
      const tasks = await getOwnerTasks({ id: userIds["REVIEWER"], role: "REVIEWER" });
      expect(tasks.rows.map((r) => r.id)).not.toContain(query.id);
    });
  });
});
