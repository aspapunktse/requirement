import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport } from "../framework-import-schema";

/**
 * Pure checks on the CSA CCM v4.1.1 Framework import file (#149): it parses
 * with the real import parser, holds all 207 control specifications in source
 * order, and maps only to Controls that exist (Annex A, ISMS clauses or its own
 * Supplementary Controls). Reads files only, never the database (CI's DB is
 * migrated but not seeded).
 */

const seedDir = path.join(process.cwd(), "prisma", "seed-data");
const raw = JSON.parse(readFileSync(path.join(seedDir, "frameworks", "csa-ccm-4.1.1.json"), "utf-8"));
const annexA: { code: string }[] = JSON.parse(readFileSync(path.join(seedDir, "iso27001-annex-a.json"), "utf-8"));
const clauses: { supplementaryControls: { code: string }[] } = JSON.parse(
  readFileSync(path.join(seedDir, "iso27001-clauses.json"), "utf-8"),
);

// [domain name, ID prefix, number of control specifications], in source order.
const DOMAINS: [string, string, number][] = [
  ["Audit & Assurance", "A&A", 6],
  ["Application & Interface Security", "AIS", 8],
  ["Business Continuity Management and Operational Resilience", "BCR", 11],
  ["Change Control and Configuration Management", "CCC", 9],
  ["Cryptography, Encryption & Key Management", "CEK", 21],
  ["Datacenter Security", "DCS", 18],
  ["Data Security and Privacy Lifecycle Management", "DSP", 19],
  ["Governance, Risk and Compliance", "GRC", 8],
  ["Human Resources", "HRS", 13],
  ["Identity & Access Management", "IAM", 15],
  ["Interoperability & Portability", "IPY", 4],
  ["Infrastructure Security", "I&S", 9],
  ["Logging and Monitoring", "LOG", 14],
  ["Security Incident Management, E-Discovery, & Cloud Forensics", "SEF", 10],
  ["Supply Chain Management, Transparency, and Accountability", "STA", 16],
  ["Threat & Vulnerability Management", "TVM", 12],
  ["Universal Endpoint Management", "UEM", 14],
];
const EXPECTED_CODES = DOMAINS.flatMap(([, prefix, count]) =>
  Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`),
);

// The workbook is licensed and is not in the repo, so this guards against pasted specification text by
// checking that no Requirement text contains stock phrasing that recurs throughout the CCM specifications.
const SPECIFICATION_PHRASES = [
  "establish, document, approve, communicate, apply, evaluate, and maintain",
  "establish, document, approve, communicate, implement, apply, evaluate, and maintain",
  "review and update the policies and procedures",
  "at least annually, or upon significant changes",
  "define, implement, and evaluate processes, procedures, and technical measures",
  "define and implement, processes, procedures, and technical measures",
  "which include provisions for legal and regulatory requirements",
  "or upon significant changes",
];

const parsed = parseFrameworkImport(raw);
if (!parsed.ok) throw new Error(`csa-ccm-4.1.1.json does not parse: ${parsed.problems.join("; ")}`);
const data = parsed.data;
const annexCodes = new Set(annexA.map((control) => control.code));
const clauseCodes = new Set(clauses.supplementaryControls.map((control) => control.code));
const ownCodes = new Set(data.supplementaryControls.map((control) => control.code));

describe("CSA CCM 4.1.1 import file", () => {
  it("parses with the Framework import parser and resolves every reference", () => {
    const problems = checkImportReferences(data, {
      controlCodes: new Set([...annexCodes, ...clauseCodes]),
      facetNames: new Set(["SaaS", "Cloud IaaS/PaaS", "On-Premises Datacenter"]),
    });
    expect(problems).toEqual([]);
  });

  it("has the expected Framework metadata", () => {
    expect(data.framework.name).toBe("CSA CCM");
    expect(data.framework.version).toBe("4.1.1");
    expect(data.framework.licensing).toBe("PARAPHRASE_ONLY");
    expect(data.framework.isBase ?? false).toBe(false);
    expect(data.framework.supersedes ?? null).toBeNull();
  });

  it("holds the 207 control specifications of the 17 domains in source order", () => {
    expect(EXPECTED_CODES).toHaveLength(207);
    expect(data.requirements.map((requirement) => requirement.code)).toEqual(EXPECTED_CODES);
    expect(new Set(data.requirements.map((requirement) => requirement.code)).size).toBe(207);
  });

  it("groups Requirements by domain name", () => {
    const expected = DOMAINS.flatMap(([section, , count]) => Array.from({ length: count }, () => section));
    expect(data.requirements.map((requirement) => requirement.section)).toEqual(expected);
  });

  it("gives every Requirement a title and an own-words text", () => {
    for (const requirement of data.requirements) {
      expect(requirement.section.trim(), requirement.code).not.toBe("");
      expect(requirement.title.trim(), requirement.code).not.toBe("");
      expect(requirement.text.trim().length, requirement.code).toBeGreaterThan(20);
    }
  });

  it("does not paste stock CCM specification phrasing into a Requirement text", () => {
    for (const requirement of data.requirements) {
      const text = requirement.text.toLowerCase();
      for (const phrase of SPECIFICATION_PHRASES) {
        expect(text.includes(phrase), `${requirement.code} contains "${phrase}"`).toBe(false);
      }
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

  it("gives every PARTIAL mapping a rationale", () => {
    for (const requirement of data.requirements) {
      for (const mapping of requirement.mappings) {
        if (mapping.coverage === "PARTIAL") {
          expect(mapping.rationale?.trim() ?? "", `${requirement.code} -> ${mapping.control}`).not.toBe("");
        }
      }
    }
  });

  it("scopes every Supplementary Control to a cloud Deployment Facet and maps it at least once", () => {
    expect(data.supplementaryControls.length).toBeGreaterThan(0);
    const mapped = new Set(data.requirements.flatMap((requirement) => requirement.mappings.map((m) => m.control)));
    for (const control of data.supplementaryControls) {
      expect(control.code.startsWith("CCM-SUP-"), control.code).toBe(true);
      expect(annexCodes.has(control.code) || clauseCodes.has(control.code), control.code).toBe(false);
      expect(control.applicability, control.code).toBe("PER_SYSTEM");
      const facets = control.deploymentFacets ?? [];
      expect(facets.length, control.code).toBeGreaterThan(0);
      for (const facet of facets) expect(["Cloud IaaS/PaaS", "SaaS"], control.code).toContain(facet);
      expect(mapped.has(control.code), `${control.code} is not mapped`).toBe(true);
    }
  });
});
