import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getComplianceForSystems } from "@/lib/compliance";
import { getActionableQueryCountsBySystem } from "@/lib/assessment-queries";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as getApprovals, POST as postApproval } from "@/app/api/systems/[id]/approvals/route";
import { POST as postSubmit } from "@/app/api/systems/[id]/submit/route";
import { POST as postOnboard } from "@/app/api/systems/[id]/onboard/route";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { loadSystemPage } from "../system-page-data";
import { SOURCE_KEYS, type SourceKey } from "../system-page-types";

/**
 * The System page's server side (#243), against real Postgres with its own `Test #243 …` fixtures (CI's
 * database is migrated but not seeded; a seeded one also has unscoped Controls that apply to every System,
 * so the figures are asserted as a difference to a baseline System that has none of the fixture Controls).
 *
 *   S  Draft, owner's: Facet F1, the fixture Framework in scope, a Provider P it depends on, seven Controls:
 *        A own Fulfilled (a Query awaits the owner)   B own, mandatory, Not started   C inherited from the Organization
 *        D own, optional, Not started                 E own, Waived                    F inherited, Provider Full
 *        G Provider Shared (own half Fulfilled)
 *      four Risks (two open, one Mitigated, one Accepted) and six Change Events
 *   B  a baseline Draft with no Facet, so none of the fixture Controls apply
 *   R  In Review with an open Review Round and two Review Steps (Base review, and the fixture group's)
 */
// The page derives every Framework in scope; on a seeded database that takes a moment per call.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const suffix = `${process.pid}-${Date.now()}`;
const CODE = `TEST-243-${suffix}`;

type Fixture = { id: string; name: string; role: UserRole };
const created: Fixture[] = [];
const user = async (key: string, role: UserRole): Promise<Fixture> => {
  const row = await prisma.user.create({ data: { email: `test-243-${key}-${suffix}@example.com`, name: `Test #243 ${key}`, role } });
  const fixture = { id: row.id, name: row.name, role };
  created.push(fixture);
  return fixture;
};

let owner: Fixture, other: Fixture, reviewer: Fixture, admin: Fixture, member: Fixture, viewer: Fixture, riskOwner: Fixture, manager: Fixture;
let f1Id: string, f2Id: string, unitId: string, groupId: string, groupName: string;
let frameworkId: string, frameworkLabel: string;
const controlIds: Record<string, string> = {};
const systemIds: string[] = [];
let activityId: string, s: string, baseline: string, inReview: string, providerId: string;

const makeControl = async (key: string, over: Record<string, unknown> = {}) => {
  const control = await prisma.control.create({
    data: {
      code: `${CODE}-${key}`,
      title: `Test #243 control ${key}`,
      description: "d",
      category: "Test",
      applicability: "PER_SYSTEM",
      mandatory: true,
      deploymentFacets: { connect: { id: f1Id } },
      ...over,
    },
  });
  controlIds[key] = control.id;
  return control;
};

const makeSystem = async (name: string, ownerId: string, data: Record<string, unknown> = {}) => {
  const system = await prisma.system.create({ data: { name: `Test #243 ${name} ${suffix}`, ownerId, ...data } });
  systemIds.push(system.id);
  return system.id;
};

beforeAll(async () => {
  f1Id = (await prisma.deploymentFacet.create({ data: { name: `Test #243 F1 ${suffix}` } })).id;
  f2Id = (await prisma.deploymentFacet.create({ data: { name: `Test #243 F2 ${suffix}` } })).id;
  unitId = (await prisma.businessUnit.create({ data: { name: `Test #243 BU ${suffix}` } })).id;
  owner = await user("owner", "SYSTEM_OWNER");
  other = await user("other", "SYSTEM_OWNER");
  reviewer = await user("reviewer", "REVIEWER");
  admin = await user("admin", "ADMIN");
  member = await user("member", "SYSTEM_OWNER");
  viewer = await user("viewer", "VIEWER");
  riskOwner = await user("risk-owner", "RISK_OWNER");
  manager = await user("manager", "COMPLIANCE_MANAGER");

  const framework = await createFixtureFramework("243");
  frameworkId = framework.id;
  frameworkLabel = `${framework.name}:${framework.version}`;
  groupName = `Test #243 Group ${suffix}`;
  groupId = (await prisma.reviewGroup.create({ data: { name: groupName, members: { connect: { id: member.id } } } })).id;
  await prisma.framework.update({ where: { id: frameworkId }, data: { reviewGroupId: groupId } });

  for (const key of ["A", "B", "E", "F", "G"]) await makeControl(key);
  await makeControl("D", { mandatory: false });
  await makeControl("C", { applicability: "BOTH" });
  // Not applicable to the Systems below: scoped to the other Facet.
  await makeControl("H", { deploymentFacets: { connect: { id: f2Id } } });
  await prisma.organizationControlImplementation.create({ data: { controlId: controlIds.C, status: "FULFILLED" } });
  await mapControlsToFramework(frameworkId, [controlIds.A]); // R1: Met
  await mapControlsToFramework(frameworkId, [controlIds.B]); // R2: Not met
  await mapControlsToFramework(frameworkId, [controlIds.H]); // R3: Not applicable
  await mapControlsToFramework(frameworkId, [controlIds.C, controlIds.D, controlIds.E, controlIds.F, controlIds.G]); // R4: Partially met
  await mapControlsToBase([controlIds.A]);

  providerId = await makeSystem("P", other.id, {
    status: "ONBOARDED",
    isProvider: true,
    deploymentFacets: { connect: { id: f1Id } },
    frameworkScopes: { connect: { id: frameworkId } },
  });
  await prisma.controlAssessment.createMany({
    data: [controlIds.F, controlIds.G].map((controlId) => ({ systemId: providerId, controlId, status: "FULFILLED" as const, assessedById: other.id })),
  });
  await prisma.controlOffering.createMany({
    data: [
      { providerId, controlId: controlIds.F, type: "FULL" as const },
      { providerId, controlId: controlIds.G, type: "SHARED" as const, customerResponsibility: "Test #243 do your half" },
    ],
  });

  s = await makeSystem("S", owner.id, {
    vendor: "Test Vendor",
    confidentialityImpactLevel: "HIGH",
    deploymentFacets: { connect: { id: f1Id } },
    frameworkScopes: { connect: { id: frameworkId } },
    businessUnits: { connect: { id: unitId } },
  });
  baseline = await makeSystem("B", owner.id);
  await prisma.providerDependency.create({ data: { dependentId: s, providerId } });
  const assess = (controlId: string, status: ControlAssessmentStatus) =>
    prisma.controlAssessment.create({ data: { systemId: s, controlId, status, assessedById: owner.id } });
  const assessmentA = await assess(controlIds.A, "FULFILLED");
  await assess(controlIds.E, "WAIVED");
  await assess(controlIds.G, "FULFILLED");
  const query = await prisma.assessmentQuery.create({ data: { controlAssessmentId: assessmentA.id, lastMessageAuthorId: reviewer.id } });
  await prisma.queryMessage.create({ data: { assessmentQueryId: query.id, authorId: reviewer.id, body: "Test #243 where is the evidence?" } });
  await prisma.risk.createMany({
    data: [
      { systemId: s, title: "Test #243 critical", description: "d", severity: "CRITICAL", likelihood: "LOW", status: "OPEN" },
      { systemId: s, title: "Test #243 low", description: "d", severity: "LOW", likelihood: "HIGH", status: "OPEN" },
      { systemId: s, title: "Test #243 mitigated", description: "d", severity: "HIGH", likelihood: "HIGH", status: "MITIGATED" },
      { systemId: s, title: "Test #243 accepted", description: "d", severity: "HIGH", likelihood: "HIGH", status: "ACCEPTED" },
    ],
  });
  const base = Date.now() - 6 * 60_000;
  const events = [
    { systemId: s, action: "SYSTEM_SUBMITTED" as const, detail: "Test #243 oldest", actorId: owner.id },
    { systemId: s, action: "CLASSIFICATION_CHANGED" as const, detail: "Test #243 second", actorId: owner.id },
    { systemId: s, action: "APPROVAL_DECIDED" as const, detail: "Base review: Approved: Test #243 fine", actorId: reviewer.id },
    { systemId: s, action: "RISK_STATUS_CHANGED" as const, detail: "Test #243 fourth", actorId: "system" },
    { systemId: s, action: "ASSESSMENT_STATUS_CHANGED" as const, detail: "Test #243 fifth", actorId: other.id },
    { systemId: s, action: "SYSTEM_OWNER_CHANGED" as const, detail: "Test #243 newest", actorId: owner.id },
    // Not this System's: another System's, and a System-less one. Neither may show.
    { systemId: baseline, action: "SYSTEM_OWNER_CHANGED" as const, detail: "Test #243 other system", actorId: owner.id },
    { systemId: null, action: "FRAMEWORK_PUBLISHED" as const, detail: "Test #243 no system", actorId: owner.id },
  ];
  for (const [index, event] of events.entries()) await prisma.changeEvent.create({ data: { ...event, createdAt: new Date(base + index * 1000) } });

  // A System of its own for the attributed events, newest last: a Query raised by a Reviewer, a reply by a
  // Review Group member, and two Approval decisions (the base step's by the Reviewer, the group's by the member).
  activityId = await makeSystem("Q", owner.id, { status: "APPROVED", frameworkScopes: { connect: { id: frameworkId } } });
  const round = await prisma.reviewRound.create({ data: { systemId: activityId } });
  const at = Date.now() - 60_000;
  await prisma.approval.createMany({
    data: [
      { systemId: activityId, reviewRoundId: round.id, reviewGroupId: null, approverId: reviewer.id, decision: "APPROVED", comment: "c", decidedAt: new Date(at + 2000) },
      { systemId: activityId, reviewRoundId: round.id, reviewGroupId: groupId, approverId: member.id, decision: "APPROVED", comment: "c", decidedAt: new Date(at + 3000) },
    ],
  });
  for (const [index, event] of [
    { action: "QUERY_OPENED" as const, detail: 'Query raised: "Test #243 q"', actorId: reviewer.id },
    { action: "QUERY_REPLIED" as const, detail: 'Reply: "Test #243 r"', actorId: member.id },
    { action: "APPROVAL_DECIDED" as const, detail: "Base review: Approved: c", actorId: reviewer.id },
    { action: "APPROVAL_DECIDED" as const, detail: `${groupName}: Approved: c`, actorId: member.id },
  ].entries()) await prisma.changeEvent.create({ data: { systemId: activityId, ...event, createdAt: new Date(at + index * 1000) } });

  inReview = await makeSystem("R", owner.id, {
    status: "IN_REVIEW",
    deploymentFacets: { connect: { id: f1Id } },
    frameworkScopes: { connect: { id: frameworkId } },
  });
  await prisma.reviewRound.create({ data: { systemId: inReview } });
});

afterAll(async () => {
  // Fixture Requirements go before their Controls, or they briefly count as Not Met everywhere (#231).
  await cleanupFixtureRequirements();
  await prisma.changeEvent.deleteMany({ where: { OR: [{ systemId: null, detail: { startsWith: "Test #243" } }, { systemId: { in: systemIds } }] } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.control.deleteMany({ where: { id: { in: Object.values(controlIds) } } });
  await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
  await prisma.businessUnit.deleteMany({ where: { id: unitId } });
  await prisma.deploymentFacet.deleteMany({ where: { id: { in: [f1Id, f2Id] } } });
  await prisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
});

const pageFor = async (u: Fixture, id: string) => loadSystemPage({ id: u.id, role: u.role, name: u.name }, id);
const mine = async (id = s) => (await pageFor(owner, id))!.view;

describe("visibility is unchanged", () => {
  it("shows a Draft to its owner and to the roles that see every System, not to another System Owner or a Viewer", async () => {
    for (const u of [owner, admin, reviewer, riskOwner, manager]) expect((await pageFor(u, s))?.view.system.id).toBe(s);
    for (const u of [other, viewer]) expect(await pageFor(u, s)).toBeNull();
  });

  it("shows nothing for an id that doesn't exist", async () => {
    expect(await pageFor(admin, "no-such-system")).toBeNull();
  });
});

describe("the header", () => {
  it("carries the System's identity", async () => {
    const view = await mine();
    expect(view.system).toMatchObject({ id: s, status: "DRAFT", isProvider: false, vendor: "Test Vendor", ownerId: owner.id, ownerName: owner.name, confidentiality: "HIGH", integrity: null });
    expect(view.system.facets.map((facet) => facet.id)).toEqual([f1Id]);
    expect(view.note).toBe(`Not submitted yet · ${owner.name} is still assembling the System`);
  });

  it("counts Requirements met exactly as the Systems list and Home do", async () => {
    const view = await mine();
    const compliance = await getComplianceForSystems({ id: s });
    const own = compliance.bySystem.find((row) => row.systemId === s)!;
    expect(view.headline.met).toBe(own.met);
    expect(view.headline.applicable).toBe(own.applicable);
    expect(own.applicable).toBeGreaterThan(0); // control A is in a base Requirement
    expect(view.headline.baseFramework).not.toBeNull();
  });

  it("counts open Risks and Controls done", async () => {
    const view = await mine();
    expect(view.headline.openRisks).toBe(2);
    expect(view.headline.controlsDone).toBe(view.controls.done);
    expect(view.headline.controlsTotal).toBe(view.controls.total);
  });
});

describe("the Controls tile", () => {
  it("counts the fixture Controls' statuses and sources over a baseline System", async () => {
    const [a, b] = [await mine(), await mine(baseline)];
    expect(a.controls.total - b.controls.total).toBe(7);
    expect(a.controls.done - b.controls.done).toBe(5);
    const status = (key: ControlAssessmentStatus) => a.controls.byStatus[key] - b.controls.byStatus[key];
    expect([status("FULFILLED"), status("WAIVED"), status("NOT_STARTED"), status("IN_PROGRESS"), status("NOT_APPLICABLE")]).toEqual([4, 1, 2, 0, 0]);
    const source = (key: SourceKey) => a.controls.bySource[key] - b.controls.bySource[key];
    expect(SOURCE_KEYS.map(source)).toEqual([1, 1, 1, 4]);
    expect(SOURCE_KEYS).toEqual(["organization", "provider-full", "provider-shared", "system"]);
  });

  it("lists every applicable Control for the palette, and leaves out one scoped to another Facet", async () => {
    const view = await mine();
    const fixture = view.controlList.filter((control) => control.code.startsWith(CODE));
    expect(fixture.map((control) => control.code)).toEqual(["A", "B", "C", "D", "E", "F", "G"].map((key) => `${CODE}-${key}`));
    expect(view.counts.controls).toBe(view.controls.total);
  });
});

describe("the Compliance tile", () => {
  it("summarises each Framework in scope by derived Requirement status, the base Framework first", async () => {
    const view = await mine();
    expect(view.frameworks[0].isBase).toBe(true);
    const fixture = view.frameworks.find((framework) => framework.label === frameworkLabel)!;
    expect(fixture).toMatchObject({ met: 1, partial: 1, notMet: 1, notApplicable: 1, applicable: 3, isBase: false });
    expect(view.counts.requirements).toBe(view.frameworks.length);
  });
});

describe("Needs attention", () => {
  it("lists the open Query the user can act on, then the mandatory own Control not started, then open Risks worst first", async () => {
    const view = await mine();
    const ours = view.attention.filter((item) => item.title.includes("243"));
    expect(ours.map((item) => [item.kind, item.title, item.tab])).toEqual([
      ["query", "Test #243 where is the evidence?", "controls"],
      ["control", `${CODE}-B Test #243 control B`, "controls"],
      ["risk", "Test #243 critical", "risks"],
      ["risk", "Test #243 low", "risks"],
    ]);
    // A query and a Control item name their Control, so Open goes to its drawer (#244); a Risk names none.
    expect(ours.map((item) => item.controlCode)).toEqual([`${CODE}-A`, `${CODE}-B`, undefined, undefined]);
  });

  it("holds exactly the Queries the Systems list counts for that user", async () => {
    for (const u of [owner, admin, reviewer, riskOwner]) {
      const counted = (await getActionableQueryCountsBySystem(u, [s])).get(s) ?? 0;
      const listed = (await pageFor(u, s))!.view.attention.filter((item) => item.kind === "query").length;
      expect(listed).toBe(counted);
    }
    // The reviewer side spoke last, so it waits for the owner: only the owner (and not the reviewer) can act on it.
    expect((await getActionableQueryCountsBySystem(reviewer, [s])).get(s) ?? 0).toBe(0);
    expect((await getActionableQueryCountsBySystem(owner, [s])).get(s)).toBe(1);
  });
});

describe("the Risks tile", () => {
  it("counts open Risks by severity and likelihood, and tallies the other statuses", async () => {
    const { risks, counts } = await mine();
    expect(risks.open).toBe(2);
    expect(risks.mitigated).toBe(1);
    expect(risks.accepted).toBe(1);
    expect(risks.grid[3][0]).toBe(1); // Critical severity, Low likelihood
    expect(risks.grid[0][2]).toBe(1); // Low severity, High likelihood
    expect(risks.grid.flat().reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(counts.openRisks).toBe(2);
  });
});

describe("the Classification tile", () => {
  it("holds the Deployment Facets, Business Units and Framework Scope", async () => {
    const { classification, counts } = await mine();
    expect(classification.facets).toEqual([`Test #243 F1 ${suffix}`]);
    expect(classification.businessUnits).toEqual([`Test #243 BU ${suffix}`]);
    expect(classification.frameworkScope).toContain(frameworkLabel);
    expect(counts.providers).toBe(1);
  });
});

describe("Recent activity", () => {
  it("shows this System's last four Change Events, newest first, and nothing from other Systems or System-less ones", async () => {
    const { activity } = await mine();
    expect(activity.map((item) => item.detail)).toEqual(["Test #243 newest", "Test #243 fifth", "Test #243 fourth", "Base review: Approved: Test #243 fine"]);
  });

  it("names the actor: You, a person, the system, and the step (not the person) for an Approval decision unless the viewer may see who", async () => {
    expect((await mine()).activity.map((item) => item.who)).toEqual(["You", other.name, "The system", "Base review"]);
    const asAdmin = (await pageFor(admin, s))!.view.activity;
    expect(asAdmin.map((item) => item.who)).toEqual([owner.name, other.name, "The system", reviewer.name]);
  });

  it("shows the System's owner no person behind a Query action or an Approval decision, only the step or 'A reviewer'", async () => {
    const who = (await pageFor(owner, activityId))!.view.activity.map((item) => item.who);
    expect(who).toEqual([groupName, "Base review", "A reviewer", "A reviewer"]);
    expect(who.join("|")).not.toContain(reviewer.name);
    expect(who.join("|")).not.toContain(member.name);
  });

  it("shows an Admin everyone by name", async () => {
    expect((await pageFor(admin, activityId))!.view.activity.map((item) => item.who)).toEqual([member.name, reviewer.name, member.name, reviewer.name]);
  });

  it("follows the Approval history's rule: a Reviewer sees the base step's decider, a group's member sees the group's", async () => {
    // Query actions stay unattributed for them (they can't be tied back to a message), so 'A reviewer'.
    expect((await pageFor(reviewer, activityId))!.view.activity.map((item) => item.who)).toEqual([groupName, "You", "A reviewer", "You"]);
    expect((await pageFor(member, activityId))!.view.activity.map((item) => item.who)).toEqual(["You", "Base review", "You", "A reviewer"]);
  });

  it("gives every event a phrase", async () => {
    for (const item of (await mine()).activity) expect(item.what).not.toMatch(/^[A-Z_]+$/);
  });
});

describe("the next step per role (never an action the API would refuse)", () => {
  const steps = async (u: Fixture, id: string) => {
    const next = (await pageFor(u, id))!.view.nextStep;
    return next.kind === "decide" ? next.steps.map((step) => step.name).sort() : next.kind;
  };

  it("offers a Draft's owner and an Admin Submit for review, and nobody else who can see it", async () => {
    expect(await steps(owner, s)).toBe("submit");
    expect(await steps(admin, s)).toBe("submit");
    for (const u of [reviewer, riskOwner, manager]) expect(await steps(u, s)).toBe("none");
  });

  it("agrees with the submit route: 403 exactly when no Submit is offered", async () => {
    for (const u of [owner, admin, reviewer, riskOwner, manager]) {
      const id = await makeSystem(`submit-${u.role}`, owner.id);
      const offered = (await steps(u, id)) === "submit";
      const response = await postSubmit(requestAs(u.id, id, "submit"), ctxFor(id));
      expect(response.status === 403, `${u.role} ${response.status}`).toBe(!offered);
    }
  });

  it("blocks Submit for review by exactly the submit route's own check", async () => {
    const withFacet = (await prisma.system.findUniqueOrThrow({ where: { id: s }, include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } } }));
    const unaddressed = await getUnaddressedMandatoryControls(withFacet);
    expect(unaddressed.map((control) => control.code)).toContain(`${CODE}-B`);
    const view = await mine();
    expect(view.nextStep).toEqual({ kind: "submit", blockedBy: unaddressed.length });
    // The route refuses (400) while any is left, and accepts once none is: here, a System with no Facet,
    // blocked only by whatever unscoped mandatory Controls the database holds (none on an unseeded one).
    const plain = await makeSystem("plain", owner.id);
    const plainView = (await pageFor(owner, plain))!.view;
    expect(plainView.nextStep.kind).toBe("submit");
    const blockedBy = plainView.nextStep.kind === "submit" ? plainView.nextStep.blockedBy : -1;
    for (const [id, blocked] of [[s, unaddressed.length], [plain, blockedBy]] as const) {
      const response = await postSubmit(requestAs(owner.id, id, "submit"), ctxFor(id));
      expect(response.status, id).toBe(blocked === 0 ? 200 : 400);
    }
  });

  it("offers the Review Steps a user may decide, as the approvals API reports canDecide", async () => {
    const expected: Record<string, string[] | string> = {
      owner: "none", // nobody decides a step on a System they own
      reviewer: ["Base review"],
      admin: ["Base review", groupName].sort(),
      member: [groupName],
      riskOwner: "none",
      manager: "none",
    };
    const users = { owner, reviewer, admin, member, riskOwner, manager };
    for (const [key, u] of Object.entries(users)) {
      expect(await steps(u, inReview), key).toEqual(expected[key]);
      const body = await (await getApprovals(requestAs(u.id, inReview, "approvals"), ctxFor(inReview))).json();
      const api = (body.steps as { name: string; canDecide: boolean }[]).filter((step) => step.canDecide).map((step) => step.name).sort();
      expect(api, `${key} (API)`).toEqual(Array.isArray(expected[key]) ? expected[key] : []);
    }
  });

  it("agrees with the approvals route when deciding: a refused user gets 403, an offered one is let in", async () => {
    const id = await makeSystem("decide", owner.id, { status: "IN_REVIEW", deploymentFacets: { connect: { id: f1Id } }, frameworkScopes: { connect: { id: frameworkId } } });
    await prisma.reviewRound.create({ data: { systemId: id } });
    for (const u of [owner, riskOwner, manager]) {
      const response = await postApproval(requestAs(u.id, id, "approvals", { decision: "APPROVED", comment: "x", reviewGroupId: null }), ctxFor(id));
      expect(response.status, u.role).toBe(403);
    }
    const response = await postApproval(requestAs(reviewer.id, id, "approvals", { decision: "APPROVED", comment: "x", reviewGroupId: null }), ctxFor(id));
    expect(response.status).toBe(201);
    // With the base step decided, the Reviewer has nothing left to decide.
    expect(await steps(reviewer, id)).toBe("none");
    expect(await steps(member, id)).toEqual([groupName]);
  });

  it("offers an Approved System's owner and an Admin Mark Onboarded, and agrees with the onboard route", async () => {
    for (const u of [owner, admin, reviewer, riskOwner, manager]) {
      const id = await makeSystem(`onboard-${u.role}`, owner.id, { status: "APPROVED" });
      const offered = (await steps(u, id)) === "onboard";
      expect(offered).toBe(u.id === owner.id || u.role === "ADMIN");
      const response = await postOnboard(requestAs(u.id, id, "onboard"), ctxFor(id));
      expect(response.status === 403, `${u.role} ${response.status}`).toBe(!offered);
    }
  });

  it("offers nothing on an Onboarded or a Rejected System", async () => {
    for (const status of ["ONBOARDED", "REJECTED"] as const) {
      const id = await makeSystem(`end-${status}`, owner.id, { status });
      expect(await steps(owner, id)).toBe("none");
      expect(await steps(admin, id)).toBe("none");
    }
  });

  it("offers Change owner to the owner and an Admin only", async () => {
    // One after the other: each load holds a connection, and the test pool is three.
    const flags: boolean[] = [];
    for (const u of [owner, admin, reviewer, riskOwner, manager]) flags.push((await pageFor(u, s))!.view.canChangeOwner);
    expect(flags).toEqual([true, true, false, false, false]);
  });
});

describe("the lifecycle note", () => {
  it("says who submitted an In Review System, and how many steps have approved", async () => {
    await prisma.changeEvent.create({ data: { systemId: inReview, action: "SYSTEM_SUBMITTED", detail: "Submitted for review", actorId: owner.id } });
    const { note } = await mine(inReview);
    expect(note.replace(/^Submitted \d+ \w+ \d{4}/, "Submitted <day>")).toBe(`Submitted <day> by ${owner.name} · waiting for a Reviewer's decision (0 of 2 Review Steps approved)`);
  });
});

function requestAs(userId: string, systemId: string, path: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/systems/${systemId}/${path}`, {
    method: body !== undefined || path !== "approvals" ? "POST" : "GET",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
