/**
 * Creates or destroys one implementer's environment: a git worktree plus its
 * own copy of the dev DB. See "Parallel implementers" in
 * docs/agents/supervised-workflow.md, which this automates.
 *
 * Run from the main checkout, on `main`:
 *
 *   npm run implementer:create -- <issue> <slug>
 *   npm run implementer:destroy -- <issue> <slug> [--force]
 *
 * create:  worktree ../requirement-wt/<issue>-<slug> on a new branch
 *          <issue>-<slug> from origin/main, database requirement_<issue> copied
 *          from the dev DB, a `.env` pointing at it, then `npm ci`.
 * destroy: removes the worktree and the branch, and drops requirement_<issue>
 *          and every requirement_<issue>_* scratch DB. `--force` also discards
 *          uncommitted changes in the worktree.
 *
 * The dev DB itself is only ever read (pg_dump). Postgres runs in the
 * `requirement-db` container (docker-compose.yml), so the database commands go
 * through `docker exec`.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DB_CONTAINER = "requirement-db";
const WORKTREES_DIR = path.resolve(process.cwd(), "..", "requirement-wt");
const DATABASE_URL_LINE = /^DATABASE_URL=(["']?)(.+?)\1\s*$/m;

function fail(message: string): never {
  console.error(`implementer-env: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[]) {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

function capture(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

/** npm and npx are .cmd shims on Windows, which need a shell to run. */
function runNpm(command: string, cwd: string) {
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit", cwd });
}

function psql(user: string, sql: string) {
  return capture("docker", ["exec", DB_CONTAINER, "psql", "-U", user, "-d", "postgres", "-At", "-c", sql]);
}

function readDevDatabase() {
  if (!existsSync(".env")) fail("no .env here; run this from the main checkout.");
  const env = readFileSync(".env", "utf8");
  const match = env.match(DATABASE_URL_LINE);
  if (!match) fail("no DATABASE_URL line in .env.");
  const url = new URL(match[2]);
  return { env, url, user: decodeURIComponent(url.username), name: url.pathname.slice(1) };
}

function parseArgs() {
  const [action, issue, slug, ...flags] = process.argv.slice(2);
  if (action !== "create" && action !== "destroy") fail("usage: implementer-env <create|destroy> <issue> <slug> [--force]");
  if (!/^\d+$/.test(issue ?? "")) fail("the issue must be a number, e.g. 140.");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug ?? "")) fail("the slug must be lowercase words joined by hyphens, e.g. export-csv.");
  const unknown = flags.filter((flag) => flag !== "--force");
  if (unknown.length > 0) fail(`unknown argument: ${unknown.join(" ")}`);
  return { action, issue, branch: `${issue}-${slug}`, force: flags.includes("--force") };
}

function create(issue: string, branch: string) {
  const dev = readDevDatabase();
  const database = `${dev.name}_${issue}`;
  const worktree = path.join(WORKTREES_DIR, branch);

  if (capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") fail("the main checkout must be on main.");
  if (existsSync(worktree)) fail(`${worktree} already exists.`);
  if (capture("git", ["branch", "--list", branch]) !== "") fail(`branch ${branch} already exists.`);
  if (psql(dev.user, `SELECT 1 FROM pg_database WHERE datname = '${database}'`) !== "") {
    fail(`database ${database} already exists.`);
  }

  // The copy must start from main's schema: fails on a pending or failed migration.
  runNpm("npx prisma migrate status", process.cwd());

  run("git", ["fetch", "origin", "main"]);
  mkdirSync(WORKTREES_DIR, { recursive: true });
  run("git", ["worktree", "add", worktree, "-b", branch, "origin/main"]);

  run("docker", ["exec", DB_CONTAINER, "createdb", "-U", dev.user, database]);
  run("docker", [
    "exec",
    DB_CONTAINER,
    "sh",
    "-c",
    `pg_dump -U ${dev.user} ${dev.name} | psql -U ${dev.user} -q -v ON_ERROR_STOP=1 -d ${database} > /dev/null`,
  ]);

  // Only `.env` is carried over: `.env.local` and `.env.production.local` hold
  // Vercel and production credentials an implementer must not have.
  const url = new URL(dev.url);
  url.pathname = `/${database}`;
  writeFileSync(path.join(worktree, ".env"), dev.env.replace(DATABASE_URL_LINE, () => `DATABASE_URL="${url}"`), "utf8");

  runNpm("npm ci", worktree);

  console.log(`\nReady for the brief:\n  worktree: ${worktree}\n  branch:   ${branch}\n  database: ${database}`);
}

function destroy(issue: string, branch: string, force: boolean) {
  const dev = readDevDatabase();
  const worktree = path.join(WORKTREES_DIR, branch);

  if (existsSync(worktree)) {
    run("git", ["worktree", "remove", ...(force ? ["--force"] : []), worktree]);
  } else {
    run("git", ["worktree", "prune"]);
  }
  if (capture("git", ["branch", "--list", branch]) !== "") run("git", ["branch", "-D", branch]);

  // `_` is a LIKE wildcard, so the prefix match is redone exactly below.
  const prefix = `${dev.name}_${issue}`;
  const databases = psql(dev.user, `SELECT datname FROM pg_database WHERE datname LIKE '${prefix}%'`)
    .split(/\r?\n/)
    .filter((name) => name === prefix || name.startsWith(`${prefix}_`));
  for (const database of databases) {
    run("docker", ["exec", DB_CONTAINER, "dropdb", "-U", dev.user, "--force", database]);
  }

  console.log(`\nRemoved ${branch}; dropped ${databases.length > 0 ? databases.join(", ") : "no databases"}.`);
}

const { action, issue, branch, force } = parseArgs();
if (action === "create") create(issue, branch);
else destroy(issue, branch, force);
