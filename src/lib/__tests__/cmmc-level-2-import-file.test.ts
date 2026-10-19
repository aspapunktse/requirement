import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport } from "../framework-import-schema";

/**
 * Pure checks on the CMMC Level 2 (2.0) Framework import file (#210): it parses
 * with the real import parser, holds the 110 NIST SP 800-171 Rev. 2 practices of
 * the CMMC Level 2 Assessment Guide v2 in source order, maps only to Controls
 * that exist (Annex A, ISMS clauses or its own Supplementary Controls), and
 * stays independent of the Level 1 file. Reads files only, never the database
 * (CI's DB is migrated but not seeded).
 */

const seedDir = path.join(process.cwd(), "prisma", "seed-data");
const frameworksDir = path.join(seedDir, "frameworks");
const raw = JSON.parse(readFileSync(path.join(frameworksDir, "cmmc-level-2-2.0.json"), "utf-8"));
const level1Raw = JSON.parse(readFileSync(path.join(frameworksDir, "cmmc-level-1-2.0.json"), "utf-8"));
const annexA: { code: string }[] = JSON.parse(readFileSync(path.join(seedDir, "iso27001-annex-a.json"), "utf-8"));
const clauses: { supplementaryControls: { code: string }[] } = JSON.parse(
  readFileSync(path.join(seedDir, "iso27001-clauses.json"), "utf-8"),
);

// [family name, family prefix, NIST requirement numbers], in the order of the Assessment Guide.
const range = (family: number, count: number) => Array.from({ length: count }, (_, i) => `3.${family}.${i + 1}`);
const FAMILIES: [string, string, string[]][] = [
  ["Access Control", "AC", range(1, 22)],
  ["Awareness and Training", "AT", range(2, 3)],
  ["Audit and Accountability", "AU", range(3, 9)],
  ["Configuration Management", "CM", range(4, 9)],
  ["Identification and Authentication", "IA", range(5, 11)],
  ["Incident Response", "IR", range(6, 3)],
  ["Maintenance", "MA", range(7, 6)],
  ["Media Protection", "MP", range(8, 9)],
  ["Personnel Security", "PS", range(9, 2)],
  ["Physical Protection", "PE", range(10, 6)],
  ["Risk Assessment", "RA", range(11, 3)],
  ["Security Assessment", "CA", range(12, 4)],
  ["System and Communications Protection", "SC", range(13, 16)],
  ["System and Information Integrity", "SI", range(14, 7)],
];
const EXPECTED_CODES = FAMILIES.flatMap(([, prefix, numbers]) => numbers.map((n) => `${prefix}.L2-${n}`));

const parsed = parseFrameworkImport(raw);
if (!parsed.ok) throw new Error(`cmmc-level-2-2.0.json does not parse: ${parsed.problems.join("; ")}`);
const data = parsed.data;
const level1 = parseFrameworkImport(level1Raw);
if (!level1.ok) throw new Error(`cmmc-level-1-2.0.json does not parse: ${level1.problems.join("; ")}`);
const annexCodes = new Set(annexA.map((control) => control.code));
const clauseCodes = new Set(clauses.supplementaryControls.map((control) => control.code));
const ownCodes = new Set(data.supplementaryControls.map((control) => control.code));
const byCode = new Map(data.requirements.map((requirement) => [requirement.code, requirement]));

// Level 2 practices that cover the same ground as a Level 1 practice. "same": the
// base-Control mapping set is identical (Level 1's Supplementary Control is replaced
// by this file's own). "narrower": Level 1 covers three NIST practices in one
// Requirement, so each Level 2 practice maps to a subset of Level 1's Controls.
// Either way the first mapping's rationale says which it is.
const L1_TO_L2_SUPPLEMENTARY: Record<string, string> = { "CMMC-SUP-01": "CMMC-L2-SUP-01" };
const OVERLAPS: [l2: string, l1: string, kind: "same" | "narrower"][] = [
  ["AC.L2-3.1.1", "AC.L1-b.1.i", "same"],
  ["AC.L2-3.1.2", "AC.L1-b.1.ii", "same"],
  ["AC.L2-3.1.20", "AC.L1-b.1.iii", "same"],
  ["AC.L2-3.1.22", "AC.L1-b.1.iv", "same"],
  ["IA.L2-3.5.1", "IA.L1-b.1.v", "same"],
  ["IA.L2-3.5.2", "IA.L1-b.1.vi", "same"],
  ["MP.L2-3.8.3", "MP.L1-b.1.vii", "same"],
  ["PE.L2-3.10.1", "PE.L1-b.1.viii", "same"],
  ["PE.L2-3.10.3", "PE.L1-b.1.ix", "narrower"],
  ["PE.L2-3.10.4", "PE.L1-b.1.ix", "narrower"],
  ["PE.L2-3.10.5", "PE.L1-b.1.ix", "narrower"],
  ["SC.L2-3.13.1", "SC.L1-b.1.x", "same"],
  ["SC.L2-3.13.5", "SC.L1-b.1.xi", "same"],
  ["SI.L2-3.14.1", "SI.L1-b.1.xii", "same"],
  ["SI.L2-3.14.2", "SI.L1-b.1.xiii", "same"],
  ["SI.L2-3.14.4", "SI.L1-b.1.xiv", "same"],
  ["SI.L2-3.14.5", "SI.L1-b.1.xv", "same"],
];

describe("CMMC Level 2 2.0 import file", () => {
  it("parses with the Framework import parser and resolves every reference", () => {
    const problems = checkImportReferences(data, {
      controlCodes: new Set([...annexCodes, ...clauseCodes]),
      facetNames: new Set(["SaaS", "Cloud IaaS/PaaS", "On-Premises Datacenter"]),
    });
    expect(problems).toEqual([]);
  });

  it("has the expected Framework metadata", () => {
    expect(data.framework.name).toBe("CMMC Level 2");
    expect(data.framework.version).toBe("2.0");
    expect(data.framework.licensing).toBe("QUOTABLE");
    expect(data.framework.strictComplianceRequired).toBe(true);
    expect(data.framework.isBase ?? false).toBe(false);
    expect(data.framework.supersedes ?? null).toBeNull();
  });

  it("holds the 110 practices with unique codes in source order", () => {
    expect(EXPECTED_CODES).toHaveLength(110);
    expect(data.requirements.map((requirement) => requirement.code)).toEqual(EXPECTED_CODES);
    expect(new Set(data.requirements.map((requirement) => requirement.code)).size).toBe(110);
    for (const requirement of data.requirements) {
      expect(requirement.code, requirement.code).toMatch(/^[A-Z]{2}\.L2-3\.\d{1,2}\.\d{1,2}$/);
    }
  });

  it("groups Requirements by the 14 family names", () => {
    const expected = FAMILIES.flatMap(([section, , numbers]) => numbers.map(() => section));
    expect(FAMILIES).toHaveLength(14);
    expect(data.requirements.map((requirement) => requirement.section)).toEqual(expected);
  });

  it("gives every Requirement a title, and a text that quotes and names NIST SP 800-171 Rev. 2", () => {
    for (const requirement of data.requirements) {
      expect(requirement.title.trim(), requirement.code).not.toBe("");
      expect(requirement.text.trim().length, requirement.code).toBeGreaterThan(20);
      const number = requirement.code.split("L2-")[1];
      expect(requirement.text, requirement.code).toContain(`(NIST SP 800-171 Rev. 2 ${number}.)`);
    }
  });

  it("maps only to Annex A Controls, ISMS clause Controls or its own Supplementary Controls", () => {
    for (const requirement of data.requirements) {
      for (const mapping of requirement.mappings) {
        const known = annexCodes.has(mapping.control) || clauseCodes.has(mapping.control) || ownCodes.has(mapping.control);
        expect(known, `${requirement.code} maps to unknown ${mapping.control}`).toBe(true);
      }
    }
  });

  it("does not depend on CMMC Level 1: no mapping to a Level 1 Supplementary Control", () => {
    const level1Own = new Set(level1.data.supplementaryControls.map((control) => control.code));
    expect(level1Own.size).toBeGreaterThan(0);
    for (const code of level1Own) expect(ownCodes.has(code), `${code} redefined`).toBe(false);
    for (const requirement of data.requirements) {
      for (const mapping of requirement.mappings) {
        expect(level1Own.has(mapping.control), `${requirement.code} -> ${mapping.control}`).toBe(false);
        expect(mapping.control.startsWith("CMMC-SUP-"), `${requirement.code} -> ${mapping.control}`).toBe(false);
      }
    }
  });

  it("gives every mapping a rationale, and never maps a Control twice in one Requirement", () => {
    for (const requirement of data.requirements) {
      const controls = requirement.mappings.map((mapping) => mapping.control);
      expect(new Set(controls).size, requirement.code).toBe(controls.length);
      for (const mapping of requirement.mappings) {
        expect(mapping.rationale?.trim() ?? "", `${requirement.code} -> ${mapping.control}`).not.toBe("");
      }
    }
  });

  it("maps every Requirement to at least one Control", () => {
    for (const requirement of data.requirements) {
      expect(requirement.mappings.length, requirement.code).toBeGreaterThan(0);
    }
  });

  it("keeps its Supplementary Controls new, prefixed, well formed and mapped at least once", () => {
    const mapped = new Set(data.requirements.flatMap((requirement) => requirement.mappings.map((m) => m.control)));
    expect(data.supplementaryControls.length).toBeGreaterThan(0);
    for (const control of data.supplementaryControls) {
      expect(control.code, control.code).toMatch(/^CMMC-L2-SUP-\d{2}$/);
      expect(annexCodes.has(control.code) || clauseCodes.has(control.code), control.code).toBe(false);
      expect(mapped.has(control.code), `${control.code} is not mapped`).toBe(true);
      expect(control.category, control.code).toBe("CMMC Level 2 obligations");
      expect(control.mandatory, control.code).toBe(true);
      expect(control.title.trim(), control.code).not.toBe("");
      expect(control.description.trim(), control.code).not.toBe("");
      expect(control.intent?.trim() ?? "", control.code).not.toBe("");
      expect(control.examples?.length ?? 0, control.code).toBeGreaterThan(0);
      if (control.applicability !== "ORGANIZATIONAL") {
        expect(control.question?.trim() ?? "", control.code).not.toBe("");
      }
    }
  });

  it("words its Supplementary Controls for CUI, not for Federal Contract Information", () => {
    for (const control of data.supplementaryControls) {
      const wording = [control.title, control.description, control.question ?? "", control.intent ?? "", ...(control.examples ?? [])].join(" ");
      expect(wording, control.code).toMatch(/CUI/);
      expect(wording, control.code).not.toMatch(/Federal Contract Information|FCI/);
    }
  });

  describe("practices that Level 1 also holds", () => {
    const level1ByCode = new Map(level1.data.requirements.map((requirement) => [requirement.code, requirement]));

    it("covers every Level 1 practice once (the NIST numbers named in the Level 1 text)", () => {
      const covered = OVERLAPS.map(([, l1]) => l1);
      expect([...new Set(covered)].sort()).toEqual([...level1ByCode.keys()].sort());
      for (const [l2, l1] of OVERLAPS) {
        const number = l2.split("L2-")[1];
        const level1Text = level1ByCode.get(l1)?.text ?? "";
        const numbers = level1Text.match(/\d\.\d+\.\d+/g) ?? [];
        expect(numbers, `${l2} not in the NIST numbers of ${l1}`).toContain(number);
      }
    });

    for (const [l2, l1, kind] of OVERLAPS) {
      it(`${l2} relates to ${l1} as stated (${kind})`, () => {
        const level2Requirement = byCode.get(l2);
        const level1Requirement = level1ByCode.get(l1);
        expect(level2Requirement, l2).toBeDefined();
        expect(level1Requirement, l1).toBeDefined();
        const toLevel2 = (control: string) => L1_TO_L2_SUPPLEMENTARY[control] ?? control;
        const level1Set = new Map(level1Requirement!.mappings.map((m) => [toLevel2(m.control), m.coverage]));
        const level2Set = new Map(level2Requirement!.mappings.map((m) => [m.control, m.coverage]));
        const first = level2Requirement!.mappings[0].rationale ?? "";
        if (kind === "same") {
          expect([...level2Set].sort()).toEqual([...level1Set].sort());
          expect(first, l2).toContain(`Same mapping as CMMC Level 1 ${l1}`);
        } else {
          expect(level2Set.size, l2).toBeLessThanOrEqual(level1Set.size);
          for (const [control, coverage] of level2Set) {
            expect(level1Set.get(control), `${l2} -> ${control}`).toBe(coverage);
          }
          expect(first, l2).toContain(`Narrower than CMMC Level 1 ${l1}`);
        }
      });
    }
  });
});
