import { csvFilename, toCsv, type CsvValue } from "@/lib/csv";
import { frameworkLabel } from "@/lib/framework-label";
import type { DerivedRequirementStatus } from "@/lib/requirement-status-rules";
import { describeMetOn, STATEMENT_STATUS_LABEL, type BoundaryStatement, type BoundaryStatementRow, type BoundaryStatementSection } from "@/lib/boundary-statement-rules";

/**
 * The export of a Compliance Boundary's Statement of Applicability (#421, design proposal C): the whole statement or one Framework's
 * section, as CSV and as a print page. Pure: it turns what `loadBoundaryStatement` returns into text and facts, deriving nothing.
 * The CSV also carries one column per counted System the acting user may see (`statement.systems`, the page's own visibility rule),
 * holding that System's status for the Requirement. A System the user may not see has no column and is never named in a row; it is
 * named only in the facts, as the page names every counted System. The print page keeps to the worst status and "Met on x of y".
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

/** The status on one System, worded like the "Worst status" column; a Requirement that does not apply to the System says so. */
const SYSTEM_STATUS_LABEL: Record<DerivedRequirementStatus, string> = { ...STATEMENT_STATUS_LABEL, NOT_APPLICABLE: "Not applicable" };

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

/**
 * One row per Requirement: included or excluded, the justification of an excluded one (empty when none is written), the worst status,
 * "Met on x of y Systems", then the status on each System the reader may see, in the order of `statement.systems` (the column order).
 */
export function boundaryStatementCsvRow(statement: BoundaryStatement, section: BoundaryStatementSection, row: BoundaryStatementRow): CsvValue[] {
  const byIndex = new Map(row.systemStatuses);
  return [
    frameworkLabel(section.framework),
    row.code,
    row.title,
    row.included ? "Included" : "Excluded",
    row.justification ?? "",
    row.worstStatus ? STATEMENT_STATUS_LABEL[row.worstStatus] : "",
    row.included ? describeMetOn(row) : "",
    ...statement.systems.map((_, index) => {
      const status = byIndex.get(index);
      return status ? SYSTEM_STATUS_LABEL[status] : "";
    }),
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
    ...(statement.countedSystems.length > statement.systems.length ? [["Systems not shown (no access)", String(statement.countedSystems.length - statement.systems.length)] as CsvValue[]] : []),
    ["Exported", header.exportedOn],
    [""],
  ];
  const rows = sections.flatMap((section) => section.rows.map((row) => boundaryStatementCsvRow(statement, section, row)));
  // toCsv takes one header row; the facts come first, then the column header as an ordinary row.
  return toCsv(["Compliance Boundary", header.boundaryName], [...facts, [...BOUNDARY_STATEMENT_CSV_HEADER, ...statement.systems.map((system) => system.name)], ...rows]);
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
