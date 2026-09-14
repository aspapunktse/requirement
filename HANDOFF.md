# Handoff

Read this first in a fresh session, then [`README.md`](README.md)'s Project status section, then [`CONTEXT.md`](CONTEXT.md), then [`docs/adr/`](docs/adr/) (at least 0002 and 0003). This file is a snapshot of in-flight state, not a permanent doc — update or trim it as things land rather than letting it accumulate.

## Where things stand

- The original 16-issue backlog (core onboarding lifecycle + ISO 27001 Annex A Requirement Catalog) is done, merged, tested.
- The app's visual design was ported from `github.com/aspapunktse/isms` (design tokens, Aktiv Grotesk/Source Serif 4/JetBrains Mono, amber/blue brand colors) — done.
- A "grilling" design session (triggered by asking whether invariant #17 was the right model for hybrid on-prem+cloud Systems) produced **[ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)**, which supersedes ADR 0002: System Type's single-select model is being replaced by multi-select **Deployment Facet** plus a separate **Overlay** layer (boolean Regulatory Overlays + ordinal CIA Impact Level). This is the main body of work in flight.
- **#47 (Deployment Facet, the foundational piece of ADR 0003) is shipped** — see its closing comment and commit `aaa62ee` for exactly what changed. Everything else in the ADR 0003 sequence builds on it.
- **#48 (Regulatory Overlay) and #49 (CIA Impact Level) are shipped** — implemented together in one pass since they turned out to share the same applicability-query refactor (`getApplicableRequirements` now takes a single `SystemClassification` object instead of positional facet-id args). See their closing comments for exactly what changed.
  - Regulatory Overlay follows the Capability self-declaration pattern exactly: admin catalog CRUD at `/api/regulatory-overlays`, System-side declare/undeclare at `/api/systems/[id]/regulatory-overlays[/[overlayId]]`, `src/lib/system-overlays.ts`. Declaring/undeclaring **does** recompute Assessment rows (same create/delete-untouched-rows logic as Deployment Facet change), via a new shared `diffApplicabilityOps` helper in `src/lib/requirement-assessments.ts` extracted for exactly this reuse.
  - CIA Impact Level added `System.{confidentiality,integrity,availability}ImpactLevel` and `Requirement.min{Confidentiality,Integrity,Availability}ImpactLevel` (a shared `LOW|MODERATE|HIGH|CRITICAL` enum). Threshold comparison can't be expressed as a portable Prisma enum filter (Prisma's enum filters don't support `gte`), so it's applied in application code after the facet/overlay-filtered fetch — see `meetsAllImpactThresholds` in `requirement-assessments.ts`. **Changing a System's Impact Level via `PATCH /api/systems/[id]` only sets the fields — it deliberately does NOT yet trigger the Assessment recompute** (unlike Facet/Overlay changes); wiring that in is explicitly #50's job ("Call it from every mutation point... each Impact Level axis change"), so this is a known, intentional gap until #50 lands, not an oversight.
  - Also extended the admin `RequirementMappingManager.tsx` with Regulatory Overlay checkboxes (mirroring the Deployment Facet ones) and the `PATCH /api/requirements/[id]` schema with `regulatoryOverlayIds` + the three `min*ImpactLevel` fields, so #50–#52 have something to build on. Per-axis Impact Level *pickers* in the admin UI (vs. the raw PATCH support) are explicitly #52's job, not built here.
  - `System.dataClassification` (free-text, unenforced) is gone, replaced by the three Impact Level fields — there was no non-null data in the dev DB to migrate/flag for review.
- **#50 (unified recompute) and #51 (lock all axes until Onboarded) are shipped** — done together since both touch the same classification-mutation call sites.
  - `src/lib/deployment-facet-change.ts` was renamed to **`src/lib/system-classification-change.ts`**; `changeDeploymentFacets`/`canChangeDeploymentFacets` are now `changeSystemClassification`/`canChangeSystemClassification`. `changeSystemClassification(system, changes)` takes a partial `{ deploymentFacetIds?, confidentialityImpactLevel?, integrityImpactLevel?, availabilityImpactLevel? }` and computes **one** diff against the combined old→new classification (not one diff per changed axis), so a request that changes both Facets and an Impact Level at once still produces a single correct recompute. `PATCH /api/systems/[id]` now routes both kinds of change through it.
  - Regulatory Overlay declare/undeclare (`src/lib/system-overlays.ts`) already went through the same `diffApplicabilityOps` helper as of #48, and already accounted for the System's current Impact Levels in its diff (since `SystemClassification` gained the impact fields in #49) — no changes needed there for #50.
  - Locking (#51): confirmed Draft-only (matching Capability's existing rule) as the one consistent cutoff across all four self-declared mechanisms, rather than loosening Facets/Overlays/Impact Levels to "any time before Onboarded" — Draft-only is a strict subset of "not yet Onboarded" so it trivially satisfies the original #30 invariant. Documented as a deliberate choice in `canChangeSystemClassification`'s doc comment. Added explicit Onboarded-status test cases alongside the existing IN_REVIEW ones for Facets/Overlays/Impact Levels.
  - Closed #29 and #30 referencing this work (see their closing comments) rather than writing new System-Type-specific tests for either.

## What's open right now

### ADR 0003 sequence (the main thread — work these in order)

| # | What | Depends on |
|---|---|---|
| ~~#47~~ | ~~Deployment Facet schema~~ | — (**done**) |
| ~~#48~~ | ~~Regulatory Overlay catalog + self-declaration~~ | — (**done**) |
| ~~#49~~ | ~~CIA Impact Level scale + fields~~ | — (**done**) |
| ~~#50~~ | ~~Unified recompute across facets/overlays/impact levels~~ | — (**done**) |
| ~~#51~~ | ~~Lock all axes once Onboarded~~ | — (**done**) |
| #52 | Admin UI: author Requirements tagged across everything | #47, #48, #49 |
| #53 | CONTEXT.md glossary update + close #29/#30 | all of the above |

**#52 is next**, then **#53 last** — #52 (admin UI) only needs the schema from #47–#49, which is done. #53 is deliberately last — it updates `CONTEXT.md`'s glossary to describe Regulatory Overlay/Impact Level, and that should only happen once the whole ADR 0003 design (including #52's admin authoring UI) is actually real, not aspirational (see `docs/agents/domain.md`: the glossary reflects resolved-and-shipped decisions). Note #53's own description says "close #29/#30" — that already happened as part of #50/#51 landing (see above), so #53 itself is just the glossary update at this point.

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
