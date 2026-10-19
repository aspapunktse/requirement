import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImportReferences, parseFrameworkImport, type FrameworkImport } from "../framework-import-schema";

/**
 * Pure checks on the four DEF STAN 05-138 Issue 4 Framework import files, one per
 * Cyber Risk Profile, Level 0 to 3 (#211). Each file parses with the real import
 * parser, holds exactly the controls Table 1 of the standard marks for its level,
 * and maps only to Controls that exist (Annex A, ISMS clauses, or Supplementary
 * Controls of its own file or of a lower level, which a folder-wide load creates
 * first). Reads files only, never the database (CI's DB is migrated but not seeded).
 */

const seedDir = path.join(process.cwd(), "prisma", "seed-data");
const annexA: { code: string }[] = JSON.parse(readFileSync(path.join(seedDir, "iso27001-annex-a.json"), "utf-8"));
const clauses: { supplementaryControls: { code: string }[] } = JSON.parse(
  readFileSync(path.join(seedDir, "iso27001-clauses.json"), "utf-8"),
);
const baseCodes = new Set([...annexA.map((c) => c.code), ...clauses.supplementaryControls.map((c) => c.code)]);

// Control counts per level, from clause 2.2 of the standard.
const LEVEL_TOTALS = [3, 101, 139, 144];
// Table 1 is not strictly cumulative: a stronger control replaces a lower-level one.
const REPLACED_AT_LEVEL: Record<string, number> = {
  "2300": 2, // Data security, replaced by 2301 to 2313 at Level 2 and 3
  "2502": 2, // Resilience preparation, replaced by 2503
  "2504": 2, // Backups, replaced by 2505
  "3101": 3, // Monitor security controls (Level 1 and 2), replaced by 3102
};

function load(level: number): FrameworkImport {
  const file = path.join(seedDir, "frameworks", `def-stan-05-138-issue-4-level-${level}.json`);
  const parsed = parseFrameworkImport(JSON.parse(readFileSync(file, "utf-8")));
  if (!parsed.ok) throw new Error(`level ${level} does not parse: ${parsed.problems.join("; ")}`);
  return parsed.data;
}

const files = [0, 1, 2, 3].map(load);

describe("DEF STAN 05-138 Issue 4 import files", () => {
  it("have the expected Framework metadata", () => {
    files.forEach((data, level) => {
      expect(data.framework.name).toBe(`DEF STAN 05-138 Level ${level}`);
      expect(data.framework.version).toBe("Issue 4");
      expect(data.framework.licensing).toBe("QUOTABLE");
      expect(data.framework.strictComplianceRequired).toBe(false);
      expect(data.framework.isBase ?? false).toBe(false);
      expect(data.framework.supersedes ?? null).toBeNull();
    });
  });

  it("hold the number of controls clause 2.2 gives for each level, with unique codes", () => {
    files.forEach((data, level) => {
      const codes = data.requirements.map((r) => r.code);
      expect(codes, `level ${level}`).toHaveLength(LEVEL_TOTALS[level]);
      expect(new Set(codes).size, `level ${level}`).toBe(codes.length);
      for (const code of codes) expect(code, code).toMatch(/^\d{4}$/);
    });
  });

  it("list Control IDs in ascending order, each under a section", () => {
    for (const data of files) {
      const codes = data.requirements.map((r) => r.code);
      expect(codes).toEqual([...codes].sort());
      for (const r of data.requirements) {
        expect(r.section.trim(), r.code).not.toBe("");
        expect(r.title.trim(), r.code).not.toBe("");
        expect(r.text.trim().length, r.code).toBeGreaterThan(20);
      }
    }
  });

  it("carry every lower-level control up, except those a stronger control replaces", () => {
    for (let level = 1; level < 4; level++) {
      const here = new Set(files[level].requirements.map((r) => r.code));
      for (const r of files[level - 1].requirements) {
        if (here.has(r.code)) continue;
        expect(REPLACED_AT_LEVEL[r.code], `${r.code} missing at level ${level}`).toBeLessThanOrEqual(level);
      }
    }
    // Everything on the replaced list is dropped at the stated level and stays out.
    for (const [code, level] of Object.entries(REPLACED_AT_LEVEL)) {
      files.forEach((data, l) => {
        const present = data.requirements.some((r) => r.code === code);
        if (l >= level) expect(present, `${code} at level ${l}`).toBe(false);
      });
    }
  });

  it("give a control at several levels the same section, title, text and mappings", () => {
    const seen = new Map<string, unknown>();
    for (const data of files) {
      for (const r of data.requirements) {
        const first = seen.get(r.code);
        if (first === undefined) seen.set(r.code, r);
        else expect(r, r.code).toEqual(first);
      }
    }
  });

  it("put Controls 0001 and 0002 under a certification section", () => {
    for (const code of ["0001", "0002"]) {
      const r = files[3].requirements.find((x) => x.code === code);
      expect(r?.section, code).toBe("Certification");
    }
  });

  it("group the other controls under the four Objectives of the standard", () => {
    const objectives = new Set([
      "Objective A: Managing security risk",
      "Objective B: Protecting against cyber attack",
      "Objective C: Detecting cyber security events",
      "Objective D: Minimising the impact of cyber security incidents",
    ]);
    for (const r of files[3].requirements) {
      if (r.code === "0001" || r.code === "0002") continue;
      expect(objectives.has(r.section), `${r.code}: ${r.section}`).toBe(true);
      // Control IDs 1xxx are Objective A, 2xxx B, 3xxx C, 4xxx D.
      expect(r.section.charAt("Objective ".length), r.code).toBe("ABCD"[Number(r.code[0]) - 1]);
    }
  });

  it("resolve every mapping against Annex A, ISMS clauses or a Supplementary Control at the same or a lower level", () => {
    files.forEach((data, level) => {
      const visible = new Set(baseCodes);
      for (let l = 0; l <= level; l++) for (const s of files[l].supplementaryControls) visible.add(s.code);
      const problems = checkImportReferences(data, { controlCodes: visible, facetNames: new Set() });
      expect(problems, `level ${level}`).toEqual([]);
    });
  });

  it("give every Requirement a mapping with a rationale, and never map a Control twice in one Requirement", () => {
    for (const data of files) {
      for (const r of data.requirements) {
        expect(r.mappings.length, r.code).toBeGreaterThan(0);
        const controls = r.mappings.map((m) => m.control);
        expect(new Set(controls).size, r.code).toBe(controls.length);
        for (const m of r.mappings) {
          expect(m.rationale?.trim() ?? "", `${r.code} -> ${m.control}`).not.toBe("");
        }
      }
    }
  });

  it("define each Supplementary Control once, in the lowest level that maps to it, with the DEFSTAN-SUP- prefix", () => {
    const definedAt = new Map<string, number>();
    files.forEach((data, level) => {
      for (const s of data.supplementaryControls) {
        expect(s.code.startsWith("DEFSTAN-SUP-"), s.code).toBe(true);
        expect(baseCodes.has(s.code), s.code).toBe(false);
        expect(definedAt.has(s.code), `${s.code} defined twice`).toBe(false);
        definedAt.set(s.code, level);
      }
    });
    expect(definedAt.size).toBeGreaterThan(0);

    const lowestUse = new Map<string, number>();
    files.forEach((data, level) => {
      for (const r of data.requirements) {
        for (const m of r.mappings) {
          if (m.control.startsWith("DEFSTAN-SUP-") && !lowestUse.has(m.control)) lowestUse.set(m.control, level);
        }
      }
    });
    expect(new Map([...lowestUse].sort())).toEqual(new Map([...definedAt].sort()));
  });
});
