// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";
import { PATCH, DELETE } from "../[milestoneId]/route";
import { POST as POST_ORG } from "@/app/api/risks/[id]/milestones/route";
import { PATCH as PATCH_ORG, DELETE as DELETE_ORG } from "@/app/api/risks/[id]/milestones/[milestoneId]/route";

/** A Risk's remediation milestones (#456), against real Postgres. Fixtures only (`Test 456c...`). A refused request changes nothing. */
describe("Risk milestones (#456)", { timeout: 60_000 }, () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let riskId = "";
  let otherSystemRiskId = "";
  let orgRiskId = "";
  const today = new Date().toISOString().slice(0, 10);
  const ctx = (extra: Record<string, string> = {}, systemId = s.systemId) => ({ params: Promise.resolve({ id: systemId, riskId, ...extra }) }) as never;
  const url = (suffix = "") => `/api/systems/${s.systemId}/risks/${riskId}/milestones${suffix}`;
  const count = () => prisma.riskMilestone.count({ where: { riskId } });

  beforeAll(async () => {
    s = await createCheckUpScenario("456c", { systemControls: 1, organizationControls: 1, extraSystems: 1 });
    const mk = (systemId: string | null, extra: object = {}) =>
      prisma.risk.create({ data: { systemId, title: `Test 456c risk ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW", ...extra } });
    riskId = (await mk(s.systemId)).id;
    otherSystemRiskId = (await mk(s.extraSystemIds[0])).id;
    orgRiskId = (await mk(null, { checkUpId: s.find(s.organizationControls[0].code, true).id })).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { id: { in: [riskId, otherSystemRiskId, orgRiskId] } } });
    await s.cleanup();
  }, 60_000);

  it("adds, edits, completes and deletes a milestone, returning the Risk with its milestones in date order", async () => {
    const added = await POST(requestAs(url(), s.roleUser.RISK_OWNER, "POST", { title: "  Patch the server  ", plannedDate: "2027-03-01" }), ctx());
    expect(added.status).toBe(201);
    const { risk } = await added.json();
    expect(risk.milestones.map((m: { title: string }) => m.title)).toEqual(["Patch the server"]);
    const id = risk.milestones[0].id as string;
    await POST(requestAs(url(), s.roleUser.ADMIN, "POST", { title: "Earlier", plannedDate: "2027-01-01" }), ctx());
    const edit = await PATCH(requestAs(url(`/${id}`), s.roleUser.ADMIN, "PATCH", { title: "Patch and restart", plannedDate: "2027-04-01" }), ctx({ milestoneId: id }));
    expect(edit.status).toBe(200);
    expect((await edit.json()).risk.milestones.map((m: { title: string }) => m.title)).toEqual(["Earlier", "Patch and restart"]);
    const done = await PATCH(requestAs(url(`/${id}`), s.roleUser.ADMIN, "PATCH", { completedDate: today }), ctx({ milestoneId: id }));
    expect(done.status).toBe(200);
    // A completed milestone is a record and stays.
    const refused = await DELETE(requestAs(url(`/${id}`), s.roleUser.ADMIN, "DELETE"), ctx({ milestoneId: id }));
    expect(refused.status).toBe(409);
    expect(await count()).toBe(2);
    const reopened = await PATCH(requestAs(url(`/${id}`), s.roleUser.ADMIN, "PATCH", { completedDate: null }), ctx({ milestoneId: id }));
    expect(reopened.status).toBe(200);
    expect((await DELETE(requestAs(url(`/${id}`), s.roleUser.ADMIN, "DELETE"), ctx({ milestoneId: id }))).status).toBe(200);
    expect(await count()).toBe(1);
  });

  it("refuses the wrong roles and bad bodies and changes nothing", async () => {
    const [existing] = await prisma.riskMilestone.findMany({ where: { riskId } });
    if (!existing) throw new Error("fixture milestone missing");
    const before = await prisma.riskMilestone.findMany({ where: { riskId }, orderBy: { id: "asc" } });
    for (const user of [s.systemOwner, s.roleUser.RISK_FACILITATOR, s.roleUser.VIEWER, s.roleUser.INTERNAL_AUDITOR]) {
      expect((await POST(requestAs(url(), user, "POST", { title: "No", plannedDate: "2027-05-01" }), ctx())).status).toBe(403);
      expect((await PATCH(requestAs(url(`/${existing.id}`), user, "PATCH", { completedDate: today }), ctx({ milestoneId: existing.id }))).status).toBe(403);
      expect((await DELETE(requestAs(url(`/${existing.id}`), user, "DELETE"), ctx({ milestoneId: existing.id }))).status).toBe(403);
    }
    expect((await POST(requestAs(url(), null, "POST", { title: "No", plannedDate: "2027-05-01" }), ctx())).status).toBe(401);
    for (const body of [{ title: "", plannedDate: "2027-05-01" }, { title: "x", plannedDate: "2027-02-30" }, { title: "x" }, { title: "x", plannedDate: "tomorrow" }]) {
      expect((await POST(requestAs(url(), s.roleUser.ADMIN, "POST", body), ctx())).status).toBe(400);
    }
    expect((await PATCH(requestAs(url(`/${existing.id}`), s.roleUser.ADMIN, "PATCH", {}), ctx({ milestoneId: existing.id }))).status).toBe(400);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await PATCH(requestAs(url(`/${existing.id}`), s.roleUser.ADMIN, "PATCH", { completedDate: future }), ctx({ milestoneId: existing.id }))).status).toBe(400);
    expect(await prisma.riskMilestone.findMany({ where: { riskId }, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("does not reach a milestone through another System's or another Risk's path", async () => {
    const [existing] = await prisma.riskMilestone.findMany({ where: { riskId } });
    if (!existing) throw new Error("fixture milestone missing");
    // The Risk of another System under this System's id.
    const wrongRisk = { params: Promise.resolve({ id: s.systemId, riskId: otherSystemRiskId, milestoneId: existing.id }) } as never;
    expect((await PATCH(requestAs(url(`/${existing.id}`), s.roleUser.ADMIN, "PATCH", { title: "Hijack" }), wrongRisk)).status).toBe(404);
    expect((await DELETE(requestAs(url(`/${existing.id}`), s.roleUser.ADMIN, "DELETE"), wrongRisk)).status).toBe(404);
    expect((await POST(requestAs(url(), s.roleUser.ADMIN, "POST", { title: "Nope", plannedDate: "2027-05-01" }), { params: Promise.resolve({ id: s.systemId, riskId: otherSystemRiskId }) } as never)).status).toBe(404);
    expect(await prisma.riskMilestone.count({ where: { riskId: otherSystemRiskId } })).toBe(0);
    expect((await prisma.riskMilestone.findUniqueOrThrow({ where: { id: existing.id } })).title).not.toBe("Hijack");
    // A System Risk is not reachable through the Organization routes, and the reverse.
    expect((await POST_ORG(requestAs(`/api/risks/${riskId}/milestones`, s.roleUser.ADMIN, "POST", { title: "x", plannedDate: "2027-05-01" }), { params: Promise.resolve({ id: riskId }) } as never)).status).toBe(404);
  });

  it("works for an Organization Risk with the same rules", async () => {
    const orgCtx = (milestoneId?: string) => ({ params: Promise.resolve({ id: orgRiskId, ...(milestoneId && { milestoneId }) }) }) as never;
    expect((await POST_ORG(requestAs(`/api/risks/${orgRiskId}/milestones`, s.roleUser.VIEWER, "POST", { title: "x", plannedDate: "2027-05-01" }), orgCtx())).status).toBe(403);
    expect(await prisma.riskMilestone.count({ where: { riskId: orgRiskId } })).toBe(0);
    const added = await POST_ORG(requestAs(`/api/risks/${orgRiskId}/milestones`, s.roleUser.RISK_OWNER, "POST", { title: "Org step", plannedDate: "2027-05-01" }), orgCtx());
    expect(added.status).toBe(201);
    const id = (await added.json()).risk.milestones[0].id as string;
    expect((await PATCH_ORG(requestAs(`/api/risks/${orgRiskId}/milestones/${id}`, s.roleUser.RISK_OWNER, "PATCH", { completedDate: today }), orgCtx(id))).status).toBe(200);
    expect((await DELETE_ORG(requestAs(`/api/risks/${orgRiskId}/milestones/${id}`, s.roleUser.RISK_OWNER, "DELETE"), orgCtx(id))).status).toBe(409);
  });
});
