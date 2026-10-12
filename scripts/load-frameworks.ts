/**
 * Loads Framework import files (PRD 0001 F-IMP, #144). The format is in
 * prisma/seed-data/frameworks/README.md.
 *
 *   npm run frameworks:load -- <file> [<file> ...]   load the given file(s)
 *   npm run frameworks:load                           load every *.json in prisma/seed-data/frameworks/
 *   npm run frameworks:load -- --allow-published ...  also update Frameworks that are already Published
 *
 * A new Framework is created as Draft and an existing Draft is updated in
 * place; publishing is done in the UI after review. A Published Framework is
 * refused unless --allow-published is given. Each file is validated before
 * anything is written, and a refused or invalid file changes nothing. Every
 * file is processed even if an earlier one failed; the exit code is 1 if any
 * file was refused or invalid (or failed), 2 for bad usage, otherwise 0.
 *
 * The database is the one DATABASE_URL (or .env) names.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { describeLoadResult, loadFramework, type LoadResult } from "../src/lib/framework-import";
import { parseFrameworkImport } from "../src/lib/framework-import-schema";

const FRAMEWORKS_DIR = path.join(__dirname, "..", "prisma", "seed-data", "frameworks");

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("Usage: npm run frameworks:load -- [--allow-published] [<file.json> ...]");
  console.error("With no file, loads every *.json in prisma/seed-data/frameworks/.");
  process.exit(2);
}

async function loadFile(file: string, allowPublished: boolean): Promise<LoadResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8").replace(/^﻿/, ""));
  } catch (error) {
    return { status: "invalid", problems: [`couldn't read the file as JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const parsed = parseFrameworkImport(raw);
  if (!parsed.ok) return { status: "invalid", problems: parsed.problems };
  return loadFramework(prisma, parsed.data, { allowPublished, source: path.basename(file) });
}

async function main() {
  let allowPublished = false;
  const files: string[] = [];
  for (const arg of process.argv.slice(2)) {
    if (arg === "--allow-published") allowPublished = true;
    else if (arg.startsWith("-")) usage(`Unknown option ${arg}`);
    else files.push(path.resolve(arg));
  }

  if (files.length === 0) {
    const found = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(FRAMEWORKS_DIR, entry.name))
      .sort();
    if (found.length === 0) {
      console.log(`No *.json files in ${path.relative(process.cwd(), FRAMEWORKS_DIR) || FRAMEWORKS_DIR}; nothing to load.`);
      return 0;
    }
    files.push(...found);
  }

  let failed = 0;
  for (const file of files) {
    const shown = path.relative(process.cwd(), file) || file;
    try {
      const result = await loadFile(file, allowPublished);
      for (const line of describeLoadResult(shown, result)) console.log(line);
      if (result.status !== "loaded") failed += 1;
    } catch (error) {
      failed += 1;
      console.error(`${shown}: FAILED, the load was rolled back`);
      console.error(error);
    }
  }

  console.log(`${files.length - failed} of ${files.length} file(s) loaded${failed > 0 ? `, ${failed} refused, invalid or failed` : ""}.`);
  return failed > 0 ? 1 : 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
