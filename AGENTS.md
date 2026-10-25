<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions

This file is the single source of instructions for every coding agent on this repo. Codex and other tools read it directly; Claude Code reads it through the `@AGENTS.md` import at the top of `CLAUDE.md`. Put shared rules here, outside the Next.js block above (`next dev` rewrites only what is between its markers). `CLAUDE.md` holds only what is specific to Claude Code.

## Issue tracker

Issues live in GitHub Issues (aspapunktse/requirement), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

## Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

## Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development workflow: supervisor + implementer sub-agents

Implementation work runs as a **supervised sub-agent workflow**. The main session is the **supervisor**, and it doesn't write feature code itself. It works issues in dependency order, at most two at a time, each in its own git worktree with its own database: it briefs one implementer sub-agent per issue, reviews what comes back, verifies in the browser, opens the PR, waits for CI, merges it once CI is green, and watches the production deploy. Policy questions go to the product owner rather than being decided silently. Follow [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md): it holds the full loop, the rules every implementer brief must carry (migrations, CI-not-seeded tests, UTF-8, no push/PR), and the known environment gotchas. The current queue is in `HANDOFF.md` under "Next up".

That document names Claude Code's tools (the Agent tool, `SendMessage`, `AskUserQuestion`, `preview_stop`). In another harness, use its equivalents: the roles, the order of work, the brief rules and the review steps apply unchanged. If your harness can't spawn sub-agents, ask the product owner how to proceed before implementing an issue yourself.

## Design proposals

Static design prototypes live in `public/design/<part>/proposal-<x>.html`, and `/design` is their landing page. Whenever a proposal is added, renamed or removed, update `public/design/proposals.js` in the same change: a new part goes first in the list, with its `added` date and the question it answers, and each proposal gets a stable `id` (`<part>-<x>`), a title and a one-line summary. The previews and the voting work from that entry alone. Don't change an `id` once people have voted on it; the votes are stored under it.

Every new or reworked proposal carries the app's navigation bar in its header, so each page is designed as part of the whole app, not as a page on its own. Use the shared header in `public/design/shared/`: load `appbar.css` and `appbar.js`, put an empty `<header id="appbar"></header>` at the top of the page, and call `Appbar.mount({ current, proposal, items })` (the comment at the top of `appbar.js` explains the options). Don't hand-build a header or a page-specific nav. The header holds the main navigation (collapsing to a menu on narrow screens), "Jump to" with the Ctrl+K palette and the acting-user switch; the acting role is kept in the URL hash and carried across pages. When a part of the app gets its first proposal, or another proposal becomes the preferred one, update its `href` in the `NAV` list in `appbar.js` in the same change.

Build on what has shipped so designs don't drift apart. The Home command center (#226) set the current look: 16px cards with a header row, a hero with a ring, stat cards that double as filters, tabs with counts, lane headers, 10px-radius controls and the Ctrl+K palette. `public/design/shared/kit.css` and `kit.js` hold those parts on the Register tokens in `public/design/systems/systems.css`; reuse them rather than restyling. When a proposal ships and changes that look, update the shared files to match. `public/design/systems/proposal-a.html` is the reference example.

## Keep README.md current

Whenever a change lands that affects what's described in `README.md` — a feature ships, an issue closes, the project status changes, a deferred item gets picked up, setup/scripts/stack change — update `README.md` in the same piece of work rather than leaving it to drift. In particular, keep the "Project status" section an accurate snapshot of what's actually implemented, not a point-in-time note that goes stale. Don't treat this as optional cleanup; treat a change as incomplete until README reflects it.

**Keep it short.** `README.md` says what the app does today, in a line or two per capability. It is not a log: no per-issue write-ups, routes, migration names, test file lists or measured figures. That detail goes in the pull request description, and product-owner decisions go on the issue. When an issue changes a capability, edit its existing line rather than adding a paragraph. [`docs/implementation-history.md`](docs/implementation-history.md) holds the old per-issue record up to PRD 0001 milestone 3 and is frozen; don't add to it.

## Review guidelines

These guide automated PR reviews (Codex) and any agent asked to review a change. Every merge to `main` is a production deploy that runs migrations against production, so a review is the last check before real data is touched.

**How to review**

- Read the linked issue (`Closes #n`) and its comments first. The issue is the spec, and its comments hold the product owner's decisions. Check the change does what the issue asks, all of it and no more.
- Report problems a careful senior reviewer would block or fix before merge: wrong behaviour, data loss, security gaps, missing tests for new behaviour, broken project rules. Every finding names the file and line, says what goes wrong and under what input or state, and suggests a fix.
- Rank findings by impact. Mark a suggestion that is a matter of taste or optional polish as a nit, or leave it out. Don't comment on formatting that ESLint and TypeScript already enforce, and don't restate what the diff does.
- Don't flag something as wrong because it differs from older Next.js, React or Prisma versions you know. This repo runs Next.js 16 (see the block at the top of this file); check `node_modules/next/dist/docs/` before calling an API misused.
- When a rule here and the code disagree, say so rather than guessing which one is right.

**Data and migrations** (`prisma/migrations/`, `prisma/schema.prisma`)

- Read every migration's SQL in full. Its directory name must sort after the latest migration already on `main`.
- Data migrations select rows by stable properties, never by hard-coded ids or display names alone (names are editable in the UI), are idempotent where possible (`ON CONFLICT DO NOTHING`), and are a no-op on an empty database.
- Flag anything that can drop or lose data: dropped columns or tables without a backfill, a renamed model that flips an implicit many-to-many join table's `A`/`B` columns, a required foreign key turned into a relation without copying rows.
- An enum value added with `ALTER TYPE ... ADD VALUE` can't be used in the same migration; it needs its own earlier migration.
- A migration that can raise an exception blocks every later deploy until someone repairs production by hand. It must ship with a read-only pre-check script (`scripts/check-*-migration.ts` is the pattern) and the PR must say so.
- `schema.prisma` and the migrations must agree (no drift). A schema change without a migration, or the reverse, is a blocking finding.
- Use the domain terms from `CONTEXT.md` for new models, fields, enum values and UI text. Flag a change that contradicts a decision in `docs/adr/` unless the PR records a new decision.

**Authorization and security**

- Every protected API route handler resolves the acting user with `authenticate` or `authorize` from `src/lib/api-authz.ts` before reading or writing, and checks object-level rights too (for example, that the acting user owns the System they change), not just the role. Only four routes are public by design: `api/health` (health check), `api/design-votes` (anonymous design voting), `api/session/acting-user` (sets the acting user, so it runs before there is one) and `api/cron/stat-snapshots` (the Vercel cron; it requires `CRON_SECRET` instead and refuses every call without it). A new unauthenticated route needs a stated reason in the PR.
- A refused request returns 401/403 and changes nothing. Look for writes made before the check, or checks done after a partial write.
- Validate request bodies with zod at the boundary. Don't trust ids, roles or status values sent by the client.
- No secrets, credentials or production URLs in code, tests, fixtures or logs. No raw SQL built by string concatenation with user input (`$queryRawUnsafe` with interpolation).
- When unsure, the conservative choice is right: deny rather than allow, preserve data rather than drop it.

**Correctness**

- Inside `prisma.$transaction(async (tx) => …)`, every query, including in helpers it calls, uses `tx`, not the global `prisma`. A query on the global client inside a transaction can deadlock CI's 3-connection pool.
- A loader that reads several tables or nests required relations does its reads in one `RepeatableRead` transaction (`loadStatementOfApplicability` is the example), or it can throw under concurrent deletes.
- Multi-step writes that must succeed or fail together run in one transaction. A change that records a Change Event writes it in the same transaction, by passing `tx` to `logChangeEvent`.
- Check edge cases: empty lists, missing optional relations, a deleted or archived parent, concurrent edits, and role switches.
- React components: no state reset in an effect that also runs after mount, no fetches without error and loading states, no missing keys, and no stale closures in handlers.

**Tests** (Vitest)

- New behaviour and every bug fix come with tests. Route tests call the exported handlers against real Postgres (the `requestAs` / `ctxFor` pattern); component tests use Testing Library with a stubbed `fetch`.
- CI's test database is migrated but **not seeded**. A test that depends on seeded rows passes locally and fails in CI. Tests create their own uniquely named `Test …` fixtures and remove them in `afterAll`.
- Tests never create, flip or delete a base Framework; they use `getBaseFramework()`. A fixture Organizational Control is never mapped to the base Framework. Unscoped `PER_SYSTEM` Control fixtures leak into other test files.
- A base Framework Requirement with no Control Mappings is Not Met on every System, so it leaks into other test files too. Fixture base Requirements always have a mapping, and are deleted before their Controls: `cleanupFixtureRequirements()` first in the `afterAll` that deletes Controls, `deleteFixtureRequirement()` before deleting one mid-file.
- Refused writes assert that nothing changed in the database, not only the status code.

**Project rules a PR must keep**

- `README.md`'s Project status is updated in the same PR when a capability changes, in a line or two. It isn't a log: no per-issue write-ups, routes, migration names or test lists. `docs/implementation-history.md` is frozen.
- A design proposal added, renamed or removed under `public/design/` updates `public/design/proposals.js` in the same change. An existing proposal `id` never changes.
- Files are valid UTF-8.
- No new ESLint warnings (the baseline is 5, all `react-hooks/set-state-in-effect`).
- `.claude/` and secret-bearing env files (`.env`, `.env.*.local`) are never committed. The tracked `.env.example` template holds only local placeholders and is kept current when setup variables change.
