import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport } from "../framework-import-schema";

/**
 * Pure checks on the CMMC Level 1 (2.0) Framework import file (#209): it parses
 * with the real import parser, holds the 15 FAR 52.204-21(b)(1) practices of the
 * CMMC Level 1 Assessment Guide v2 in source order, and maps only to Controls
 * that exist (Annex A, ISMS clauses or its own Supplementary Controls). Reads
 * files only, never the database (CI's DB is migrated but not seeded).
 */

const seedDir = path.join(process.cwd(), "prisma", "seed-data");
const raw = JSON.parse(readFileSync(path.join(seedDir, "frameworks", "cmmc-level-1-2.0.json"), "utf-8"));
const annexA: { code: string }[] = JSON.parse(readFileSync(path.join(seedDir, "iso27001-annex-a.json"), "utf-8"));
const clauses: { supplementaryControls: { code: string }[] } = JSON.parse(
  readFileSync(path.join(seedDir, "iso27001-clauses.json"), "utf-8"),
);

// [domain name, practice codes], in the order of the Assessment Guide.
const DOMAINS: [string, string[]][] = [
  ["Access Control", ["AC.L1-b.1.i", "AC.L1-b.1.ii", "AC.L1-b.1.iii", "AC.L1-b.1.iv"]],
  ["Identification and Authentication", ["IA.L1-b.1.v", "IA.L1-b.1.vi"]],
  ["Media Protection", ["MP.L1-b.1.vii"]],
  ["Physical Protection", ["PE.L1-b.1.viii", "PE.L1-b.1.ix"]],
  ["System and Communications Protection", ["SC.L1-b.1.x", "SC.L1-b.1.xi"]],
  ["System and Information Integrity", ["SI.L1-b.1.xii", "SI.L1-b.1.xiii", "SI.L1-b.1.xiv", "SI.L1-b.1.xv"]],
];
const EXPECTED_CODES = DOMAINS.flatMap(([, codes]) => codes);

const parsed = parseFrameworkImport(raw);
if (!parsed.ok) throw new Error(`cmmc-level-1-2.0.json does not parse: ${parsed.problems.join("; ")}`);
const data = parsed.data;
const annexCodes = new Set(annexA.map((control) => control.code));
const clauseCodes = new Set(clauses.supplementaryControls.map((control) => control.code));
const ownCodes = new Set(data.supplementaryControls.map((control) => control.code));

describe("CMMC Level 1 2.0 import file", () => {
  it("parses with the Framework import parser and resolves every reference", () => {
    const problems = checkImportReferences(data, {
      controlCodes: new Set([...annexCodes, ...clauseCodes]),
      facetNames: new Set(["SaaS", "Cloud IaaS/PaaS", "On-Premises Datacenter"]),
    });
    expect(problems).toEqual([]);
  });

  it("has the expected Framework metadata", () => {
    expect(data.framework.name).toBe("CMMC Level 1");
    expect(data.framework.version).toBe("2.0");
    expect(data.framework.licensing).toBe("QUOTABLE");
    expect(data.framework.strictComplianceRequired).toBe(true);
    expect(data.framework.isBase ?? false).toBe(false);
    expect(data.framework.supersedes ?? null).toBeNull();
  });

  it("holds the 15 practices with unique codes in source order", () => {
    expect(EXPECTED_CODES).toHaveLength(15);
    expect(data.requirements.map((requirement) => requirement.code)).toEqual(EXPECTED_CODES);
    expect(new Set(data.requirements.map((requirement) => requirement.code)).size).toBe(15);
  });

  it("groups Requirements by domain name", () => {
    const expected = DOMAINS.flatMap(([section, codes]) => codes.map(() => section));
    expect(data.requirements.map((requirement) => requirement.section)).toEqual(expected);
  });

  it("gives every Requirement a title and a text", () => {
    for (const requirement of data.requirements) {
      expect(requirement.title.trim(), requirement.code).not.toBe("");
      expect(requirement.text.trim().length, requirement.code).toBeGreaterThan(20);
    }
  });

  it("notes that PE.L1-b.1.ix spans three NIST SP 800-171 practices", () => {
    const requirement = data.requirements.find((r) => r.code === "PE.L1-b.1.ix");
    expect(requirement?.text).toMatch(/3\.10\.3.*3\.10\.4.*3\.10\.5/);
  });

  it("maps only to Annex A Controls, ISMS clause Controls or its own Supplementary Controls", () => {
    for (const requirement of data.requirements) {
      for (const mapping of requirement.mappings) {
        const known = annexCodes.has(mapping.control) || clauseCodes.has(mapping.control) || ownCodes.has(mapping.control);
        expect(known, `${requirement.code} maps to unknown ${mapping.control}`).toBe(true);
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

  it("keeps its Supplementary Controls new, prefixed and mapped at least once", () => {
    const mapped = new Set(data.requirements.flatMap((requirement) => requirement.mappings.map((m) => m.control)));
    expect(data.supplementaryControls.length).toBeGreaterThan(0);
    for (const control of data.supplementaryControls) {
      expect(control.code.startsWith("CMMC-SUP-"), control.code).toBe(true);
      expect(annexCodes.has(control.code) || clauseCodes.has(control.code), control.code).toBe(false);
      expect(mapped.has(control.code), `${control.code} is not mapped`).toBe(true);
    }
  });
});
