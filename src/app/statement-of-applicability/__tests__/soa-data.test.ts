import { afterAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { setupProviderFixtures } from "@/test/provider-fixtures";
import { BASE_SOURCE_KEY, BASE_SOURCE_LABEL, loadSoaView, requirementGroups } from "../soa-data";

/**
 * The Statement of Applicability page's server side (#272), against real Postgres with its own `Test SOA272 ...`
 * fixtures (CI's database is migrated but not seeded; a seeded one has 100+ more Controls, so every assertion
 * looks up the fixture rows). The fixture Controls are mapped to a fixture Published Framework that only the
 * fixture Systems declare.
 *
 *   Alpha  Draft, owned by `owner`            Per-System Control: Fulfilled
 *   Beta   Draft, owned by `otherOwner`       Per-System Control: In Progress (a System `owner` may not see)
 *   Gamma  Onboarded, owned by `otherOwner`   Per-System Control: Not Started (every role sees an Onboarded System)
 */
describe("loadSoaView (#272)", () => {
  const ctx = setupProviderFixtures("SOA272");
  const sentinelIds = { controls: [] as string[], frameworks: [] as string[] };
  const names = { alpha: "", beta: "", gamma: "" };

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: { in: sentinelIds.controls } } });
    await prisma.framework.deleteMany({ where: { id: { in: sentinelIds.frameworks } } });
  });

  const actor = (key: keyof typeof ctx.users, role: UserRole) => ({ id: ctx.users[key], role });
  const asOwner = () => actor("owner", "SYSTEM_OWNER");
  const asCompliance = () => actor("complianceManager", "COMPLIANCE_MANAGER");

  async function setup() {
    if (names.alpha) return;
    names.alpha = `Test SOA272 Alpha ${ctx.suffix}`;
    names.beta = `Test SOA272 Beta ${ctx.suffix}`;
    names.gamma = `Test SOA272 Gamma ${ctx.suffix}`;
    const alpha = await ctx.makeSystem({ name: names.alpha, status: "DRAFT", ownerId: ctx.users.owner });
    const beta = await ctx.makeSystem({ name: names.beta, status: "DRAFT", ownerId: ctx.users.otherOwner });
    await ctx.makeSystem({ name: names.gamma, status: "ONBOARDED", ownerId: ctx.users.otherOwner });
    await ctx.assess(alpha, ctx.controls.perSystem.id, "FULFILLED");
    await ctx.assess(beta, ctx.controls.perSystem.id, "IN_PROGRESS");
    await prisma.control.update({ where: { id: ctx.controls.perSystem.id }, data: { ownerId: ctx.users.complianceManager, category: "Test SOA272 Domain" } });
  }

  async function rowOf(user: { id: string; role: UserRole }, controlId: string) {
    const view = await loadSoaView(user);
    const row = view.rows.find((candidate) => candidate.controlId === controlId);
    if (!row) throw new Error("Control missing from the view");
    return { view, row };
  }

  it("holds exactly the rows of the API, one per Control, plus the ledger's own fields", async () => {
    await setup();
    const { view } = await rowOf(asCompliance(), ctx.controls.perSystem.id);
    const api = await loadStatementOfApplicability();
    expect(view.rows.map((row) => row.controlId)).toEqual(api.map((row) => row.controlId));
    for (const base of api.filter((row) => Object.values(ctx.controls).some((control) => control.id === row.controlId))) {
      expect(view.rows.find((row) => row.controlId === base.controlId)).toMatchObject(base);
    }
  });

  it("carries the Control's domain, description, Control Owner and the Requirement codes as data", async () => {
    await setup();
    const framework = await prisma.framework.findUniqueOrThrow({ where: { id: ctx.frameworkId } });
    const { row } = await rowOf(asCompliance(), ctx.controls.perSystem.id);
    expect(row).toMatchObject({ category: "Test SOA272 Domain", description: "d", ownerName: `Test SOA272 complianceManager`, included: true });
    expect(row.requirements).toHaveLength(1);
    expect(row.requirements[0].framework).toBe(frameworkLabel(framework));
    expect(row.requirements[0].codes.length).toBeGreaterThan(0);
    // The structured codes and the generated sentence are the same data.
    expect(row.requirements.map((group) => `${group.framework} ${group.codes.join(", ")}`).join("; ")).toBe(row.inclusionJustification);

    const unowned = (await rowOf(asCompliance(), ctx.controls.organizational.id)).row;
    expect(unowned.ownerName).toBeNull();
  });

  it("lists no Requirement for an excluded Control", async () => {
    await setup();
    const { row } = await rowOf(asCompliance(), ctx.controls.elsewhere.id);
    expect(row).toMatchObject({ included: false, requirements: [], systemStatuses: [], hiddenSystemCount: 0 });
  });

  it("puts a base Control in the base Control Library", async () => {
    await setup();
    const { row } = await rowOf(asCompliance(), ctx.controls.perSystem.id);
    expect(row).toMatchObject({ sourceKey: BASE_SOURCE_KEY, sourceLabel: BASE_SOURCE_LABEL });
  });

  it("names a Supplementary Control's Framework, and hides a Draft Framework's name from roles that can't see Drafts", async () => {
    await setup();
    const published = await prisma.framework.findUniqueOrThrow({ where: { id: ctx.frameworkId } });
    const draft = await prisma.framework.create({ data: { name: `Test SOA272 Secret Draft ${ctx.suffix}`, version: "4", status: "DRAFT" } });
    sentinelIds.frameworks.push(draft.id);
    const make = async (key: string, originFrameworkId: string) => {
      const control = await prisma.control.create({
        data: { code: `TEST-SOA272-${key}-${ctx.suffix}`, title: `Test SOA272 ${key}`, description: "d", category: "Supplementary", applicability: "ORGANIZATIONAL", originFrameworkId },
      });
      sentinelIds.controls.push(control.id);
      return control.id;
    };
    const publishedSupplementary = await make("pub", published.id);
    const draftSupplementary = await make("draft", draft.id);

    for (const user of [asOwner(), actor("viewer", "VIEWER"), asCompliance(), actor("admin", "ADMIN")]) {
      const { row } = await rowOf(user, publishedSupplementary);
      expect(row).toMatchObject({ sourceKey: published.id, sourceLabel: `Supplementary · ${frameworkLabel(published)}` });
    }
    for (const user of [asOwner(), actor("viewer", "VIEWER")]) {
      const { view, row } = await rowOf(user, draftSupplementary);
      expect(row.sourceLabel).toBe("Supplementary · Draft Framework");
      expect(JSON.stringify(view)).not.toContain(draft.name);
    }
    for (const user of [asCompliance(), actor("admin", "ADMIN")]) {
      const { row } = await rowOf(user, draftSupplementary);
      expect(row.sourceLabel).toBe(`Supplementary · ${frameworkLabel(draft)}`);
    }
  });

  describe("Systems (decision 3a)", () => {
    it("rolls up over ALL Systems for everyone", async () => {
      await setup();
      for (const user of [asOwner(), actor("viewer", "VIEWER"), asCompliance()]) {
        const { row } = await rowOf(user, ctx.controls.perSystem.id);
        expect(row.systemRollup).toMatchObject({ total: 3, counts: { FULFILLED: 1, IN_PROGRESS: 1, NOT_STARTED: 1 } });
        expect(row.appliesToSystemCount).toBe(3);
      }
    });

    it("lists by name only the Systems a System Owner can see: their own and the Onboarded ones", async () => {
      await setup();
      const { view, row } = await rowOf(asOwner(), ctx.controls.perSystem.id);
      expect(view.systems.map((system) => system.name).filter((name) => name.startsWith("Test SOA272"))).toEqual([names.alpha, names.gamma]);
      const listed = row.systemStatuses.map(([index, status]) => [view.systems[index].name, status]);
      expect(listed).toEqual(expect.arrayContaining([[names.alpha, "FULFILLED"], [names.gamma, "NOT_STARTED"]]));
      expect(listed).toHaveLength(2);
      expect(row.hiddenSystemCount).toBe(1);
      // The Draft System of someone else is a count, not a name: it appears nowhere in what reaches the client.
      expect(JSON.stringify(view)).not.toContain(names.beta);
    });

    it("lists every System for a role that sees them all", async () => {
      await setup();
      for (const user of [asCompliance(), actor("admin", "ADMIN")]) {
        const { view, row } = await rowOf(user, ctx.controls.perSystem.id);
        const listed = row.systemStatuses.map(([index, status]) => [view.systems[index].name, status]);
        expect(listed).toEqual(
          expect.arrayContaining([[names.alpha, "FULFILLED"], [names.beta, "IN_PROGRESS"], [names.gamma, "NOT_STARTED"]]),
        );
        expect(row.hiddenSystemCount).toBe(0);
      }
    });

    it("keeps the other owner's view symmetrical", async () => {
      await setup();
      const other = actor("otherOwner", "SYSTEM_OWNER");
      const { view, row } = await rowOf(other, ctx.controls.perSystem.id);
      expect(row.systemStatuses.map(([index]) => view.systems[index].name).sort()).toEqual([names.beta, names.gamma].sort());
      expect(row.hiddenSystemCount).toBe(1);
      expect(JSON.stringify(view)).not.toContain(names.alpha);
    });

    it("holds no per-System list for an Organizational Control", async () => {
      await setup();
      const { row } = await rowOf(asOwner(), ctx.controls.organizational.id);
      expect(row).toMatchObject({ systemStatuses: [], hiddenSystemCount: 0, systemRollup: null });
    });
  });

  it("says who may write: Compliance Managers and Admins only", async () => {
    for (const [key, role, canEdit] of [
      ["complianceManager", "COMPLIANCE_MANAGER", true],
      ["admin", "ADMIN", true],
      ["owner", "SYSTEM_OWNER", false],
      ["viewer", "VIEWER", false],
      ["reviewer", "REVIEWER", false],
    ] as const) {
      expect((await loadSoaView(actor(key, role))).canEdit, role).toBe(canEdit);
    }
  });
});

describe("requirementGroups", () => {
  const framework = (id: string, name: string, status: string) => ({ id, name, version: "1", status, isBase: false });

  it("groups Published codes by Framework label, numerically, once each, and leaves a Draft out", () => {
    const groups = requirementGroups([
      { requirement: { code: "A.10", framework: framework("a", "Alpha", "PUBLISHED") } },
      { requirement: { code: "A.9", framework: framework("a", "Alpha", "PUBLISHED") } },
      { requirement: { code: "A.9", framework: framework("a", "Alpha", "PUBLISHED") } },
      { requirement: { code: "Z.1", framework: framework("z", "Zulu", "PUBLISHED") } },
      { requirement: { code: "D.1", framework: framework("d", "Draft", "DRAFT") } },
    ]);
    expect(groups).toEqual([
      { framework: "Alpha:1", codes: ["A.9", "A.10"] },
      { framework: "Zulu:1", codes: ["Z.1"] },
    ]);
  });
});
