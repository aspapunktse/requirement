import { describe, expect, it } from "vitest";
import { CSV_BOM, csvFilename, neutralizeFormula, toCsv } from "@/lib/csv";
import { parseCsv } from "@/test/csv-parse";

const body = (csv: string) => csv.slice(CSV_BOM.length);

describe("toCsv", () => {
  it("starts with the UTF-8 byte-order mark", () => {
    const bytes = Buffer.from(toCsv(["a"], []), "utf-8");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("quotes every value, ends every row with CRLF and writes empty values as empty quotes", () => {
    expect(body(toCsv(["Code", "Title"], [["A.5.1", "ISO/IEC 27001"], ["x", null]]))).toBe(
      '"Code","Title"\r\n"A.5.1","ISO/IEC 27001"\r\n"x",""\r\n',
    );
  });

  it("keeps plain text such as a Requirement code untouched", () => {
    expect(neutralizeFormula("A.5.1")).toBe("A.5.1");
    expect(neutralizeFormula("ISO/IEC 27001")).toBe("ISO/IEC 27001");
    expect(neutralizeFormula("Använd kryptering, åäö")).toBe("Använd kryptering, åäö");
    expect(neutralizeFormula("")).toBe("");
    expect(neutralizeFormula("a=b")).toBe("a=b");
  });

  it("doubles quotes and keeps commas and line breaks inside the cell", () => {
    expect(body(toCsv(["h"], [['say "hi", ok\r\nnext\nline']]))).toBe('"h"\r\n"say ""hi"", ok\r\nnext\nline"\r\n');
  });

  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "  =1+1", "\t=1", "\r=1", "\t", " -x", "\n@x"])(
    "prefixes %j with a single quote",
    (value) => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
    },
  );

  it("neutralises headers and numbers too", () => {
    expect(body(toCsv(["=h"], [[-3, 4]]))).toBe(`"'=h"\r\n"'-3","4"\r\n`);
  });

  it("round-trips awkward values (neutralised cells compare equal after the documented prefix)", () => {
    const awkward = [
      "plain",
      "A.5.1",
      "ISO/IEC 27001",
      "åäö ÅÄÖ",
      "with, comma",
      'with "quote"',
      "line one\r\nline two",
      "line one\nline two",
      "=HYPERLINK(\"http://x\",\"y\")",
      "-1",
      "+46 8 123",
      "@mention",
      "",
      '"',
      ",",
    ];
    const header = ["h1", "=h2"];
    const csv = toCsv(header, [awkward.slice(0, 2), awkward.slice(2, 4), ...awkward.slice(4).map((v) => [v, v])]);
    const parsed = parseCsv(body(csv));
    const strip = (v: string, original: string) => (neutralizeFormula(original) !== original ? v.slice(1) : v);
    const expected = [header, awkward.slice(0, 2), awkward.slice(2, 4), ...awkward.slice(4).map((v) => [v, v])];
    expect(parsed).toHaveLength(expected.length);
    parsed.forEach((row, r) =>
      row.forEach((value, c) => expect(strip(value, expected[r][c])).toBe(expected[r][c])),
    );
  });
});

describe("csvFilename", () => {
  const date = new Date("2026-10-13T23:59:00Z");

  it("keeps only [A-Za-z0-9._-] and appends the UTC date", () => {
    expect(csvFilename(["coverage", "ISO/IEC 27001", "2022"], date)).toBe("coverage-ISO-IEC-27001-2022-2026-10-13.csv");
    expect(csvFilename(["statement-of-applicability"], date)).toBe("statement-of-applicability-2026-10-13.csv");
  });

  it("replaces å, ä, ö, quotes, newlines and path characters", () => {
    const name = csvFilename(['Cybersäkerhetslagen "x"\r\n../..', "1"], date);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name).not.toContain("..");
    expect(name.endsWith("-2026-10-13.csv")).toBe(true);
  });

  it("falls back to a plain name", () => {
    expect(csvFilename(["åäö"], date)).toBe("export-2026-10-13.csv");
  });
});
