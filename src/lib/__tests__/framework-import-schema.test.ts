import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport } from "../framework-import-schema";

/** Pure checks on the Framework import format (#144): no database. */

type FileMapping = { control: string; coverage: string; rationale?: string };

function validFile() {
  return {
    framework: { name: "Test Framework", version: "1", licensing: "PARAPHRASE_ONLY", strictComplianceRequired: false },
    supplementaryControls: [
      {
        code: "TST-SUP-1",
        title: "A Supplementary Control",
        description: "Does a thing",
        category: "Test",
        applicability: "ORGANIZATIONAL",
      },
    ],
    requirements: [
      {
        code: "R-1",
        section: "Section A",
        title: "First",
        text: "Own-words text",
        mappings: [
          { control: "TST-SUP-1", coverage: "FULL", rationale: "Because" },
          { control: "SEC-001", coverage: "PARTIAL" },
        ] as FileMapping[],
      },
      { code: "R-2", section: "Section A", title: "Second", text: "More text", mappings: [] as FileMapping[] },
    ],
  };
}

function problemsOf(raw: unknown): string[] {
  const result = parseFrameworkImport(raw);
  if (result.ok) throw new Error("expected the file to be invalid");
  return result.problems;
}

describe("parseFrameworkImport", () => {
  it("accepts a valid file and fills the defaults for omitted lists", () => {
    const result = parseFrameworkImport(validFile());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.framework).toMatchObject({ name: "Test Framework", version: "1" });
    expect(result.data.requirements[1].mappings).toEqual([]);
    expect(result.data.supplementaryControls[0].code).toBe("TST-SUP-1");
  });

  it("accepts a file with no Supplementary Controls and no Requirements", () => {
    const result = parseFrameworkImport({ framework: { name: "X", version: "1" } });
    expect(result.ok).toBe(true);
  });

  it("accepts the shape of the existing iso27001-clauses.json", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "prisma", "seed-data", "iso27001-clauses.json"), "utf-8"),
    );
    const result = parseFrameworkImport(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.framework.isBase).toBe(true);
  });

  it("accepts the sample file kept under src/test/fixtures/frameworks", () => {
    const raw = JSON.parse(
      readFileSync(path.join(process.cwd(), "src", "test", "fixtures", "frameworks", "sample-framework.json"), "utf-8"),
    );
    expect(parseFrameworkImport(raw).ok).toBe(true);
  });

  it("names a duplicate Requirement code", () => {
    const file = validFile();
    file.requirements[1].code = "R-1";
    const problems = problemsOf(file);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('duplicate Requirement code "R-1"');
    expect(problems[0]).toContain("requirements[1]");
  });

  it("names a duplicate Supplementary Control code", () => {
    const file = validFile();
    file.supplementaryControls.push({ ...file.supplementaryControls[0] });
    const problems = problemsOf(file);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('duplicate Supplementary Control code "TST-SUP-1"');
  });

  it("names a Control mapped twice within one Requirement", () => {
    const file = validFile();
    file.requirements[0].mappings.push({ control: "SEC-001", coverage: "FULL" });
    const problems = problemsOf(file);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Control "SEC-001" is mapped more than once');
    expect(problems[0]).toContain('Requirement "R-1"');
  });

  it("allows the same Control to be mapped from different Requirements", () => {
    const file = validFile();
    file.requirements[1].mappings = [{ control: "SEC-001", coverage: "FULL" }];
    expect(parseFrameworkImport(file).ok).toBe(true);
  });

  it("names a bad Coverage value", () => {
    const file = validFile();
    file.requirements[0].mappings[0].coverage = "MOSTLY";
    const problems = problemsOf(file);
    expect(problems.some((p) => p.includes("requirements[0].mappings[0].coverage"))).toBe(true);
  });

  it("accepts only the enum spelling of licensing", () => {
    const file = validFile();
    (file.framework as { licensing: string }).licensing = "paraphrase-only";
    expect(problemsOf(file).some((p) => p.includes("framework.licensing"))).toBe(true);
  });

  it("names a bad applicability", () => {
    const file = validFile();
    (file.supplementaryControls[0] as { applicability: string }).applicability = "SOMETIMES";
    expect(problemsOf(file).some((p) => p.includes("supplementaryControls[0].applicability"))).toBe(true);
  });

  it("applies the Control rules: a Per-System Control needs a question", () => {
    const file = validFile();
    (file.supplementaryControls[0] as { applicability: string }).applicability = "PER_SYSTEM";
    const problems = problemsOf(file);
    expect(problems.some((p) => p.includes("Self-Assessment Question"))).toBe(true);
  });

  it("applies the Control rules: an Organizational Control carries no Deployment Facets", () => {
    const file = validFile();
    Object.assign(file.supplementaryControls[0], { deploymentFacets: ["Cloud IaaS/PaaS"] });
    expect(problemsOf(file).some((p) => p.includes("ORGANIZATIONAL controls cannot be scoped"))).toBe(true);
  });

  it("accepts a Per-System Control with a question, Deployment Facets and thresholds", () => {
    const file = validFile();
    Object.assign(file.supplementaryControls[0], {
      applicability: "PER_SYSTEM",
      question: "Is it done?",
      deploymentFacets: ["Cloud IaaS/PaaS"],
      minConfidentialityImpactLevel: "HIGH",
    });
    expect(parseFrameworkImport(file).ok).toBe(true);
  });

  it("rejects unknown keys, so a typo is not silently ignored", () => {
    const file = validFile();
    Object.assign(file.framework, { licencing: "QUOTABLE" });
    expect(problemsOf(file).some((p) => p.includes("licencing"))).toBe(true);
  });

  it("rejects an empty Requirement title or a missing code", () => {
    const file = validFile();
    file.requirements[1].title = "  ";
    delete (file.requirements[1] as { code?: string }).code;
    const problems = problemsOf(file);
    expect(problems.some((p) => p.includes("requirements[1].code"))).toBe(true);
    expect(problems.some((p) => p.includes("requirements[1].title"))).toBe(true);
  });

  it("reports every problem, not just the first", () => {
    const file = validFile();
    file.requirements[1].code = "R-1";
    file.supplementaryControls.push({ ...file.supplementaryControls[0] });
    expect(problemsOf(file).length).toBeGreaterThanOrEqual(2);
  });

  it("rejects something that is not an object", () => {
    expect(problemsOf("nope").length).toBeGreaterThan(0);
    expect(problemsOf(null).length).toBeGreaterThan(0);
  });

  it("takes supersedes as a name and version, or null", () => {
    const file = validFile();
    Object.assign(file.framework, { supersedes: { name: "Old", version: "0" } });
    expect(parseFrameworkImport(file).ok).toBe(true);
    Object.assign(file.framework, { supersedes: null });
    expect(parseFrameworkImport(file).ok).toBe(true);
    Object.assign(file.framework, { supersedes: "Old:0" });
    expect(problemsOf(file).some((p) => p.includes("framework.supersedes"))).toBe(true);
  });
});

describe("checkImportReferences", () => {
  function parsed() {
    const result = parseFrameworkImport(validFile());
    if (!result.ok) throw new Error("fixture must be valid");
    return result.data;
  }

  it("passes when every mapped Control exists or is a Supplementary Control of the file", () => {
    expect(checkImportReferences(parsed(), { controlCodes: new Set(["SEC-001"]), facetNames: new Set() })).toEqual([]);
  });

  it("names a mapping to a Control that is neither in the database nor in the file", () => {
    const problems = checkImportReferences(parsed(), { controlCodes: new Set(), facetNames: new Set() });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Control "SEC-001"');
    expect(problems[0]).toContain('Requirement "R-1"');
  });

  it("names a Deployment Facet that does not exist", () => {
    const data = parsed();
    data.supplementaryControls[0].deploymentFacets = ["No Such Facet"];
    const problems = checkImportReferences(data, { controlCodes: new Set(["SEC-001"]), facetNames: new Set(["Other"]) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Deployment Facet "No Such Facet"');
  });
});
