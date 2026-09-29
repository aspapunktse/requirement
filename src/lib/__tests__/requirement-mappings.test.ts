import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { frameworkLabel, satisfiesEntries, satisfiesLabel } from "../framework-label";

const SUFFIX = Date.now();

describe("Requirement and Control Mapping constraints", () => {
  let frameworkAId: string;
  let frameworkBId: string;
  let controlId: string;

  beforeAll(async () => {
    frameworkAId = (await prisma.framework.create({ data: { name: `Test RM FW A ${SUFFIX}`, version: "1" } })).id;
    frameworkBId = (await prisma.framework.create({ data: { name: `Test RM FW B ${SUFFIX}`, version: "1" } })).id;
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-RM-${SUFFIX}`,
          title: "t",
          description: "d",
          category: "Test",
          applicability: "ORGANIZATIONAL",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkAId, frameworkBId] } } });
  });

  function requirement(frameworkId: string, code: string) {
    return prisma.requirement.create({ data: { frameworkId, code, section: "S", title: "t", text: "x" } });
  }

  it("a Requirement code is unique per Framework, but may repeat across Frameworks", async () => {
    await requirement(frameworkAId, "1.1");
    await expect(requirement(frameworkAId, "1.1")).rejects.toMatchObject({ code: "P2002" });
    await expect(requirement(frameworkBId, "1.1")).resolves.toBeTruthy();
  });

  it("allows one Control Mapping per (Requirement, Control) pair, and cascades with its Requirement", async () => {
    const req = await requirement(frameworkAId, "2.1");
    await prisma.controlMapping.create({
      data: { requirementId: req.id, controlId, coverage: "PARTIAL", rationale: "half" },
    });

    await expect(
      prisma.controlMapping.create({ data: { requirementId: req.id, controlId, coverage: "FULL" } }),
    ).rejects.toSatisfy((e) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");

    await prisma.requirement.delete({ where: { id: req.id } });
    expect(await prisma.controlMapping.count({ where: { requirementId: req.id } })).toBe(0);
  });

  it("a Control is a base Control unless it records an origin Framework (Supplementary)", async () => {
    const base = await prisma.control.findUniqueOrThrow({ where: { id: controlId } });
    expect(base.originFrameworkId).toBeNull();

    const supplementary = await prisma.control.create({
      data: {
        code: `TEST-RM-SUPP-${SUFFIX}`,
        title: "t",
        description: "d",
        category: "Test",
        applicability: "ORGANIZATIONAL",
        originFramework: { connect: { id: frameworkAId } },
      },
    });
    try {
      // The origin Framework cannot be deleted out from under a Supplementary Control.
      await expect(prisma.framework.delete({ where: { id: frameworkAId } })).rejects.toMatchObject({
        code: "P2003",
      });
    } finally {
      await prisma.control.delete({ where: { id: supplementary.id } });
    }
  });

  it("a Change Event can be System-less, with the new requirement-database actions", async () => {
    const mapping = await prisma.changeEvent.create({
      data: { action: "CONTROL_MAPPING_CHANGED", detail: "test", actorId: "system" },
    });
    const published = await prisma.changeEvent.create({
      data: { action: "FRAMEWORK_PUBLISHED", detail: "test", actorId: "system" },
    });
    try {
      expect(mapping.systemId).toBeNull();
      expect(published.systemId).toBeNull();
    } finally {
      await prisma.changeEvent.deleteMany({ where: { id: { in: [mapping.id, published.id] } } });
    }
  });
});

describe("the seeded base Framework (ISO/IEC 27001:2022 Annex A)", () => {
  it("is the one base Framework, Published and paraphrase-only", async () => {
    const bases = await prisma.framework.findMany({ where: { isBase: true } });
    expect(bases).toHaveLength(1);
    expect(bases[0]).toMatchObject({
      name: "ISO/IEC 27001",
      version: "2022",
      status: "PUBLISHED",
      licensing: "PARAPHRASE_ONLY",
    });
  });

  it("has its 93 Annex A Requirements, each mapped FULL 1:1 to the Control with the same code", async () => {
    const requirements = await prisma.requirement.findMany({
      where: { framework: { isBase: true }, code: { startsWith: "A." } },
      include: { mappings: { include: { control: true } } },
    });
    expect(requirements).toHaveLength(93);
    for (const requirement of requirements) {
      expect(requirement.mappings).toHaveLength(1);
      const [mapping] = requirement.mappings;
      expect(mapping.coverage).toBe("FULL");
      expect(mapping.control.code).toBe(requirement.code);
      expect(requirement.section).toBe(mapping.control.category);
      expect(requirement.title).toBe(mapping.control.title);
      expect(mapping.control.originFrameworkId).toBeNull();
    }
  });
});

describe("Framework labels", () => {
  const iso = { name: "ISO/IEC 27001", version: "2022" };
  const nis2 = { name: "NIS2", version: "2022" };

  it("names a Framework name:version", () => {
    expect(frameworkLabel(iso)).toBe("ISO/IEC 27001:2022");
    expect(frameworkLabel({ name: "GDPR" })).toBe("GDPR");
  });

  it("derives the Satisfies line from mappings, sorted, marking Partial Coverage", () => {
    const mappings = [
      { coverage: "PARTIAL" as const, requirement: { code: "Art. 21", framework: nis2 } },
      { coverage: "FULL" as const, requirement: { code: "A.8.24", framework: iso } },
      { coverage: "FULL" as const, requirement: { code: "A.5.3", framework: iso } },
    ];
    expect(satisfiesEntries(mappings)).toEqual([
      "ISO/IEC 27001:2022 A.5.3",
      "ISO/IEC 27001:2022 A.8.24",
      "NIS2:2022 Art. 21 (partial)",
    ]);
    expect(satisfiesLabel(mappings)).toBe(
      "Satisfies: ISO/IEC 27001:2022 A.5.3, ISO/IEC 27001:2022 A.8.24, NIS2:2022 Art. 21 (partial)",
    );
    expect(satisfiesLabel([])).toBeNull();
  });
});
