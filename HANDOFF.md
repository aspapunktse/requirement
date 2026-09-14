# Handoff

Read this first in a fresh session, then [`README.md`](README.md)'s Project status section, then [`CONTEXT.md`](CONTEXT.md), then [`docs/adr/`](docs/adr/) (at least 0002 and 0003). This file is a snapshot of in-flight state, not a permanent doc — update or trim it as things land rather than letting it accumulate.

## Where things stand

- The original 16-issue backlog (core onboarding lifecycle + ISO 27001 Annex A Requirement Catalog) is done, merged, tested.
- The app's visual design was ported from `github.com/aspapunktse/isms` (design tokens, Aktiv Grotesk/Source Serif 4/JetBrains Mono, amber/blue brand colors) — done.
- **[ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md) is fully shipped (#47–#53), superseding ADR 0002.** System Type's old single-select model is now three independent, self-declared classification axes on `System` — multi-select **Deployment Facet**, boolean **Regulatory Overlay**, and ordinal **Impact Level** (Confidentiality/Integrity/Availability) — each composing with AND against a `Requirement`'s scoping. Key pieces, for when this needs revisiting:
  - `src/lib/requirement-assessments.ts`: `getApplicableRequirements(classification: SystemClassification)` is the one function that decides what applies to a System — facet/overlay scoping via Prisma `where`, Impact Level thresholds via `meetsAllImpactThresholds` in application code (Prisma enum filters don't support `gte`). `diffApplicabilityOps` is the shared "sync Assessment rows to a new applicable set" helper every classification-changing mutation goes through.
  - `src/lib/system-classification-change.ts`: `changeSystemClassification(system, changes)` handles Deployment Facet and/or Impact Level changes together in `PATCH /api/systems/[id]`, one diff against the combined old→new classification. `src/lib/system-overlays.ts` handles Regulatory Overlay declare/undeclare (its own connect/disconnect endpoint shape) through the same underlying diff logic.
  - All four self-declared classification mechanisms (Deployment Facet, Regulatory Overlay, Impact Level, Capability) are locked to Draft-only — one consistent rule, not each picking its own lifecycle cutoff.
  - `Requirement.framework` is a `String[]` (not a single string) so one Requirement row can be tagged with more than one framework at once — see `src/components/RequirementMappingManager.tsx` for the full admin authoring UI (create, edit every field, tag across all three axes, list view with a tag summary).
  - `CONTEXT.md`'s glossary reflects all of this as of #53 — that's the source of truth for the current model, not this section.
  - Superseded/closed along the way: #17 ("exactly one System Type"), #29/#30 (System-Type-specific recompute/locking invariants, generalized by #50/#51).

## What's open right now

Nothing in the ADR 0003 sequence or the original backlog — both are fully shipped. What's left is lower-priority and not time-sensitive:

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
- **Full `vitest run` takes ~5–10 minutes and can flake under load, including component tests.** Two distinct causes seen this session: (1) a known pre-existing DB test-isolation issue — some Requirement fixtures are unscoped (apply to every Deployment Facet), so concurrently-running test files can collide on cleanup with FK-constraint errors; (2) plain 5s test timeouts on `RequirementMappingManager.test.tsx`/`NewSystemForm.test.tsx` etc. under full-suite parallel worker contention on this machine — these use mocked `fetch`, no DB involved, so it's pure resource contention, not a logic issue. Either way: if a file fails only under the full suite and passes when re-run alone or in a small batch, that's this flake, not a regression — don't chase it as one.
- **Tests run against the same Postgres database as `npm run dev`** (`DATABASE_URL` in `.env` isn't test-specific). If a background test run gets killed mid-flight (e.g. superseded by a follow-up command before its `afterAll` cleanup runs), its fixture rows (`Test ...`, `test-...@example.com`, etc.) leak into the dev DB and show up in the app UI. Harmless but untidy — periodically `SELECT` for `code`/`name`/`email` LIKE `'Test %'`/`'test-%'` across `Requirement`/`DeploymentFacet`/`Capability`/`RegulatoryOverlay`/`User` and clean up if it's gotten noisy (done once this session).
- **Renaming a Prisma model where a required scalar FK needs to become a many-to-many relation** (exactly what #47 did to `SystemType`→`DeploymentFacet`): `prisma migrate dev`'s auto-diff cannot express this as a data-preserving change on its own. Hand-write the migration SQL instead — rename the table in place (preserves rows/ids), create the new join table, backfill it from the old FK column *before* dropping that column, and get the new join table's `A`/`B` column semantics right (Prisma names implicit m:n join tables `_<ModelAlphabeticallyFirst>To<ModelAlphabeticallySecond>`, so renaming a model can flip which side is `A` vs `B` — see `prisma/migrations/20260914175041_replace_system_type_with_deployment_facet/migration.sql` for the full worked example, including the rename-dance needed to swap column identity without moving data).
- **Test conventions**: route handlers are tested by importing and calling the exported `GET`/`POST`/`PATCH`/`DELETE` functions directly against a real Postgres (not mocked) — see any `__tests__/route.test.ts` for the `requestAs`/`ctxFor` helper pattern. Component tests use Testing Library with `vi.stubGlobal("fetch", ...)`.
- **Domain vocabulary**: `CONTEXT.md` is the glossary of record. Use its exact terms in code, tests, commits, and issues — don't drift to synonyms it explicitly avoids (see each entry's `_Avoid_` line).
- **Issue tracker**: GitHub Issues via `gh` CLI, conventions in `docs/agents/issue-tracker.md`. Standard flow this session: read issue → do the work → typecheck/lint/test → commit referencing the issue number → push → `gh issue close <n> --comment "..."` summarizing what was done/found.
- **README currency rule** (from `CLAUDE.md`): update `README.md`'s Project status whenever a change lands that affects what it describes. Don't let it go stale — this was the standing instruction that prompted the #47 README update.
