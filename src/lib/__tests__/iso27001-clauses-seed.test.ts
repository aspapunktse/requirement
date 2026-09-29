import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pure checks on the ISO/IEC 27001:2022 clauses 4-10 content (#75): the seed
 * JSON is well-formed and complete, and the SQL data migration carries exactly
 * the same content. Reads files only, never the database (CI's DB is migrated
 * but not seeded, so tests must not depend on seeded data).
 */

type Mapping = { control: string; coverage: "FULL" | "PARTIAL"; rationale?: string };
type ClauseRequirement = { code: string; section: string; title: string; text: string; mappings: Mapping[] };
type SeedControl = {
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  applicability: string;
  question: string | null;
  intent: string | null;
  examples: string[];
};

const prismaDir = path.join(process.cwd(), "prisma");
const clauses: {
  framework: { name: string; version: string; isBase: boolean; licensing: string };
  supplementaryControls: SeedControl[];
  requirements: ClauseRequirement[];
} = JSON.parse(readFileSync(path.join(prismaDir, "seed-data", "iso27001-clauses.json"), "utf-8"));
const annexA: { code: string }[] = JSON.parse(
  readFileSync(path.join(prismaDir, "seed-data", "iso27001-annex-a.json"), "utf-8"),
);
const migrationSql = readFileSync(
  path.join(prismaDir, "migrations", "20260929170000_add_iso27001_clause_requirements", "migration.sql"),
  "utf-8",
).replace(/\r\n/g, "\n");

const EXPECTED_CLAUSES = [
  "4.1", "4.2", "4.3", "4.4",
  "5.1", "5.2", "5.3",
  "6.1.1", "6.1.2", "6.1.3", "6.2", "6.3",
  "7.1", "7.2", "7.3", "7.4", "7.5",
  "8.1", "8.2", "8.3",
  "9.1", "9.2", "9.3",
  "10.1", "10.2",
];

/** Rows of string/NULL values of the single `INSERT INTO "<table>" (...) VALUES ...;` statement. */
function parseInsertValues(sql: string, table: string): (string | null)[][] {
  const start = sql.indexOf(`INSERT INTO "${table}"`);
  expect(start, `INSERT INTO "${table}" not found`).toBeGreaterThanOrEqual(0);
  const valuesAt = sql.indexOf("VALUES", start) + "VALUES".length;
  const rows: (string | null)[][] = [];
  let row: (string | null)[] | null = null;
  let i = valuesAt;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === ";" && row === null) break;
    if (ch === "(" && row === null) {
      row = [];
      i++;
    } else if (ch === ")" && row !== null) {
      rows.push(row);
      row = null;
      i++;
    } else if (ch === "'" && row !== null) {
      let value = "";
      i++;
      for (;;) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i++;
          break;
        } else {
          value += sql[i++];
        }
      }
      row.push(value);
    } else if (row !== null && sql.startsWith("NULL", i)) {
      row.push(null);
      i += 4;
    } else {
      i++;
    }
  }
  return rows;
}

describe("iso27001-clauses.json", () => {
  it("identifies the base Framework", () => {
    expect(clauses.framework).toMatchObject({ name: "ISO/IEC 27001", version: "2022", isBase: true });
    expect(clauses.framework.licensing).toBe("PARAPHRASE_ONLY");
  });

  it("has exactly the clause Requirements 4.1-10.2, with unique codes", () => {
    const codes = clauses.requirements.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual([...EXPECTED_CLAUSES].sort());
  });

  it("gives every Requirement a section, title and text", () => {
    for (const requirement of clauses.requirements) {
      expect(requirement.section.trim(), requirement.code).not.toBe("");
      expect(requirement.title.trim(), requirement.code).not.toBe("");
      expect(requirement.text.trim(), requirement.code).not.toBe("");
      // The clause group number leads the section heading, e.g. "6 Planning".
      expect(requirement.section.startsWith(`${requirement.code.split(".")[0]} `), requirement.code).toBe(true);
    }
  });

  it("covers every Requirement: at least one FULL mapping", () => {
    for (const requirement of clauses.requirements) {
      expect(
        requirement.mappings.some((m) => m.coverage === "FULL"),
        requirement.code,
      ).toBe(true);
    }
  });

  it("only maps to Controls that exist in this file or in the Annex A seed, once each", () => {
    const known = new Set([...clauses.supplementaryControls.map((c) => c.code), ...annexA.map((c) => c.code)]);
    for (const requirement of clauses.requirements) {
      const mapped = requirement.mappings.map((m) => m.control);
      expect(new Set(mapped).size, `${requirement.code} maps a Control twice`).toBe(mapped.length);
      for (const code of mapped) expect(known.has(code), `${requirement.code} -> ${code}`).toBe(true);
    }
  });

  it("gives every PARTIAL mapping a rationale", () => {
    for (const requirement of clauses.requirements) {
      for (const mapping of requirement.mappings.filter((m) => m.coverage === "PARTIAL")) {
        expect(mapping.rationale?.trim(), `${requirement.code} -> ${mapping.control}`).toBeTruthy();
      }
    }
  });

  it("defines ISMS- Supplementary Controls that are ORGANIZATIONAL, unique and don't collide with Annex A", () => {
    const codes = clauses.supplementaryControls.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    const annexCodes = new Set(annexA.map((c) => c.code));
    for (const control of clauses.supplementaryControls) {
      expect(control.code.startsWith("ISMS-"), control.code).toBe(true);
      expect(annexCodes.has(control.code), control.code).toBe(false);
      expect(control).toMatchObject({
        applicability: "ORGANIZATIONAL",
        mandatory: true,
        question: null,
        intent: null,
        examples: [],
      });
      expect(control.title.trim(), control.code).not.toBe("");
      expect(control.description.trim(), control.code).not.toBe("");
      expect(control.category.trim(), control.code).not.toBe("");
    }
  });

  it("has no Supplementary Control that no Requirement maps", () => {
    const mapped = new Set(clauses.requirements.flatMap((r) => r.mappings.map((m) => m.control)));
    for (const control of clauses.supplementaryControls) expect(mapped.has(control.code), control.code).toBe(true);
  });
});

describe("20260929170000_add_iso27001_clause_requirements migration", () => {
  it("selects the base Framework by isBase and never touches Assessments or existing rows", () => {
    expect(migrationSql).toContain(`WHERE "isBase"`);
    const statements = migrationSql
      .split("\n")
      .filter((line) => !line.startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/ControlAssessment/);
    expect(statements).not.toMatch(/\bUPDATE\b|\bDELETE\b/);
    expect(migrationSql.match(/ON CONFLICT \([^)]*\) DO NOTHING;/g)).toHaveLength(3);
  });

  it("carries exactly the JSON's Supplementary Controls", () => {
    const rows = parseInsertValues(migrationSql, "_iso_clause_controls");
    expect(rows).toEqual(clauses.supplementaryControls.map((c) => [c.code, c.title, c.description, c.category]));
  });

  it("carries exactly the JSON's Requirements", () => {
    const rows = parseInsertValues(migrationSql, "_iso_clause_requirements");
    expect(rows).toEqual(clauses.requirements.map((r) => [r.code, r.section, r.title, r.text]));
  });

  it("carries exactly the JSON's Control Mappings", () => {
    const rows = parseInsertValues(migrationSql, "_iso_clause_mappings");
    expect(rows).toEqual(
      clauses.requirements.flatMap((r) => r.mappings.map((m) => [r.code, m.control, m.coverage, m.rationale ?? null])),
    );
  });
});
