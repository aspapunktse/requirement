import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport } from "../framework-import-schema";

/**
 * Pure checks on the Cyber Essentials 3.3 Framework import file (#212): it parses
 * with the real import parser, holds the scope rules and the five technical
 * control themes in source order, maps only to Controls that exist (Annex A, ISMS
 * clauses or its own Supplementary Controls) and carries the scheme's thresholds.
 * Reads files only, never the database (CI's DB is migrated but not seeded).
 */

const seedDir = path.join(process.cwd(), "prisma", "seed-data");
const raw = JSON.parse(readFileSync(path.join(seedDir, "frameworks", "cyber-essentials-3.3.json"), "utf-8"));
const annexA: { code: string }[] = JSON.parse(readFileSync(path.join(seedDir, "iso27001-annex-a.json"), "utf-8"));
const clauses: { supplementaryControls: { code: string }[] } = JSON.parse(
  readFileSync(path.join(seedDir, "iso27001-clauses.json"), "utf-8"),
);

// [section name, code prefix, number of Requirements], in source order.
const SECTIONS: [string, string, number][] = [
  ["Scope", "CE-SC", 14],
  ["Firewalls", "CE-FW", 7],
  ["Secure Configuration", "CE-CFG", 9],
  ["Security Update Management", "CE-SUM", 4],
  ["User Access Control", "CE-UAC", 12],
  ["Malware Protection", "CE-MP", 1],
];
const EXPECTED_CODES = SECTIONS.flatMap(([, prefix, count]) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`),
);

const parsed = parseFrameworkImport(raw);
if (!parsed.ok) throw new Error(`cyber-essentials-3.3.json does not parse: ${parsed.problems.join("; ")}`);
const data = parsed.data;
const annexCodes = new Set(annexA.map((control) => control.code));
const clauseCodes = new Set(clauses.supplementaryControls.map((control) => control.code));
const ownCodes = new Set(data.supplementaryControls.map((control) => control.code));
const byCode = (code: string) => data.requirements.find((requirement) => requirement.code === code);

describe("Cyber Essentials 3.3 import file", () => {
  it("parses with the Framework import parser and resolves every reference", () => {
    const problems = checkImportReferences(data, {
      controlCodes: new Set([...annexCodes, ...clauseCodes]),
      facetNames: new Set(["SaaS", "Cloud IaaS/PaaS", "On-Premises Datacenter"]),
    });
    expect(problems).toEqual([]);
  });

  it("has the expected Framework metadata", () => {
    expect(data.framework.name).toBe("Cyber Essentials");
    expect(data.framework.version).toBe("3.3");
    expect(data.framework.licensing).toBe("QUOTABLE");
    expect(data.framework.strictComplianceRequired).toBe(true);
    expect(data.framework.isBase ?? false).toBe(false);
    expect(data.framework.supersedes ?? null).toBeNull();
  });

  it("holds the Requirements with unique codes in source order", () => {
    expect(data.requirements.map((requirement) => requirement.code)).toEqual(EXPECTED_CODES);
    expect(new Set(EXPECTED_CODES).size).toBe(EXPECTED_CODES.length);
  });

  it("groups Requirements by scope and technical control theme", () => {
    const expected = SECTIONS.flatMap(([section, , count]) => Array.from({ length: count }, () => section));
    expect(data.requirements.map((requirement) => requirement.section)).toEqual(expected);
  });

  it("gives every Requirement a title and a text", () => {
    for (const requirement of data.requirements) {
      expect(requirement.title.trim(), requirement.code).not.toBe("");
      expect(requirement.text.trim().length, requirement.code).toBeGreaterThan(20);
    }
  });

  it("pins the 14-day update deadline and the CVSS 7 trigger", () => {
    const text = byCode("CE-SUM-04")?.text ?? "";
    expect(text).toMatch(/within 14 days/);
    expect(text).toMatch(/CVSS v3 base score of 7 or above/);
    const control = data.supplementaryControls.find((c) => c.code === "CE-SUP-01");
    expect(control?.question).toMatch(/14 days/);
    expect(byCode("CE-SUM-04")?.mappings.find((m) => m.control === "CE-SUP-01")?.coverage).toBe("FULL");
  });

  it("pins the password, MFA and device unlocking thresholds", () => {
    expect(byCode("CE-UAC-10")?.text).toMatch(/at least 12 characters/);
    expect(byCode("CE-UAC-10")?.text).toMatch(/at least 8 characters.*deny list/);
    expect(byCode("CE-UAC-08")?.text).toMatch(/at least 8 characters/);
    expect(byCode("CE-UAC-09")?.text).toMatch(/no more than 10 guesses in 5 minutes/);
    expect(byCode("CE-UAC-09")?.text).toMatch(/no more than 10 unsuccessful attempts/);
    expect(byCode("CE-CFG-09")?.text).toMatch(/at least 6 characters/);
    expect(byCode("CE-UAC-05")?.text).toMatch(/cloud services must always use MFA/);
    expect(byCode("CE-FW-04")?.text).toMatch(/prevented from the internet/);
    const sup = (code: string) => data.supplementaryControls.find((c) => c.code === code);
    expect(sup("CE-SUP-02")?.question).toMatch(/at least 6 characters/);
    expect(sup("CE-SUP-03")?.question).toMatch(/at least 8 characters/);
    expect(sup("CE-SUP-04")?.question).toMatch(/12 characters/);
  });

  it("keeps device unlocking, MFA password and password-based rules in separate Supplementary Controls", () => {
    const fullTo = (control: string) =>
      data.requirements.filter((r) => r.mappings.some((m) => m.control === control && m.coverage === "FULL")).map((r) => r.code);
    expect(fullTo("CE-SUP-02")).toEqual(["CE-CFG-08", "CE-CFG-09"]);
    expect(fullTo("CE-SUP-03")).toEqual(["CE-UAC-08"]);
    expect(fullTo("CE-SUP-04")).toEqual(["CE-UAC-09", "CE-UAC-10"]);
    // Device unlocking has no MFA alternative.
    const unlock = data.supplementaryControls.find((c) => c.code === "CE-SUP-02");
    expect(unlock?.description).toMatch(/not an alternative/);
    expect(unlock?.question).not.toMatch(/multi-factor|MFA/);
    // A rule that may not apply to a System tells it to answer Yes, because Not Applicable is not Fulfilled on a strict Framework.
    for (const code of ["CE-SUP-02", "CE-SUP-03", "CE-SUP-04"]) {
      expect(data.supplementaryControls.find((c) => c.code === code)?.question, code).toMatch(/answer Yes/);
    }
  });

  it("holds the either/or malware options in one Requirement mapped Full to one Supplementary Control", () => {
    const requirement = byCode("CE-MP-01");
    expect(requirement?.text).toMatch(/at least one of two options/);
    expect(requirement?.text).toMatch(/If anti-malware software is used/);
    expect(requirement?.text).toMatch(/If application allow listing is used/);
    const mappings = Object.fromEntries((requirement?.mappings ?? []).map((m) => [m.control, m.coverage]));
    expect(mappings).toEqual({ "CE-SUP-05": "FULL", "A.8.7": "PARTIAL", "A.8.19": "PARTIAL" });
    const question = data.supplementaryControls.find((c) => c.code === "CE-SUP-05")?.question ?? "";
    expect(question).toMatch(/whichever option/);
  });

  it("never maps an A.8.19 Full to a Requirement", () => {
    for (const requirement of data.requirements) {
      const mapping = requirement.mappings.find((m) => m.control === "A.8.19");
      if (mapping) expect(mapping.coverage, requirement.code).toBe("PARTIAL");
    }
  });

  it("encodes Table 2 of the source in CE-SC-12", () => {
    const text = byCode("CE-SC-12")?.text ?? "";
    expect(text).toContain("Student in / N/A / out");
    expect(text).toContain("Employee in / N/A / in");
    expect(text).toContain("Customer in / out / out");
    expect(text.split("N/A")).toHaveLength(6);
  });

  it("keeps the source's 'should' for measures it does not make mandatory", () => {
    for (const code of ["CE-CFG-08", "CE-UAC-09", "CE-UAC-10", "CE-UAC-11", "CE-UAC-12"]) {
      const text = byCode(code)?.text ?? "";
      expect(text, code).toMatch(/should/);
      expect(text, code).toMatch(/[Cc]uratorial note|included as a requirement/);
    }
  });

  it("states that cloud services cannot be excluded from scope", () => {
    expect(byCode("CE-SC-06")?.text).toMatch(/cannot be excluded from scope/);
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
    expect(data.supplementaryControls.map((control) => control.code)).toEqual(["CE-SUP-01", "CE-SUP-02", "CE-SUP-03", "CE-SUP-04", "CE-SUP-05"]);
    for (const control of data.supplementaryControls) {
      expect(control.code.startsWith("CE-SUP-"), control.code).toBe(true);
      expect(annexCodes.has(control.code) || clauseCodes.has(control.code), control.code).toBe(false);
      expect(mapped.has(control.code), `${control.code} is not mapped`).toBe(true);
    }
  });
});
