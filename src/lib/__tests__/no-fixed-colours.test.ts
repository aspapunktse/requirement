import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The guard behind themes (#286): UI colour comes from the `--rg-*` tokens (the `rg-*` Tailwind classes), because a
 * theme sets those and nothing else. A fixed colour in a component does not follow the theme, so this test fails on
 *   - a Tailwind palette colour class: `text-zinc-500`, `border-red-600`, `bg-white`, `text-black/40` ...
 *   - a raw hex colour: `"#6c7fd8"`.
 * in any non-test `.ts`/`.tsx` file under `src/`. Fix a failure with a token class (add a token to
 * `src/app/design-tokens.css` and `globals.css` if none fits). Shadows and scrims in the stylesheets are not
 * scanned; they are neutral and not part of a theme.
 */

/** Files that may hold colours, and why. Paths are relative to the repository root, with `/` separators. */
const ALLOWED_FILES: Record<string, string> = {
  "src/lib/palette.ts": "The theme list: each swatch shows another theme's colours, so they are data, not UI colour in use.",
};

const PALETTE_NAMES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITIES = "bg|text|border|border-[trblxyse]|ring|ring-offset|outline|divide|fill|stroke|from|via|to|accent|caret|decoration|shadow|placeholder";

// `bg-zinc-500`, `hover:text-red-600/50`, `dark:border-slate-800`; and `bg-white`, `text-black`, `border-white/10`.
const PALETTE_CLASS = new RegExp(`(?<![\\w-])(?:${UTILITIES})-(?:(?:${PALETTE_NAMES})-\\d{2,3}|white|black)(?![\\w-])`, "g");
// `#fff`, `#6c7fd8`, `#6c7fd8cc`. A short form needs a letter a-f, so an issue reference such as `#232` is not one.
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|(?=[0-9]*[a-fA-F])[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FUNCTION = /(?<![\w-])(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(/g;

/** The source without comments (line and block), keeping line numbers. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:\\"'`])\/\/.*$/gm, (_, before: string) => before);
}

export type Finding = { line: number; text: string };

/** Fixed colours in a source file's code. */
export function findFixedColours(source: string): Finding[] {
  const code = stripComments(source);
  const findings: Finding[] = [];
  code.split("\n").forEach((line, index) => {
    for (const pattern of [PALETTE_CLASS, HEX_COLOUR, COLOUR_FUNCTION]) {
      for (const match of line.matchAll(pattern)) findings.push({ line: index + 1, text: match[0] });
    }
  });
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "test" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("fixed colours", () => {
  it("finds no Tailwind palette colour class or hex colour in the app's source", () => {
    const root = process.cwd();
    const problems: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const path = relative(root, file).split(sep).join("/");
      if (path in ALLOWED_FILES) continue;
      for (const finding of findFixedColours(readFileSync(file, "utf8"))) problems.push(`${path}:${finding.line}  ${finding.text}`);
    }
    expect(problems, "Use the rg-* token classes (see src/app/design-tokens.css), not fixed colours").toEqual([]);
  });

  it("keeps the allow-list to files that exist", () => {
    for (const path of Object.keys(ALLOWED_FILES)) expect(() => statSync(join(process.cwd(), path))).not.toThrow();
  });
});

describe("the colour scanner", () => {
  const texts = (source: string) => findFixedColours(source).map((finding) => finding.text);

  it("finds palette classes with variants and opacity", () => {
    expect(texts('<p className="text-zinc-500 hover:border-red-600 dark:bg-slate-800/50">')).toEqual(["text-zinc-500", "border-red-600", "bg-slate-800"]);
    expect(texts('className="bg-white text-black border-white/10 ring-offset-black"')).toEqual(["bg-white", "text-black", "border-white", "ring-offset-black"]);
    expect(texts('className="from-blue-500 to-indigo-600"')).toEqual(["from-blue-500", "to-indigo-600"]);
  });

  it("finds hex colours and colour functions", () => {
    expect(texts('const a = "#6c7fd8", b = "#fff", c = "#6c7fd8cc";')).toEqual(["#6c7fd8", "#fff", "#6c7fd8cc"]);
    expect(texts('style={{ color: "rgb(1, 2, 3)", background: `hsla(0 0% 0% / 0.5)` }}')).toEqual(["rgb(", "hsla("]);
  });

  it("leaves the token classes, transparent and the theme variables alone", () => {
    expect(texts('className="bg-rg-surface text-rg-muted border-rg-line bg-transparent bg-ems-blue-tint text-rg-danger/60"')).toEqual([]);
    expect(texts('style={{ background: "var(--rg-info)" }}')).toEqual([]);
    expect(texts('className="whitespace-pre-wrap text-black-ish-not-a-class border-whiteboard"')).toEqual([]);
  });

  it("does not take issue references, URL fragments or words for colours", () => {
    expect(texts('const s = "Duplicate (#232)"; const u = "/page#top"; const v = "#1234";')).toEqual([]);
    expect(texts('const x = "#facade";')).toEqual(["#facade"]);
  });

  it("ignores comments", () => {
    expect(texts("// text-zinc-500 and #fff\nconst a = 1; /* bg-white\n#abcdef */ const b = 2;")).toEqual([]);
    expect(texts('const url = "https://example.com/#fff";')).toEqual(["#fff"]);
  });

  it("reports the line", () => {
    expect(findFixedColours('a\n\nconst x = "text-red-600";')).toEqual([{ line: 3, text: "text-red-600" }]);
  });
});
