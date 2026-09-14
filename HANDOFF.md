# Handoff

Read this first in a fresh session, then [`README.md`](README.md)'s Project status section, then [`CONTEXT.md`](CONTEXT.md), then [`docs/adr/`](docs/adr/) (at least 0002 and 0003). This file is a snapshot of in-flight state, not a permanent doc — update or trim it as things land rather than letting it accumulate.

## Where things stand

- The original 16-issue backlog (core onboarding lifecycle + ISO 27001 Annex A Requirement Catalog) is done, merged, tested.
- The app's visual design was ported from `github.com/aspapunktse/isms` (design tokens, Aktiv Grotesk/Source Serif 4/JetBrains Mono, amber/blue brand colors) — done.
- A "grilling" design session (triggered by asking whether invariant #17 was the right model for hybrid on-prem+cloud Systems) produced **[ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)**, which supersedes ADR 0002: System Type's single-select model is being replaced by multi-select **Deployment Facet** plus a separate **Overlay** layer (boolean Regulatory Overlays + ordinal CIA Impact Level). This is the main body of work in flight.
- **#47 (Deployment Facet, the foundational piece of ADR 0003) is shipped** — see its closing comment and commit `aaa62ee` for exactly what changed. Everything else in the ADR 0003 sequence builds on it.

## What's open right now

### ADR 0003 sequence (the main thread — work these in order)

| # | What | Depends on |
|---|---|---|
| ~~#47~~ | ~~Deployment Facet schema~~ | — (**done**) |
| #48 | Regulatory Overlay catalog + self-declaration | #47 |
| #49 | CIA Impact Level scale + fields | #47 |
| #50 | Unified recompute across facets/overlays/impact levels | #47, #48, #49 |
| #51 | Lock all axes once Onboarded | #47, #48, #49 |
| #52 | Admin UI: author Requirements tagged across everything | #47, #48, #49 |
| #53 | CONTEXT.md glossary update + close #29/#30 | all of the above |

**#48 and #49 are the next things to pick up** — both are unblocked (only depend on #47), and can be done in either order or in parallel by separate sessions. #50/#51/#52 need both of them done first. #53 is deliberately last — it updates `CONTEXT.md`'s glossary to describe Regulatory Overlay/Impact Level, and that should only happen once they're actually real, not aspirational (see `docs/agents/domain.md`: the glossary reflects resolved-and-shipped decisions).

`CONTEXT.md`'s **Requirement** entry already has a `_Pending_` note pointing at this — a fresh session can find it there too.

### Separate, parallel-track item

- **#46** — "Version Requirement content after initial seed; notify affected Systems on update." Fully scoped (versioning + targeted per-Requirement notification + a cosmetic-vs-substantive checkbox on update, all worked out with the user directly in issue comments). Not part of the ADR 0003 chain — could be picked up independently whenever. Depends conceptually on #42 (no notification mechanism exists yet) per its own body.

### Extension-points backlog (lower priority, pick up anytime)

10 tickets remain from the original extension-points catalog: **#33, #35, #37, #38, #40, #41, #42, #43, #44, #45**. Each is a "not a scoped task — evaluate this question" ticket. The established pattern from the ones already closed (#32, #34, #36, #39):
1. Read the ticket, actually investigate the codebase for the concrete question it asks.
2. Most of the time the answer is "no action needed now" — post a comment explaining what was checked and why, then close.
3. Occasionally (like #36) the investigation turns up a real, concrete gap — fix it, and close referencing the fix.
4. Occasionally (like #32) it turns up a *different* concrete problem than the ticket assumed — comment explaining the correction, spin out a new precisely-scoped ticket for the real issue (see #46), close the original.

No particular order matters here; pick whichever seems most relevant to whatever else is being worked on.

## Conventions and gotchas learned this session

- **Dev server on this OneDrive-synced Windows filesystem compiles slowly on first hit** — `curl`/navigate often returns transient 404/500/timeout before settling to 200. Not a bug; warm up with a long-timeout `curl` before using the Browser pane, and re-screenshot after a `wait` if a page shows "Compiling…"/"Rendering…".
- **Transient network blips** on `prisma migrate deploy`/`gh` commands (`Can't reach database server`, `TLS handshake timeout`) have shown up a few times and were not real failures — retry once; verify the DB itself is fine with `docker exec requirement-db psql -U app -d requirement -c "SELECT 1;"` before assuming something's actually broken.
- **Docker Postgres**: container `requirement-db`, user `app`, db `requirement`, port 5432, already running throughout this session (`docker ps --filter name=requirement-db`).
- **Full `vitest run` takes ~5–10 minutes.** There's a known pre-existing test-isolation flake: some Requirement fixtures are unscoped (apply to every System Type/Facet), so concurrently-running test files can collide on cleanup with FK-constraint errors. Confirmed via re-running the failing file alone — if a single file fails only under the full suite and passes in isolation, that's this flake, not a regression.
- **Renaming a Prisma model where a required scalar FK needs to become a many-to-many relation** (exactly what #47 did to `SystemType`→`DeploymentFacet`): `prisma migrate dev`'s auto-diff cannot express this as a data-preserving change on its own. Hand-write the migration SQL instead — rename the table in place (preserves rows/ids), create the new join table, backfill it from the old FK column *before* dropping that column, and get the new join table's `A`/`B` column semantics right (Prisma names implicit m:n join tables `_<ModelAlphabeticallyFirst>To<ModelAlphabeticallySecond>`, so renaming a model can flip which side is `A` vs `B` — see `prisma/migrations/20260914175041_replace_system_type_with_deployment_facet/migration.sql` for the full worked example, including the rename-dance needed to swap column identity without moving data).
- **Test conventions**: route handlers are tested by importing and calling the exported `GET`/`POST`/`PATCH`/`DELETE` functions directly against a real Postgres (not mocked) — see any `__tests__/route.test.ts` for the `requestAs`/`ctxFor` helper pattern. Component tests use Testing Library with `vi.stubGlobal("fetch", ...)`.
- **Domain vocabulary**: `CONTEXT.md` is the glossary of record. Use its exact terms in code, tests, commits, and issues — don't drift to synonyms it explicitly avoids (see each entry's `_Avoid_` line).
- **Issue tracker**: GitHub Issues via `gh` CLI, conventions in `docs/agents/issue-tracker.md`. Standard flow this session: read issue → do the work → typecheck/lint/test → commit referencing the issue number → push → `gh issue close <n> --comment "..."` summarizing what was done/found.
- **README currency rule** (from `CLAUDE.md`): update `README.md`'s Project status whenever a change lands that affects what it describes. Don't let it go stale — this was the standing instruction that prompted the #47 README update.
