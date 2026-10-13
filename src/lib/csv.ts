// A small CSV encoder for the exports (PRD 0001 F-OUT.5, #151). Pure, no Prisma,
// no dependency.
//
// Format (RFC 4180 with two additions):
// - Every value is quoted, and a double quote inside a value is doubled. A comma,
//   a quote or a line break inside a value therefore stays inside its cell.
// - Rows end with CRLF, including the last one. Line breaks inside a value are
//   kept as they are, inside the quotes.
// - The text starts with a UTF-8 byte-order mark (U+FEFF), so Excel reads the file
//   as UTF-8 and shows å, ä and ö correctly. It is written as an escape, never as
//   an invisible literal character.
//
// Formula neutralisation (OWASP "CSV injection"): a spreadsheet runs a cell that
// starts like a formula. A value is prefixed with a single quote (') when, after any
// leading whitespace, its first character is `=`, `+`, `-` or `@`, or when its first
// character is a tab or a carriage return. The prefix is the only change, so the
// spreadsheet shows the value as text; the cost is that a Requirement code such as
// "-1" or "=x" reads "'-1" or "'=x". It applies to every cell, headers included,
// and to numbers (a negative one is prefixed too). Anything else passes through.

export type CsvValue = string | number | null | undefined;

/** The byte-order mark, as the escape. */
export const CSV_BOM = "\uFEFF";

/** The prefix `neutralizeFormula` puts in front of a value a spreadsheet would run. */
export const CSV_FORMULA_PREFIX = "'";

/** Leading whitespace may precede the trigger character; tab and carriage return trigger on their own. */
const FORMULA_START = /^(?:\s*[=+\-@]|[\t\r])/;

/** The value with `'` in front when a spreadsheet would read it as a formula; otherwise unchanged. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `${CSV_FORMULA_PREFIX}${value}` : value;
}

function cell(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${neutralizeFormula(text).replace(/"/g, '""')}"`;
}

/** The whole file as text: BOM, then the header and every row, each ending in CRLF. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return CSV_BOM + [header, ...rows].map((row) => row.map(cell).join(",") + "\r\n").join("");
}

/**
 * A safe ASCII download name: the parts joined with "-", every run of characters
 * outside `[A-Za-z0-9._-]` (spaces, a-ring, a-umlaut, quotes, slashes) becomes one "-",
 * then the date (YYYY-MM-DD, UTC) and ".csv". No `filename*` is sent, so nothing else
 * can reach the header.
 */
export function csvFilename(parts: readonly string[], date: Date): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  const base = parts.map(safe).filter(Boolean).join("-") || "export";
  return `${base}-${date.toISOString().slice(0, 10)}.csv`;
}

/** The download response: UTF-8 CSV as an attachment, never cached (it is per-viewer and live). */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
