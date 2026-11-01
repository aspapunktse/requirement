import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SYSTEM_ACTOR, logChangeEvent } from "@/lib/change-events";
import { frameworkLabel } from "@/lib/framework-label";
import { PATCH as patchImplementation } from "@/app/api/organization/controls/[controlId]/route";
import { getBaseFramework } from "@/test/framework-fixtures";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { HISTORY_LIMIT, loadOrganizationControlsView } from "../controls-data";

/**
 * The Organization Control Implementations page's server side (#284), against real Postgres with its own
 * `Test ORG284 ...` fixtures (CI's database is migrated but not seeded; a seeded one has 100+ more Controls, so
 * every assertion looks up the fixture rows). The fixture Both Control is scoped to a fixture Facet and mapped
 * to a fixture Published Framework only the fixture Systems declare, so its reach is exactly those Systems.
 */
describe("loadOrganizationControlsView (#284)", () => {
  const ctx = setupProviderFixtures("ORG284");
  const extra = { controls: [] as string[], frameworks: [] as string[] };

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: null, detail: { contains: `-${ctx.suffix}` } } });
    await prisma.control.deleteMany({ where: { id: { in: extra.controls } } });
    await prisma.framework.deleteMany({ where: { id: { in: extra.frameworks } } });
  });

  const as = (key: keyof typeof ctx.users, role: UserRole) => ({ id: ctx.users[key], name: `Test ORG284 ${key}`, role });
  const admin = () => as("admin", "ADMIN");
  const rowOf = async (user: ReturnType<typeof admin>, controlId: string) => {
    const view = await loadOrganizationControlsView(user);
    const row = view.rows.find((candidate) => candidate.id === controlId);
    if (!row) throw new Error("Control missing from the view");
    return { view, row };
  };
  const patch = (controlId: string, userId: string, body: unknown) =>
    patchImplementation(requestAs(`/api/organization/controls/${controlId}`, userId, "PATCH", body), { params: Promise.resolve({ controlId }) });
  const setStatus = async (controlId: string, status: string, description?: string) => {
    const response = await patch(controlId, ctx.users.admin, { status, ...(description && { description }) });
    expect(response.status).toBe(200);
  };

  it("lists only Organizational and Both Controls, with what the page shows around them", async () => {
    await ctx.makeSystem();
    await ctx.makeSystem();
    await prisma.control.update({ where: { id: ctx.controls.organizational.id }, data: { ownerId: ctx.users.owner, category: "A.5 Organizational controls", description: "The Control text" } });
    const { view, row } = await rowOf(admin(), ctx.controls.organizational.id);
    expect(view.rows.some((candidate) => candidate.id === ctx.controls.perSystem.id)).toBe(false);
    expect(view.rows.some((candidate) => candidate.id === ctx.controls.both.id)).toBe(true);
    expect(view).toMatchObject({ userId: ctx.users.admin, role: "ADMIN", roleLabel: "Admin" });
    const framework = await prisma.framework.findUniqueOrThrow({ where: { id: ctx.frameworkId } });
    expect(row).toMatchObject({
      code: ctx.controls.organizational.code,
      title: ctx.controls.organizational.title,
      applicability: "ORGANIZATIONAL",
      category: "A.5 Organizational controls",
      summary: "The Control text",
      ownerId: ctx.users.owner,
      ownerName: "Test ORG284 owner",
      // No row yet: reads as Not Started with nothing else
      status: "NOT_STARTED",
      description: null,
      updatedAt: null,
      updatedByName: null,
      systemCount: 0,
      frameworks: [frameworkLabel(framework)],
      origin: null,
      history: [],
    });
  });

  it("counts the Systems a Both Control applies to, and none for an Organizational one", async () => {
    // Two Systems with the live Facet (above); a third without it does not count
    await ctx.makeSystem({ facets: [ctx.facets.elsewhere] });
    const { row } = await rowOf(admin(), ctx.controls.both.id);
    expect(row.systemCount).toBe(2);
    expect((await rowOf(admin(), ctx.controls.organizational.id)).row.systemCount).toBe(0);
  });

  it("says whether the acting user may edit each Control: the Control Owner, a Compliance Manager, an Admin", async () => {
    const organizationalId = ctx.controls.organizational.id; // owned by `owner`
    expect((await rowOf(as("owner", "SYSTEM_OWNER"), organizationalId)).row.canEdit).toBe(true);
    expect((await rowOf(as("otherOwner", "SYSTEM_OWNER"), organizationalId)).row.canEdit).toBe(false);
    expect((await rowOf(as("viewer", "VIEWER"), organizationalId)).row.canEdit).toBe(false);
    expect((await rowOf(as("complianceManager", "COMPLIANCE_MANAGER"), organizationalId)).row.canEdit).toBe(true);
    expect((await rowOf(admin(), organizationalId)).row.canEdit).toBe(true);
    // An unowned Control: only the two curator roles
    expect((await rowOf(as("owner", "SYSTEM_OWNER"), ctx.controls.both.id)).row.canEdit).toBe(false);
    expect((await rowOf(admin(), ctx.controls.both.id)).row.canEdit).toBe(true);
  });

  it("reads a Control's history from the System-less events, newest first, with who and when, for Both and Organizational Controls alike", async () => {
    for (const control of [ctx.controls.organizational, ctx.controls.both]) {
      await setStatus(control.id, "IN_PROGRESS");
      await setStatus(control.id, "FULFILLED", "Done");
      // A description-only edit and a repeat of the same status record nothing
      await setStatus(control.id, "FULFILLED", "Done, reworded");
      const { row } = await rowOf(admin(), control.id);
      expect(row.status).toBe("FULFILLED");
      expect(row.updatedByName).toBe("Test ORG284 admin");
      expect(row.history.map((entry) => `${entry.from}>${entry.to}`)).toEqual(["IN_PROGRESS>FULFILLED", "NOT_STARTED>IN_PROGRESS"]);
      expect(row.history[0].by).toBe("Test ORG284 admin");
      expect(Date.parse(row.history[0].at)).toBeGreaterThanOrEqual(Date.parse(row.history[1].at));
    }
  });

  it("names the system as the editor of a change it made itself, and never mixes up two Controls whose codes share a prefix", async () => {
    const longer = await prisma.control.create({
      data: { code: `${ctx.controls.organizational.code}-2`, title: "Test ORG284 longer code", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
    });
    extra.controls.push(longer.id);
    await logChangeEvent(null, "ORGANIZATION_IMPLEMENTATION_CHANGED", `${longer.code} Organization Control Implementation changed from Fulfilled to In Progress`, SYSTEM_ACTOR);
    const { row } = await rowOf(admin(), longer.id);
    expect(row.history).toHaveLength(1);
    expect(row.history[0]).toMatchObject({ by: "System", from: "FULFILLED", to: "IN_PROGRESS" });
    // The shorter code's history has none of it
    const shorter = (await rowOf(admin(), ctx.controls.organizational.id)).row;
    expect(shorter.history.every((entry) => entry.by !== "System")).toBe(true);
  });

  it("keeps the newest entries when there are more than the limit", async () => {
    const busy = await prisma.control.create({
      data: { code: `TEST-ORG284-BUSY-${ctx.suffix}`, title: "Test ORG284 busy", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
    });
    extra.controls.push(busy.id);
    await prisma.changeEvent.createMany({
      data: Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
        action: "ORGANIZATION_IMPLEMENTATION_CHANGED" as const,
        detail: `${busy.code} Organization Control Implementation changed from ${i % 2 ? "Fulfilled" : "In Progress"} to ${i % 2 ? "In Progress" : "Fulfilled"}`,
        actorId: SYSTEM_ACTOR,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
      })),
    });
    const { row } = await rowOf(admin(), busy.id);
    expect(row.history).toHaveLength(HISTORY_LIMIT);
    expect(row.history[0].at).toBe(new Date(Date.UTC(2026, 0, 1, 0, HISTORY_LIMIT + 4)).toISOString());
  });

  it("names a Supplementary Control's origin Framework, and hides a Draft Framework's name from roles that can't see Drafts", async () => {
    const published = await prisma.framework.findUniqueOrThrow({ where: { id: ctx.frameworkId } });
    const draft = await prisma.framework.create({ data: { name: `Test ORG284 Secret Draft ${ctx.suffix}`, version: "4", status: "DRAFT" } });
    extra.frameworks.push(draft.id);
    const make = async (key: string, originFrameworkId: string) => {
      const control = await prisma.control.create({
        data: { code: `TEST-ORG284-${key}-${ctx.suffix}`, title: `Test ORG284 ${key}`, description: "d", category: "Supplementary", applicability: "ORGANIZATIONAL", originFrameworkId },
      });
      extra.controls.push(control.id);
      return control.id;
    };
    const publishedId = await make("pub", published.id);
    const draftId = await make("draft", draft.id);

    for (const user of [as("viewer", "VIEWER"), as("owner", "SYSTEM_OWNER"), as("complianceManager", "COMPLIANCE_MANAGER"), admin()]) {
      expect((await rowOf(user, publishedId)).row.origin).toEqual({ key: published.id, label: frameworkLabel(published) });
    }
    for (const user of [as("viewer", "VIEWER"), as("owner", "SYSTEM_OWNER")]) {
      const { view, row } = await rowOf(user, draftId);
      expect(row.origin).toEqual({ key: draft.id, label: "Draft Framework" });
      expect(JSON.stringify(view)).not.toContain("Secret Draft");
    }
    expect((await rowOf(admin(), draftId)).row.origin?.label).toBe(frameworkLabel(draft));
  });

  it("treats a Control whose origin is the base Framework as a base Control, not a Supplementary one (the ISMS clauses)", async () => {
    const base = await getBaseFramework();
    const control = await prisma.control.create({
      data: { code: `TEST-ORG284-ISMS-${ctx.suffix}`, title: "Test ORG284 clause", description: "d", category: "4 Context of the organization", applicability: "ORGANIZATIONAL", originFrameworkId: base.id },
    });
    extra.controls.push(control.id);
    expect((await rowOf(admin(), control.id)).row.origin).toBeNull();
  });

  it("lists only Published Frameworks among the ones a Control maps to", async () => {
    const draft = await prisma.framework.create({ data: { name: `Test ORG284 Mapped Draft ${ctx.suffix}`, version: "1", status: "DRAFT" } });
    extra.frameworks.push(draft.id);
    const requirement = await prisma.requirement.create({ data: { frameworkId: draft.id, code: "X-1", section: "S", title: "t", text: "t" } });
    await prisma.controlMapping.create({ data: { controlId: ctx.controls.organizational.id, requirementId: requirement.id, coverage: "FULL" } });
    const { view, row } = await rowOf(as("viewer", "VIEWER"), ctx.controls.organizational.id);
    expect(row.frameworks).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain("Mapped Draft");
    await prisma.controlMapping.deleteMany({ where: { requirementId: requirement.id } });
    await prisma.requirement.delete({ where: { id: requirement.id } });
  });
});
