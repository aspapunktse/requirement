import { csvFilename, toCsv, type CsvValue } from "@/lib/csv";
import { frameworkLabel } from "@/lib/framework-label";
import { describeMetOn, STATEMENT_STATUS_LABEL, type BoundaryStatement, type BoundaryStatementRow, type BoundaryStatementSection } from "@/lib/boundary-statement-rules";

/**
 * The export of a Compliance Boundary's Statement of Applicability (#421, design proposal C): the whole statement or one Framework's
 * section, as CSV and as a print page. Pure: it turns what `loadBoundaryStatement` returns into text and facts, deriving nothing.
 * It carries no per-System status, so it is the same for every role: the counted Systems are named to every role on the page too,
 * and the Systems a user may not see are never named in a row (the page names them only in the drill-down).
 */

/** The sections of an export: all of them, or the one Framework asked for (null when the Boundary doesn't hold it). */
export function selectSections(statement: BoundaryStatement, frameworkId: string | null): BoundaryStatementSection[] | null {
  if (frameworkId === null) return statement.sections;
  const section = statement.sections.find((entry) => entry.framework.id === frameworkId);
  return section ? [section] : null;
}

/** "2026-11-23": the export date, in UTC. */
export function exportDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const names = (systems: { name: string }[]) => systems.map((system) => system.name).join("; ");

/** What the header says: the Boundary, its Owner, the Frameworks of the export, the counted Systems and the date. Shared by the CSV and the print page. */
export type ExportHeader = {
  boundaryName: string;
  ownerName: string | null;
  scope: "WHOLE" | "SECTION";
  frameworks: string[];
  countedSystems: string[];
  notYetOperating: string[];
  exportedOn: string;
};

export function exportHeader(statement: BoundaryStatement, sections: BoundaryStatementSection[], whole: boolean, date: Date): ExportHeader {
  return {
    boundaryName: statement.boundary.name,
    ownerName: statement.boundary.ownerName,
    scope: whole ? "WHOLE" : "SECTION",
    frameworks: sections.map((section) => frameworkLabel(section.framework)),
    countedSystems: statement.countedSystems.map((system) => system.name),
    notYetOperating: statement.notYetOperating.map((system) => system.name),
    exportedOn: exportDate(date),
  };
}

export const BOUNDARY_STATEMENT_CSV_HEADER = ["Framework", "Requirement code", "Requirement title", "In the statement", "Exclusion justification", "Worst status", "Met on"] as const;

/** One row per Requirement: included or excluded, the justification of an excluded one (empty when none is written), the worst status, "Met on x of y Systems". */
export function boundaryStatementCsvRow(section: BoundaryStatementSection, row: BoundaryStatementRow): CsvValue[] {
  return [
    frameworkLabel(section.framework),
    row.code,
    row.title,
    row.included ? "Included" : "Excluded",
    row.justification ?? "",
    row.worstStatus ? STATEMENT_STATUS_LABEL[row.worstStatus] : "",
    row.included ? describeMetOn(row) : "",
  ];
}

/**
 * The file: the Boundary's facts as leading "label, value" rows, a blank row, then the header and one row per Requirement of each
 * Framework in the export. Every cell goes through `toCsv`: quoted, and a cell that starts like a formula is neutralised.
 */
export function boundaryStatementCsv(statement: BoundaryStatement, sections: BoundaryStatementSection[], whole: boolean, date: Date): string {
  const header = exportHeader(statement, sections, whole, date);
  const facts: CsvValue[][] = [
    ["Boundary Owner", header.ownerName ?? ""],
    ["Export", whole ? "Whole statement" : `Section: ${header.frameworks.join("; ")}`],
    ["Frameworks", header.frameworks.join("; ")],
    ["Counted Systems", `${header.countedSystems.length}${header.countedSystems.length > 0 ? `: ${header.countedSystems.join("; ")}` : ""}`],
    ...(header.notYetOperating.length > 0 ? [["Not yet operating, not counted", names(statement.notYetOperating)] as CsvValue[]] : []),
    ["Exported", header.exportedOn],
    [""],
  ];
  const rows = sections.flatMap((section) => section.rows.map((row) => boundaryStatementCsvRow(section, row)));
  // toCsv takes one header row; the facts come first, then the column header as an ordinary row.
  return toCsv(["Compliance Boundary", header.boundaryName], [...facts, [...BOUNDARY_STATEMENT_CSV_HEADER], ...rows]);
}

/** "isms-scope-iso-iec-27001-2022-2026-11-23.csv": the Boundary, the Framework when one section, the date. */
export function boundaryStatementFilename(statement: BoundaryStatement, sections: BoundaryStatementSection[], whole: boolean, date: Date): string {
  return csvFilename(["statement", statement.boundary.name, ...(whole ? [] : sections.map((section) => frameworkLabel(section.framework)))], date);
}

/** The URL of the CSV export or print page, for the whole statement (no Framework) or one section. */
export function exportHref(boundaryId: string, kind: "csv" | "print", frameworkId?: string): string {
  const base = kind === "csv" ? `/api/compliance-boundaries/${boundaryId}/statement/export` : `/compliance-boundaries/${boundaryId}/statement/print`;
  return frameworkId ? `${base}?framework=${encodeURIComponent(frameworkId)}` : base;
}
