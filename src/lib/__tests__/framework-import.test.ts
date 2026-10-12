import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";
import { describeLoadResult, loadFramework, type LoadResult } from "../framework-import";
import { parseFrameworkImport, type FrameworkImport } from "../framework-import-schema";

/**
 * The Framework loader against real Postgres (#144). Self-contained fixtures:
 * CI's database is migrated, not seeded. Everything is named `Test 144 …` /
 * `TEST-144-…`, only ever mapped to the Frameworks the loader creates here
 * (never the base), and removed again at the end.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const NAME_PREFIX = `Test 144 Loader ${SUFFIX}`;
const CODE_PREFIX = `TEST-144-${SUFFIX}`;
let counter = 0;
const freshName = () => `${NAME_PREFIX} ${++counter}`;

type Loose = Record<string, unknown>;

function fileFor(
  name: string,
  parts: { framework?: Loose; supplementaryControls?: Loose[]; requirements?: Loose[] } = {},
): FrameworkImport {
  const result = parseFrameworkImport({
    framework: { name, version: "1", ...parts.framework },
    supplementaryControls: parts.supplementaryControls ?? [],
    requirements: parts.requirements ?? [],
  });
  if (!result.ok) throw new Error(result.problems.join("; "));
  return result.data;
}

const requirement = (code: string, mappings: Loose[] = [], extra: Loose = {}): Loose => ({
  code,
  section: "Section",
  title: `Title ${code}`,
  text: `Text ${code}`,
  mappings,
  ...extra,
});
const supplementary = (code: string, extra: Loose = {}): Loose => ({
  code: `${CODE_PREFIX}-${code}`,
  title: `Supplementary ${code}`,
  description: `Description ${code}`,
  category: "Test",
  applicability: "ORGANIZATIONAL",
  ...extra,
});
const map = (control: string, coverage: "FULL" | "PARTIAL" = "FULL", rationale?: string): Loose => ({
  control,
  coverage,
  ...(rationale !== undefined && { rationale }),
});

describe("loadFramework (#144)", { timeout: 60_000 }, () => {
  let ownerId: string;
  let facetId: string;
  let facetName: string;
  let orgControl: { id: string; code: string };
  let orgControl2: { id: string; code: string };
  let perSystemControl: { id: string; code: string };
  const systemIds: string[] = [];

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-144-${SUFFIX}@example.com`, name: "Loader Owner", role: "SYSTEM_OWNER" } })).id;
    facetName = `Test 144 Facet ${SUFFIX}`;
    facetId = (await prisma.deploymentFacet.create({ data: { name: facetName } })).id;
    const base = { title: "Test 144 control", description: "d", category: "Test", mandatory: true };
    orgControl = await prisma.control.create({
      data: { ...base, code: `${CODE_PREFIX}-ORG1`, applicability: "ORGANIZATIONAL", examples: [] },
      select: { id: true, code: true },
    });
    orgControl2 = await prisma.control.create({
      data: { ...base, code: `${CODE_PREFIX}-ORG2`, applicability: "ORGANIZATIONAL", examples: [] },
      select: { id: true, code: true },
    });
    perSystemControl = await prisma.control.create({
      data: {
        ...base,
        code: `${CODE_PREFIX}-PS1`,
        applicability: "PER_SYSTEM",
        question: "Is it done?",
        examples: [],
        deploymentFacets: { connect: [{ id: facetId }] },
      },
      select: { id: true, code: true },
    });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({
      where: { OR: [{ systemId: { in: systemIds } }, { systemId: null, detail: { contains: NAME_PREFIX } }] },
    });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    // A Control with an origin Framework must go before its Framework.
    await prisma.control.deleteMany({ where: { code: { startsWith: CODE_PREFIX } } });
    await prisma.framework.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  const load = (data: FrameworkImport, options: { allowPublished?: boolean; source?: string } = {}) =>
    loadFramework(prisma, data, options);

  async function loaded(data: FrameworkImport, options: { allowPublished?: boolean; source?: string } = {}) {
    const result = await load(data, options);
    if (result.status !== "loaded") throw new Error(`expected a load, got ${JSON.stringify(result)}`);
    return result.summary;
  }

  const frameworkRow = (name: string) => prisma.framework.findUnique({ where: { name_version: { name, version: "1" } } });
  const frameworkEvents = (name: string) =>
    prisma.changeEvent.findMany({ where: { systemId: null, detail: { contains: name } }, orderBy: { createdAt: "asc" } });

  /** Everything the loader can write for a Framework, so "no DB change" is one equality. */
  async function dump(name: string) {
    const framework = await frameworkRow(name);
    if (!framework) return null;
    const [requirements, controls, events] = await Promise.all([
      prisma.requirement.findMany({
        where: { frameworkId: framework.id },
        orderBy: { code: "asc" },
        include: { mappings: { orderBy: { controlId: "asc" } } },
      }),
      prisma.control.findMany({ where: { originFrameworkId: framework.id }, orderBy: { code: "asc" } }),
      frameworkEvents(name),
    ]);
    return JSON.stringify({ framework, requirements, controls, events });
  }

  async function publishDirectly(name: string) {
    await prisma.framework.update({ where: { name_version: { name, version: "1" } }, data: { status: "PUBLISHED" } });
  }

  async function systemInScopeOf(name: string) {
    const framework = await frameworkRow(name);
    const system = await prisma.system.create({
      data: {
        name: `Test 144 System ${SUFFIX}-${++counter}`,
        ownerId,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: [{ id: framework!.id }] },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  describe("a new Framework", () => {
    it("is created as a Draft with its Requirements, mappings and Supplementary Controls", async () => {
      const name = freshName();
      const supCode = `${CODE_PREFIX}-S1`;
      const summary = await loaded(
        fileFor(name, {
          framework: { description: "A test Framework", licensing: "QUOTABLE", strictComplianceRequired: true },
          supplementaryControls: [supplementary("S1", { mandatory: false, examples: ["one", "two"] })],
          requirements: [
            requirement("R-1", [map(orgControl.code, "FULL", "Because"), map(supCode, "PARTIAL")]),
            requirement("R-2", [map(orgControl2.code)]),
            requirement("R-3"),
          ],
        }),
      );

      expect(summary).toMatchObject({
        framework: "created",
        requirements: { created: 3, updated: 0, unchanged: 0, notInFile: [] },
        mappings: { created: 3, updated: 0, removed: 0, unchanged: 0 },
        supplementaryControls: { created: 1, updated: 0, unchanged: 0 },
        changeEvents: 0,
        recompute: null,
        changed: true,
      });

      const framework = await prisma.framework.findUniqueOrThrow({
        where: { name_version: { name, version: "1" } },
        include: { requirements: { include: { mappings: { include: { control: true } } }, orderBy: { code: "asc" } } },
      });
      expect(framework).toMatchObject({
        status: "DRAFT",
        isBase: false,
        description: "A test Framework",
        licensing: "QUOTABLE",
        strictComplianceRequired: true,
      });
      expect(framework.requirements.map((r) => r.code)).toEqual(["R-1", "R-2", "R-3"]);
      const r1 = framework.requirements[0];
      expect(r1).toMatchObject({ section: "Section", title: "Title R-1", text: "Text R-1" });
      expect(r1.mappings.map((m) => [m.control.code, m.coverage, m.rationale]).sort()).toEqual(
        [
          [orgControl.code, "FULL", "Because"],
          [supCode, "PARTIAL", null],
        ].sort(),
      );
      expect(framework.requirements[2].mappings).toEqual([]);

      const control = await prisma.control.findUniqueOrThrow({
        where: { code: supCode },
        include: { organizationImplementation: true },
      });
      expect(control).toMatchObject({ originFrameworkId: framework.id, mandatory: false, examples: ["one", "two"], applicability: "ORGANIZATIONAL" });
      // Created like a Control from the API: an Organizational Control starts with a Not Started implementation.
      expect(control.organizationImplementation).toMatchObject({ status: "NOT_STARTED" });
    });

    it("writes no Change Events and creates no Control Assessments, as a Draft is inert", async () => {
      const name = freshName();
      await loaded(fileFor(name));
      const system = await systemInScopeOf(name);
      const eventsBefore = await prisma.changeEvent.count({ where: { systemId: system.id } });

      await loaded(
        fileFor(name, {
          supplementaryControls: [
            supplementary("D1", { applicability: "PER_SYSTEM", question: "Done?", deploymentFacets: [facetName] }),
          ],
          requirements: [requirement("R-1", [map(perSystemControl.code), map(`${CODE_PREFIX}-D1`)])],
        }),
      );

      expect(await frameworkEvents(name)).toEqual([]);
      expect(await prisma.changeEvent.count({ where: { systemId: system.id } })).toBe(eventsBefore);
      const control = await prisma.control.findUniqueOrThrow({ where: { code: `${CODE_PREFIX}-D1` } });
      expect(
        await prisma.controlAssessment.count({ where: { controlId: { in: [control.id, perSystemControl.id] }, systemId: system.id } }),
      ).toBe(0);
    });

    it("gives a Supplementary Control its Deployment Facets and Impact Level threshold", async () => {
      const name = freshName();
      await loaded(
        fileFor(name, {
          supplementaryControls: [
            supplementary("F1", {
              applicability: "BOTH",
              question: "Done?",
              deploymentFacets: [facetName],
              minConfidentialityImpactLevel: "HIGH",
            }),
          ],
        }),
      );
      const control = await prisma.control.findUniqueOrThrow({
        where: { code: `${CODE_PREFIX}-F1` },
        include: { deploymentFacets: true, organizationImplementation: true },
      });
      expect(control.deploymentFacets.map((f) => f.name)).toEqual([facetName]);
      expect(control.minConfidentialityImpactLevel).toBe("HIGH");
      expect(control.organizationImplementation).not.toBeNull();
    });
  });

  describe("idempotence", () => {
    it("a second run of the same file reports no change and writes nothing", async () => {
      const name = freshName();
      const data = fileFor(name, {
        supplementaryControls: [supplementary("I1", { examples: ["a"] })],
        requirements: [
          requirement("R-1", [map(orgControl.code, "FULL", "why"), map(`${CODE_PREFIX}-I1`, "PARTIAL")]),
          requirement("R-2", [map(orgControl2.code)]),
        ],
        framework: { description: "d", licensing: "PARAPHRASE_ONLY", strictComplianceRequired: false },
      });
      await loaded(data);
      const framework = (await frameworkRow(name))!;
      const requirementsBefore = await prisma.requirement.findMany({ where: { frameworkId: framework.id }, orderBy: { code: "asc" } });
      const mappingsBefore = await prisma.controlMapping.findMany({
        where: { requirement: { frameworkId: framework.id } },
        orderBy: [{ requirementId: "asc" }, { controlId: "asc" }],
      });
      const dumpBefore = await dump(name);

      const summary = await loaded(data);

      expect(summary).toMatchObject({
        framework: "unchanged",
        requirements: { created: 0, updated: 0, unchanged: 2 },
        mappings: { created: 0, updated: 0, removed: 0, unchanged: 3 },
        supplementaryControls: { created: 0, updated: 0, unchanged: 1 },
        changeEvents: 0,
        changed: false,
      });
      expect(await dump(name)).toBe(dumpBefore);
      // updatedAt would move on any write.
      expect(await prisma.requirement.findMany({ where: { frameworkId: framework.id }, orderBy: { code: "asc" } })).toEqual(requirementsBefore);
      expect(
        await prisma.controlMapping.findMany({
          where: { requirement: { frameworkId: framework.id } },
          orderBy: [{ requirementId: "asc" }, { controlId: "asc" }],
        }),
      ).toEqual(mappingsBefore);
    });
  });

  describe("editing the file and loading again", () => {
    it("updates a Draft: changed text, an added Requirement, a changed Coverage, a changed Supplementary Control", async () => {
      const name = freshName();
      await loaded(
        fileFor(name, {
          supplementaryControls: [supplementary("E1")],
          requirements: [requirement("R-1", [map(orgControl.code, "PARTIAL")]), requirement("R-2")],
        }),
      );

      const summary = await loaded(
        fileFor(name, {
          framework: { description: "now described" },
          supplementaryControls: [supplementary("E1", { title: "Renamed", examples: ["x"], mandatory: false })],
          requirements: [
            requirement("R-1", [map(orgControl.code, "FULL", "now full")], { text: "Changed text", section: "New section" }),
            requirement("R-2"),
            requirement("R-3", [map(orgControl2.code)]),
          ],
        }),
      );

      expect(summary).toMatchObject({
        framework: "updated",
        requirements: { created: 1, updated: 1, unchanged: 1 },
        mappings: { created: 1, updated: 1, removed: 0, unchanged: 0 },
        supplementaryControls: { updated: 1 },
        changeEvents: 0,
      });
      const framework = await prisma.framework.findUniqueOrThrow({
        where: { name_version: { name, version: "1" } },
        include: { requirements: { include: { mappings: true }, orderBy: { code: "asc" } } },
      });
      expect(framework.description).toBe("now described");
      expect(framework.requirements.map((r) => r.code)).toEqual(["R-1", "R-2", "R-3"]);
      expect(framework.requirements[0]).toMatchObject({ text: "Changed text", section: "New section" });
      expect(framework.requirements[0].mappings[0]).toMatchObject({ coverage: "FULL", rationale: "now full" });
      expect(framework.requirements[2].mappings).toHaveLength(1);
      expect(await prisma.control.findUniqueOrThrow({ where: { code: `${CODE_PREFIX}-E1` } })).toMatchObject({
        title: "Renamed",
        examples: ["x"],
        mandatory: false,
      });
      expect(await frameworkEvents(name)).toEqual([]);
    });

    it("removes a mapping the file no longer lists, but keeps Requirements and Supplementary Controls missing from it", async () => {
      const name = freshName();
      await loaded(
        fileFor(name, {
          supplementaryControls: [supplementary("K1"), supplementary("K2")],
          requirements: [
            requirement("R-1", [map(orgControl.code), map(orgControl2.code)]),
            requirement("R-2", [map(orgControl.code)]),
          ],
        }),
      );

      const summary = await loaded(
        fileFor(name, {
          supplementaryControls: [supplementary("K1")],
          requirements: [requirement("R-1", [map(orgControl.code)])],
        }),
      );

      expect(summary.mappings).toMatchObject({ removed: 1, created: 0 });
      expect(summary.requirements.notInFile).toEqual(["R-2"]);
      const framework = (await frameworkRow(name))!;
      const requirements = await prisma.requirement.findMany({
        where: { frameworkId: framework.id },
        include: { mappings: { include: { control: true } } },
        orderBy: { code: "asc" },
      });
      expect(requirements.map((r) => r.code)).toEqual(["R-1", "R-2"]);
      expect(requirements[0].mappings.map((m) => m.control.code)).toEqual([orgControl.code]);
      // R-2 is not in the file, so its mapping is left alone too.
      expect(requirements[1].mappings.map((m) => m.control.code)).toEqual([orgControl.code]);
      expect(await prisma.control.count({ where: { originFrameworkId: framework.id } })).toBe(2);
      expect(describeLoadResult("f.json", { status: "loaded", framework: { name, version: "1", status: "DRAFT" }, summary }).join("\n")).toContain(
        "R-2",
      );
    });

    it("leaves an omitted optional field as it is, and clears it with null", async () => {
      const name = freshName();
      await loaded(fileFor(name, { framework: { description: "keep me", strictComplianceRequired: true } }));
      await loaded(fileFor(name));
      expect(await frameworkRow(name)).toMatchObject({ description: "keep me", strictComplianceRequired: true });
      await loaded(fileFor(name, { framework: { description: null } }));
      expect((await frameworkRow(name))!.description).toBeNull();
    });

    it("a mapping that becomes Full clears a gap acceptance, as the UI does", async () => {
      const name = freshName();
      await loaded(fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code, "PARTIAL")])] }));
      const framework = (await frameworkRow(name))!;
      await prisma.requirement.updateMany({
        where: { frameworkId: framework.id },
        data: { gapAcceptedAt: new Date(), gapJustification: "Accepted for the test" },
      });

      await loaded(fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code, "FULL")])] }));

      expect(await prisma.requirement.findFirstOrThrow({ where: { frameworkId: framework.id } })).toMatchObject({
        gapAcceptedAt: null,
        gapJustification: null,
      });
    });
  });

  describe("an invalid file", () => {
    async function expectInvalid(name: string, data: FrameworkImport, expected: RegExp, options = {}) {
      const before = await dump(name);
      const result = await load(data, options);
      expect(result.status).toBe("invalid");
      if (result.status !== "invalid") return;
      expect(result.problems.join("\n")).toMatch(expected);
      expect(await dump(name)).toBe(before);
      return result;
    }

    it("rejects a mapping to a Control that exists nowhere, creating nothing", async () => {
      const name = freshName();
      await expectInvalid(
        name,
        fileFor(name, {
          supplementaryControls: [supplementary("V1")],
          requirements: [requirement("R-1", [map(`${CODE_PREFIX}-NOPE`)])],
        }),
        /Control "TEST-144-.*-NOPE".*does not exist/,
      );
      expect(await frameworkRow(name)).toBeNull();
      expect(await prisma.control.count({ where: { code: `${CODE_PREFIX}-V1` } })).toBe(0);
    });

    it("rejects an unknown Deployment Facet", async () => {
      const name = freshName();
      await expectInvalid(
        name,
        fileFor(name, {
          supplementaryControls: [supplementary("V2", { applicability: "PER_SYSTEM", question: "q?", deploymentFacets: ["No Such Facet"] })],
        }),
        /Deployment Facet "No Such Facet" does not exist/,
      );
    });

    it("rejects a Supplementary Control whose code is a base Control", async () => {
      const name = freshName();
      await expectInvalid(
        name,
        fileFor(name, { supplementaryControls: [{ ...supplementary("V3"), code: orgControl.code }] }),
        /already exists as a base Control/,
      );
    });

    it("rejects a Supplementary Control whose code belongs to another Framework", async () => {
      const first = freshName();
      await loaded(fileFor(first, { supplementaryControls: [supplementary("V4")] }));
      const second = freshName();
      await expectInvalid(
        second,
        fileFor(second, { supplementaryControls: [supplementary("V4")] }),
        new RegExp(`Supplementary Control of ${first}:1`),
      );
      // The Control still belongs to the first Framework.
      const control = await prisma.control.findUniqueOrThrow({ where: { code: `${CODE_PREFIX}-V4` }, include: { originFramework: true } });
      expect(control.originFramework!.name).toBe(first);
    });

    it("refuses to change a Supplementary Control's applicability", async () => {
      const name = freshName();
      await loaded(fileFor(name, { supplementaryControls: [supplementary("V5")] }));
      await expectInvalid(
        name,
        fileFor(name, { supplementaryControls: [supplementary("V5", { applicability: "BOTH", question: "q?" })] }),
        /doesn't change a Control's applicability/,
      );
    });

    it("rejects supersedes pointing at a Framework that does not exist", async () => {
      const name = freshName();
      await expectInvalid(
        name,
        fileFor(name, { framework: { supersedes: { name: `${NAME_PREFIX} missing`, version: "9" } } }),
        /does not exist/,
      );
      expect(await frameworkRow(name)).toBeNull();
    });

    it("rejects a supersedes link that would close a loop", async () => {
      const older = freshName();
      const newer = freshName();
      await loaded(fileFor(older));
      await loaded(fileFor(newer, { framework: { supersedes: { name: older, version: "1" } } }));
      await expectInvalid(
        older,
        fileFor(older, { framework: { supersedes: { name: newer, version: "1" } } }),
        /can't supersede itself/,
      );
    });

    it("rejects a file that says isBase for a Framework that does not exist", async () => {
      const name = freshName();
      await expectInvalid(name, fileFor(name, { framework: { isBase: true } }), /never creates the base Framework/);
      expect(await frameworkRow(name)).toBeNull();
    });

    it("rejects isBase: true on a Framework that is not the base, and never flips isBase", async () => {
      const name = freshName();
      await loaded(fileFor(name));
      await expectInvalid(name, fileFor(name, { framework: { isBase: true } }), /is not the base Framework/);
      expect((await frameworkRow(name))!.isBase).toBe(false);
    });
  });

  describe("supersedes", () => {
    it("links the Framework to the one it replaces, and unlinks it with null", async () => {
      const older = freshName();
      const newer = freshName();
      await loaded(fileFor(older));
      await loaded(fileFor(newer, { framework: { supersedes: { name: older, version: "1" } } }));
      expect((await frameworkRow(newer))!.supersedesId).toBe((await frameworkRow(older))!.id);
      const again = await loaded(fileFor(newer, { framework: { supersedes: { name: older, version: "1" } } }));
      expect(again.changed).toBe(false);
      await loaded(fileFor(newer, { framework: { supersedes: null } }));
      expect((await frameworkRow(newer))!.supersedesId).toBeNull();
    });
  });

  describe("a Published Framework", () => {
    it("is refused without the flag, with no DB change", async () => {
      const name = freshName();
      await loaded(fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code)])] }));
      await publishDirectly(name);
      const before = await dump(name);

      const result = await load(
        fileFor(name, {
          framework: { description: "changed" },
          supplementaryControls: [supplementary("P0")],
          requirements: [requirement("R-1", [map(orgControl.code, "PARTIAL")], { text: "changed" }), requirement("R-2")],
        }),
      );

      expect(result.status).toBe("refused");
      if (result.status === "refused") expect(result.reason).toMatch(/Published.*--allow-published/);
      expect(await dump(name)).toBe(before);
      expect(await prisma.control.count({ where: { code: `${CODE_PREFIX}-P0` } })).toBe(0);
    });

    it("is updated with the flag, logging mapping changes and recomputing the Systems in scope", async () => {
      const name = freshName();
      await loaded(fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code, "PARTIAL")])] }));
      await publishDirectly(name);
      const system = await systemInScopeOf(name);

      // Add a mapping to a Per-System Control, change a Coverage, change text.
      const first = await loaded(
        fileFor(name, {
          requirements: [
            requirement("R-1", [map(orgControl.code, "FULL"), map(perSystemControl.code)], { text: "New text" }),
          ],
        }),
        { allowPublished: true, source: "test-file.json" },
      );

      expect(first).toMatchObject({
        framework: "unchanged",
        requirements: { updated: 1 },
        mappings: { created: 1, updated: 1, removed: 0 },
        changeEvents: 2,
        changed: true,
      });
      expect(first.recompute).toMatchObject({ changed: 1, added: 1 });
      expect((await frameworkRow(name))!.status).toBe("PUBLISHED");
      expect(await prisma.controlAssessment.findMany({ where: { systemId: system.id, controlId: perSystemControl.id } })).toMatchObject([
        { status: "NOT_STARTED" },
      ]);
      const events = await frameworkEvents(name);
      expect(events.map((e) => e.action)).toEqual(["CONTROL_MAPPING_CHANGED", "CONTROL_MAPPING_CHANGED"]);
      expect(events.every((e) => e.actorId === "system" && e.detail.includes("test-file.json"))).toBe(true);
      expect(events.map((e) => e.detail).join("\n")).toContain(`Control Mapping added: Requirement ${name}:1 R-1 ↔ Control ${perSystemControl.code} (none → FULL)`);
      expect(events.map((e) => e.detail).join("\n")).toContain(`(PARTIAL → FULL)`);
      expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "APPLICABILITY_RECOMPUTED" } })).toBe(1);

      // Remove the mapping again: the untouched Assessment goes.
      const second = await loaded(
        fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code, "FULL")], { text: "New text" })] }),
        { allowPublished: true, source: "test-file.json" },
      );
      expect(second).toMatchObject({ mappings: { removed: 1 }, changeEvents: 1 });
      expect(second.recompute).toMatchObject({ removed: 1 });
      expect(await prisma.controlAssessment.count({ where: { systemId: system.id, controlId: perSystemControl.id } })).toBe(0);
      expect((await frameworkEvents(name)).at(-1)!.detail).toContain("Control Mapping removed");

      // And a third run changes nothing, flag or not.
      const eventsBefore = (await frameworkEvents(name)).length;
      const third = await loaded(
        fileFor(name, { requirements: [requirement("R-1", [map(orgControl.code, "FULL")], { text: "New text" })] }),
        { allowPublished: true },
      );
      expect(third.changed).toBe(false);
      expect((await frameworkEvents(name)).length).toBe(eventsBefore);
    });

    it("makes a newly created Supplementary Control applicable through its new mapping", async () => {
      const name = freshName();
      await loaded(fileFor(name, { requirements: [requirement("R-1")] }));
      await publishDirectly(name);
      const system = await systemInScopeOf(name);

      const summary = await loaded(
        fileFor(name, {
          supplementaryControls: [
            supplementary("P1", { applicability: "PER_SYSTEM", question: "Done?", deploymentFacets: [facetName] }),
          ],
          requirements: [requirement("R-1", [map(`${CODE_PREFIX}-P1`)])],
        }),
        { allowPublished: true },
      );

      expect(summary.recompute).toMatchObject({ added: 1 });
      const control = await prisma.control.findUniqueOrThrow({ where: { code: `${CODE_PREFIX}-P1` } });
      expect(await prisma.controlAssessment.count({ where: { systemId: system.id, controlId: control.id } })).toBe(1);
    });

    it("recomputes when a Supplementary Control's Deployment Facets change", async () => {
      const name = freshName();
      await loaded(
        fileFor(name, {
          supplementaryControls: [supplementary("P2", { applicability: "PER_SYSTEM", question: "Done?", deploymentFacets: [facetName] })],
          requirements: [requirement("R-1", [map(`${CODE_PREFIX}-P2`)])],
        }),
      );
      await publishDirectly(name);
      const system = await systemInScopeOf(name);
      const control = await prisma.control.findUniqueOrThrow({ where: { code: `${CODE_PREFIX}-P2` } });
      await prisma.controlAssessment.create({ data: { systemId: system.id, controlId: control.id } });

      // Scope it to a threshold the System doesn't reach: it stops applying and its untouched Assessment goes.
      const summary = await loaded(
        fileFor(name, {
          supplementaryControls: [
            supplementary("P2", { applicability: "PER_SYSTEM", question: "Done?", minConfidentialityImpactLevel: "CRITICAL" }),
          ],
          requirements: [requirement("R-1", [map(`${CODE_PREFIX}-P2`)])],
        }),
        { allowPublished: true },
      );

      expect(summary.supplementaryControls.updated).toBe(1);
      expect(summary.recompute).toMatchObject({ removed: 1 });
      expect(await prisma.controlAssessment.count({ where: { systemId: system.id, controlId: control.id } })).toBe(0);
    });
  });

  describe("the base Framework", () => {
    it("is refused without the flag, with no DB change", async () => {
      const base = await getBaseFramework();
      const before = await prisma.requirement.count({ where: { frameworkId: base.id } });
      const result = await load(
        fileFor(base.name, {
          framework: { version: base.version, isBase: true },
          requirements: [requirement(`${CODE_PREFIX}-BASE`)],
        }),
      );
      expect(result.status).toBe("refused");
      expect(await prisma.requirement.count({ where: { frameworkId: base.id } })).toBe(before);
    });

    it("is invalid when the file does not say isBase: true, even with the flag", async () => {
      const base = await getBaseFramework();
      const result = await load(
        fileFor(base.name, { framework: { version: base.version }, requirements: [requirement(`${CODE_PREFIX}-BASE`)] }),
        { allowPublished: true },
      );
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") expect(result.problems.join()).toMatch(/is the base Framework/);
      expect(await prisma.requirement.count({ where: { frameworkId: base.id, code: `${CODE_PREFIX}-BASE` } })).toBe(0);
    });

    it("is accepted with the flag when the file matches it by name, version and isBase, and an empty file changes nothing", async () => {
      const base = await getBaseFramework();
      const result = await load(fileFor(base.name, { framework: { version: base.version, isBase: true } }), { allowPublished: true });
      expect(result).toMatchObject({ status: "loaded", summary: { changed: false } });
      expect(await getBaseFramework()).toEqual(base);
    });
  });

  describe("describeLoadResult", () => {
    it("names the problems of an invalid file and the reason for a refusal", () => {
      const invalid: LoadResult = { status: "invalid", problems: ["a is wrong", "b is wrong"] };
      expect(describeLoadResult("x.json", invalid)).toEqual(["x.json: INVALID, nothing changed", "  - a is wrong", "  - b is wrong"]);
      expect(describeLoadResult("x.json", { status: "refused", reason: "it is Published" })[0]).toBe("x.json: REFUSED. it is Published");
    });
  });
});
