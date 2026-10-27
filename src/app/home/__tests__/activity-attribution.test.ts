import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadSystemPage } from "@/app/systems/[id]/system-page-data";
import { loadRecentActivity } from "../home-activity";

/**
 * Home's Recent activity hides the person behind a Review Step decision or a Query from those who may not
 * see them, exactly as the System page does (#251). Own `Test #251 ...` fixtures: one Onboarded System
 * with four attributed events (a Query raised by a Reviewer, a reply by a Review Group member, and the
 * base step's and the group's Approval decisions).
 */
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const suffix = `${process.pid}-${Date.now()}`;
type Fixture = { id: string; name: string; role: UserRole };
const created: Fixture[] = [];
const makeUser = async (key: string, role: UserRole): Promise<Fixture> => {
  const row = await prisma.user.create({ data: { email: `test-251-${key}-${suffix}@example.com`, name: `Test #251 ${key}`, role } });
  const fixture = { id: row.id, name: row.name, role };
  created.push(fixture);
  return fixture;
};

let owner: Fixture, reviewer: Fixture, member: Fixture, admin: Fixture, manager: Fixture, outsider: Fixture;
let groupId: string, groupName: string, systemId: string;
const eventIds: Record<"query" | "reply" | "base" | "group", string> = { query: "", reply: "", base: "", group: "" };
// In the future of any real-time event, but below activity.test.ts's (+600s), so our 4 events can't crowd out its 4 in the newest 8.
const start = Date.now() + 300_000;
const now = new Date(start + 60_000);

beforeAll(async () => {
  owner = await makeUser("owner", "SYSTEM_OWNER");
  reviewer = await makeUser("reviewer", "REVIEWER");
  member = await makeUser("member", "SYSTEM_OWNER");
  admin = await makeUser("admin", "ADMIN");
  manager = await makeUser("manager", "COMPLIANCE_MANAGER");
  outsider = await makeUser("outsider", "SYSTEM_OWNER");
  groupName = `Test #251 Group ${suffix}`;
  groupId = (await prisma.reviewGroup.create({ data: { name: groupName, members: { connect: { id: member.id } } } })).id;
  systemId = (await prisma.system.create({ data: { name: `Test #251 System ${suffix}`, ownerId: owner.id, status: "ONBOARDED" } })).id;
  const round = await prisma.reviewRound.create({ data: { systemId } });
  const decidedAt = start + 2000;
  await prisma.approval.createMany({
    data: [
      { systemId, reviewRoundId: round.id, reviewGroupId: null, approverId: reviewer.id, decision: "APPROVED", comment: "c", decidedAt: new Date(decidedAt) },
      { systemId, reviewRoundId: round.id, reviewGroupId: groupId, approverId: member.id, decision: "APPROVED", comment: "c", decidedAt: new Date(decidedAt + 1000) },
    ],
  });
  const rows = [
    ["query", "QUERY_OPENED", 'Query raised: "Test #251 q"', reviewer.id],
    ["reply", "QUERY_REPLIED", 'Reply: "Test #251 r"', member.id],
    ["base", "APPROVAL_DECIDED", "Base review: Approved: c", reviewer.id],
    ["group", "APPROVAL_DECIDED", `${groupName}: Approved: c`, member.id],
  ] as const;
  for (const [index, [key, action, detail, actorId]] of rows.entries()) {
    eventIds[key] = (await prisma.changeEvent.create({ data: { systemId, action, detail, actorId, createdAt: new Date(start + index * 1000) } })).id;
  }
});

afterAll(async () => {
  await prisma.changeEvent.deleteMany({ where: { systemId } });
  await prisma.system.deleteMany({ where: { id: systemId } });
  await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
  await prisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
});

const KEYS = ["query", "reply", "base", "group"] as const;
const onHome = async (u: Fixture) => {
  const items = await loadRecentActivity({ id: u.id, role: u.role }, now);
  return Object.fromEntries(KEYS.map((key) => [key, items.find((item) => item.id === eventIds[key])?.who]));
};
const onPage = async (u: Fixture) => {
  const activity = (await loadSystemPage({ id: u.id, role: u.role, name: u.name }, systemId))!.view.activity;
  return Object.fromEntries(KEYS.map((key) => [key, activity.find((item) => item.id === eventIds[key])?.who]));
};

describe("Home Recent activity attribution (#251)", () => {
  it("shows the System's owner no person behind a Query or an Approval decision, only the step or 'A reviewer'", async () => {
    const who = await onHome(owner);
    expect(who).toEqual({ query: "A reviewer", reply: "A reviewer", base: "Base review", group: groupName });
    expect(Object.values(who).join("|")).not.toContain(reviewer.name);
    expect(Object.values(who).join("|")).not.toContain(member.name);
  });

  it("shows a Reviewer the base step's decider and not the group's", async () => {
    expect(await onHome(reviewer)).toEqual({ query: "You", reply: "A reviewer", base: "You", group: groupName });
    const other = await makeUser("reviewer2", "REVIEWER");
    expect(await onHome(other)).toEqual({ query: "A reviewer", reply: "A reviewer", base: reviewer.name, group: groupName });
  });

  it("shows a Review Group's member the group's decider and not the base step's", async () => {
    expect(await onHome(member)).toEqual({ query: "A reviewer", reply: "You", base: "Base review", group: "You" });
  });

  it("shows an Admin and a Compliance Manager everyone by name", async () => {
    const named = { query: reviewer.name, reply: member.name, base: reviewer.name, group: member.name };
    expect(await onHome(admin)).toEqual(named);
    expect(await onHome(manager)).toEqual(named);
  });

  it("shows another System Owner the steps, not the people", async () => {
    expect(await onHome(outsider)).toEqual({ query: "A reviewer", reply: "A reviewer", base: "Base review", group: groupName });
  });

  it.each(["owner", "reviewer", "member", "admin", "manager", "outsider"] as const)("reads the same on Home as on the System page for the %s", async (key) => {
    const u = { owner, reviewer, member, admin, manager, outsider }[key];
    expect(await onHome(u)).toEqual(await onPage(u));
  });
});
