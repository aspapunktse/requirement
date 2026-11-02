import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, deriveDark, fromHsl, isHexColour, MIN_CONTRAST, normaliseHex, toHsl } from "@/lib/sensitivity-colours";
import { checkSensitivityLevelEdit, sensitivityLevelEditSchema } from "@/lib/sensitivity-level";
import { sensitivityTokenCss } from "@/lib/sensitivity-level-css";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";

describe("sensitivity colours (#291)", () => {
  it("recognises #RRGGBB only and upper-cases it", () => {
    expect(isHexColour("#1d4ed8")).toBe(true);
    for (const bad of ["1d4ed8", "#fff", "#1d4ed8ff", "#12345g", "red", "", "#1d4ed8;}", null, 5]) expect(isHexColour(bad)).toBe(false);
    expect(normaliseHex(" #1d4ed8 ")).toBe("#1D4ED8");
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });

  it("round-trips through HSL", () => {
    for (const hex of ["#475569", "#1D4ED8", "#FEF9C3", "#991B1B"]) {
      const [h, s, l] = toHsl(hex);
      expect(fromHsl(h, s, l)).toBe(hex);
    }
  });

  it("every default pair passes 4.5:1 in light and its derived dark pair passes 4.5:1", () => {
    for (const level of DEFAULT_SENSITIVITY_LEVELS) {
      expect(contrastRatio(level.textColor, level.backgroundColor), `light ${level.label}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      const dark = deriveDark(level.textColor, level.backgroundColor);
      expect(dark.ratio, `dark ${level.label}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(dark.textColor, dark.backgroundColor)).toBeCloseTo(dark.ratio, 8);
      expect(isHexColour(dark.textColor) && isHexColour(dark.backgroundColor)).toBe(true);
    }
  });
});

describe("the defaults copy", () => {
  it("equals the rows the migration inserts", () => {
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261102120000_add_sensitivity_level/migration.sql"), "utf8");
    const rows = [...sql.matchAll(/\((\d), '([^']*)', '([^']*)', '(#[0-9A-F]{6})', '(#[0-9A-F]{6})'\)/g)].map((m) => ({
      level: Number(m[1]),
      label: m[2],
      description: m[3],
      textColor: m[4],
      backgroundColor: m[5],
    }));
    expect(rows).toHaveLength(5);
    expect(DEFAULT_SENSITIVITY_LEVELS).toEqual(rows);
  });
});

describe("sensitivityLevelEditSchema and checkSensitivityLevelEdit", () => {
  const valid = { level: 3, label: "  Confidential ", description: " Leaks hurt. ", textColor: "#854d0e", backgroundColor: " #fef9c3" };
  const others = DEFAULT_SENSITIVITY_LEVELS;

  it("trims, upper-cases the colours and accepts a good edit", () => {
    const parsed = sensitivityLevelEditSchema.parse(valid);
    expect(parsed).toEqual({ level: 3, label: "Confidential", description: "Leaks hurt.", textColor: "#854D0E", backgroundColor: "#FEF9C3" });
    expect(checkSensitivityLevelEdit(parsed, others)).toEqual([]);
  });

  it("refuses an empty or long label, an empty description, a bad colour and a bad level", () => {
    for (const patch of [
      { label: "   " },
      { label: "x".repeat(41) },
      { description: "" },
      { description: "x".repeat(301) },
      { textColor: "red" },
      { backgroundColor: "#12345" },
      { textColor: "#475569;}body{display:none" },
      { level: 6 },
      { level: 0 },
    ]) {
      expect(sensitivityLevelEditSchema.safeParse({ ...valid, ...patch }).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("refuses a duplicate label, ignoring case and the level's own row", () => {
    const clash = sensitivityLevelEditSchema.parse({ ...valid, label: "internal" });
    expect(checkSensitivityLevelEdit(clash, others).join(" ")).toMatch(/internal.*level 2 already has this label/);
    const own = sensitivityLevelEditSchema.parse({ ...valid, label: "SENSITIVE" });
    expect(checkSensitivityLevelEdit(own, others)).toEqual([]);
  });

  it("refuses low contrast, naming the level", () => {
    const low = sensitivityLevelEditSchema.parse({ ...valid, textColor: "#AAAAAA", backgroundColor: "#FFFFFF" });
    const problems = checkSensitivityLevelEdit(low, others);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Confidential: contrast is 2\.32:1/);
  });
});

describe("sensitivityTokenCss", () => {
  const css = sensitivityTokenCss(DEFAULT_SENSITIVITY_LEVELS);

  it("emits light tokens on :root and derived dark tokens under the mode rules, for all five levels", () => {
    const [light, media, dark] = css.split("\n");
    expect(light.startsWith(":root{")).toBe(true);
    expect(media.startsWith('@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){')).toBe(true);
    expect(dark.startsWith(':root[data-theme="dark"]{')).toBe(true);
    for (const n of [1, 2, 3, 4, 5]) {
      for (const part of ["fg", "bg"]) for (const block of [light, media, dark]) expect(block).toContain(`--rg-sensitivity-${n}-${part}:#`);
    }
    expect(light).toContain("--rg-sensitivity-2-fg:#1D4ED8;--rg-sensitivity-2-bg:#EFF6FF;");
    const d = deriveDark("#1D4ED8", "#EFF6FF");
    expect(dark).toContain(`--rg-sensitivity-2-fg:${d.textColor};--rg-sensitivity-2-bg:${d.backgroundColor};`);
  });

  it("writes nothing but #RRGGBB values: an unusable stored colour falls back to the default", () => {
    const hostile = sensitivityTokenCss([{ level: 1, textColor: "red;}</style><script>", backgroundColor: "#FFFFFF" }]);
    expect(hostile).not.toMatch(/[<>]|script|red/);
    expect(hostile).toContain("--rg-sensitivity-1-fg:#475569;--rg-sensitivity-1-bg:#F1F5F9;");
    expect(sensitivityTokenCss([])).toBe(css);
  });
});
