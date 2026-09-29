# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Direction: becoming a GRC tool

The app is being developed into a governance, risk and compliance (GRC) tool. The first module is a **requirement database**: Frameworks (ISO 27001:2022 as the base, plus Cybersäkerhetslagen, CSA CCM 4, …), each made up of its own Requirements, all mapped onto one Control Library. Controls are inherited from the Organization or from Provider Systems, compliance is continuous rather than frozen at onboarding, and internal audit can verify Controls through Check-ups. The steering document is [PRD 0001](docs/prd/0001-grc-requirement-database.md), with decisions in [ADRs 0005–0008](docs/adr/).

**Only the first step has landed so far:** the rename of the old `Requirement` concept to **Control** (#70, [ADR 0005](docs/adr/0005-split-requirement-and-control.md)) — the code now says `Control`, `ControlAssessment`, `AssessmentQuery`, `/admin/controls` and `/api/controls`, matching the glossary. Nothing else is implemented yet: there is no Framework-owned Requirement entity or Control Mapping, and the code still has `Capability`/`RegulatoryOverlay` where [`CONTEXT.md`](CONTEXT.md)'s *target* vocabulary has **Provider** and Framework Scope. Each glossary entry's historical note maps new terms to the names still used in code. The "Project status" section below describes what's actually built today, using the code's current names. Work proceeds in the PRD's five milestones (model split → applicability → inheritance → content & SoA → internal audit).

## Project status

**As of this writing: the full original 16-issue backlog, the follow-on [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md) design (issues #47–#53), the Business Risk Owner role (#55), the role-differentiated landing page (#54), Assessment Queries (#56, then called Requirement Queries), the EMS-style landing-page redesign (#57), the `/` role-checker page (#59) and its isms-style redesign (#64), and the header / `/home` chrome alignment (#65), the Change Event log (#58), the Business Risk Owner's System Portfolio view (#62), and the Requirement → Control rename (#70) are implemented, tested, and merged.** The core onboarding workflow, the ISO 27001 Annex A Control Library, multi-axis classification (Deployment Facet, Regulatory Overlay, Impact Level), and scoped cross-System Risk/compliance reporting all work end-to-end. The extension-points catalog (10 "evaluate this question" tickets) has also been fully worked through and closed. Three issues are open right now — see `HANDOFF.md`.

What exists and works:
- Next.js/Prisma/Postgres scaffold, Docker, and a CI → CD → Vercel production pipeline gated on green CI (see CI/CD below)
- Dev-only auth stub with a role switcher and server-enforced authorization for all 6 roles (`ADMIN`, `RISK_OWNER`, `SYSTEM_OWNER`, `REVIEWER`, `VIEWER`, `BUSINESS_RISK_OWNER`)
- The full onboarding lifecycle: create a System → assess it against the Control Library → log Risks → submit for review → a Reviewer's Approve/Reject decision (Rejected returns to Draft, not a dead end) → mark Onboarded
- The Control Library (`/admin/controls`): the 93-control ISO 27001:2022 Annex A seed, Deployment Facet-based scoping (a System declares one or more facets — e.g. On-Prem, Cloud — and Hybrid is simply declaring more than one, not its own catalog entry), self-declared Regulatory Overlay scoping (e.g. GDPR, EAR/ITAR — same self-declaration model as Capability), self-declared CIA Impact Level thresholds (Confidentiality/Integrity/Availability, each an independent Low/Moderate/High/Critical axis a Control can set a minimum on), the per-Control Self-Assessment Question (Yes auto-fulfills, No auto-opens a linked Risk, N/A is Admin/Risk-Owner-gated), and Capability declaration that auto-fulfills mapped Controls and reverts them on removal (unless a human has since touched the Assessment) — see [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)
- Changing any of a Draft System's three classification axes — declared Deployment Facets, declared Regulatory Overlays, or Impact Level thresholds — recomputes its applicable Control set (a single diff against the combined old vs. new classification) without discarding work already done: newly-applicable mandatory Controls get `NOT_STARTED` Assessments, no-longer-applicable untouched ones are removed, and no-longer-applicable *touched* ones are left in place as stale for the owner to resolve
- All three classification axes (Deployment Facets, Regulatory Overlays, Impact Levels) are locked the same way Capability already was: changeable only while a System is Draft, not just once Onboarded — one consistent rule across all four mechanisms rather than each picking its own lifecycle cutoff
- Admin CRUD (including retire) for the Deployment Facet, Capability, Regulatory Overlay, Business Unit, and Framework catalogs
- Full Control authoring: create a new Control Library entry (code, title, description, category, mandatory flag, applicability, Self-Assessment Question/intent/examples) and edit any of it later, from the admin UI — not just the facet/overlay/capability/framework mappings. `Control.frameworks` is a relation to the Framework catalog (not free text), so one Control row can be tagged as satisfying more than one framework at once (e.g. both an ISO 27001 control and a CSA CCM control) rather than needing a duplicate row per framework — the "author once, tag many" model ADR 0003 called for. The admin list view surfaces every Control's full tag set (framework(s), Deployment Facets, Regulatory Overlays, Impact Level thresholds) at a glance, to spot near-duplicates before creating a new row instead of tagging an existing one
- The `BUSINESS_RISK_OWNER` role (#55): a System now also self-declares which Business Unit(s) consume it and which Framework(s)' audit/certification boundary it's in scope for ("Framework Scope") — both purely reporting dimensions, editable at any lifecycle stage (not Draft-locked, unlike the four classification mechanisms above, since usage/audit scope can genuinely change after a System is live). A Business Risk Owner is assigned a portfolio of Business Unit(s) and/or Framework(s) (independent axes, admin-managed) and gets a scoped, read-only dashboard: a cross-System Risk queue, a compliance-percentage view (pooled per scope, not averaged; a Framework can require strict 100%-Fulfilled scoring via `strictComplianceRequired`), and a System Portfolio view (#62) — Systems in scope grouped into status-colored clusters by `OnboardingStatus`, each card showing name, vendor, compliance-%, and open-Risk-count, linking to the System's own detail page — see [ADR 0004](docs/adr/0004-framework-as-first-class-entity.md) for why `framework` was promoted from a free-text tag to a first-class catalog entity to support this
- A role-differentiated landing page at `/home` (#54, redesigned by #57): a `PageHead` (mono page-id, serif title, lede, a stat-strip of headline counts), a unified "My tasks" status-row table for anything needing that role's attention (Systems, Risks, and Assessment Queries all in one table, each row tagged by kind and toned by real severity/urgency), and a "Where to start" tile grid of pure navigation shortcuts. `ADMIN` and `VIEWER` — whose data isn't task-shaped — get the stat-strip and tile grid only, no task table. `/systems` still accepts `?status=` and `?owner=me` query params so tiles can deep-link into a filtered view
- `/` (#59, restyled in #64 to match the isms sign-in page) is a dev-stub-gated sign-in page: a segmented tile per seeded user plus a "Sign in →" button that stays disabled until a tile is picked, shown only when no acting user is set yet (redirects straight to `/home` once one is); the app header (#65, following the isms header: logo mark and wordmark, acting-user chip; wordmark only on `/`) doubles as the mid-session `RoleSwitcher` when the dev stub is on, a keyboard-operable listbox in the sign-in tile style, and redirects to `/home` after every switch instead of refreshing the current page, so switching to a role that can't see the current page never dead-ends on a 404
- Assessment Queries (#56): a `REVIEWER`/`RISK_OWNER`/`ADMIN` can raise a lightweight, non-blocking question thread scoped to one Control Assessment — the System Owner (or another `REVIEWER`/`RISK_OWNER`/`ADMIN`) replies inline, and a `REVIEWER`/`RISK_OWNER`/`ADMIN` marks it resolved once satisfied (never the System Owner, and not necessarily the original asker). Doesn't touch the Assessment's status, gate Approval, or affect the submission check — purely a turn-aware unresolved-count badge, shown on the Control's own row, rolled up per System on `/systems`, and as a landing-page card per role
- A Change Event log (#58): a curated `ChangeEvent` table records System-lifecycle-relevant mutations — status transitions, Approval decisions, Risk/Control Assessment status changes, Assessment Query activity, and classification/Capability/Business Unit/Framework Scope declare-or-remove — each tagged with an `action`, a human-readable `detail`, and an actor (a User id, or the literal `"system"` for a side effect the backend computed, like a Capability auto-fulfilling an Assessment or a "No" answer auto-opening a Risk). Deliberately not a full audit trail — pure catalog-admin CRUD is out of scope. Not surfaced in the UI yet; this is the data source a future "Recent updates" feed on `/home` will read from

What's *not* decided yet (deliberately deferred, not overlooked):
- Real authentication (SSO/OIDC) — still the dev-only role switcher
- Multi-tenancy — currently single-tenant; the intent is to add tenant/org scoping later. This was deliberately *not* written up as an ADR, since single-tenancy is a stepping stone, not a permanent commitment — expect an `Organization`/tenant scope to eventually land on `System`, `User`, and the Control Library
- Notifications on status changes — out of scope until now; the core workflow is proven, so this is a reasonable next thing to propose
- Retiring a `Control` from the Control Library — Deployment Facet, Capability, Regulatory Overlay, Business Unit, and Framework can be retired, Control deliberately wasn't (see [issue #13](https://github.com/aspapunktse/requirement/issues/13)'s closing comment)

**Picking this up in a fresh session?** Read, in order: [`HANDOFF.md`](HANDOFF.md) (what's in flight and what to do next), this section, [`CONTEXT.md`](CONTEXT.md), [`docs/adr/`](docs/adr/). The original backlog, ADR 0003, the extension-points catalog, #55 (Business Risk Owner), #54 (the role-differentiated landing page), #56 (Assessment Queries), #57 (the EMS-style landing-page redesign), #59 (the `/` role-checker page), #58 (the Change Event log), and #62 (the Business Risk Owner's System Portfolio view) are all fully shipped/closed — three issues are open: #46 (Control content versioning + targeted notifications; filed before the ADR 0005 rename, so it still says "Requirement"), #61 (a possible future per-System audit trail built on #58, deliberately deferred), and #63 (refactor effect-based data fetching so the `react-hooks/set-state-in-effect` lint rule, currently downgraded to `warn` to unblock CI, can go back to `error`), all fully scoped and ready to pick up whenever. [`docs/agents/`](docs/agents/) documents how the repo is configured for Matt Pocock's engineering skills (issue tracker conventions, domain-doc consumer rules) if you're using those.

## Stack

- **Next.js 16 (App Router) + TypeScript** — frontend & API routes
- **Prisma + PostgreSQL** — data layer
- **Vitest + Testing Library** — unit/integration tests
- **Docker** — local Postgres and production container image
- **GitHub Actions** — CI on every PR, CD on merge to `main`

## Domain model

Vocabulary and workflow rules live in [`CONTEXT.md`](CONTEXT.md), not here — that's the source of truth so it doesn't drift out of sync with a second copy. It describes the target GRC model from [PRD 0001](docs/prd/0001-grc-requirement-database.md), which the code is still being migrated to (see "Direction" above). Architectural decisions (e.g. why `Approved` and `Onboarded` are separate states) are in [`docs/adr/`](docs/adr/). The Prisma schema implementing all of this is [`prisma/schema.prisma`](prisma/schema.prisma).

## Getting started

```bash
cp .env.example .env
docker compose up -d db
npm install
npx prisma migrate dev
npx prisma db seed
npm run dev
```

App runs at http://localhost:3000, health check at `/api/health`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm test` | Run Vitest suite |
| `npm run prisma:migrate` | Create/apply a local migration |
| `npm run prisma:studio` | Browse the database |
| `npm run vercel:env:pull` | Pull a linked Vercel project's production env vars into `.env.production.local` |
| `npm run prisma:seed:prod` | Run the seed script against `.env.production.local` (see below) |

## Seeding a Vercel deployment

The seed script (`prisma/seed.ts`) is meant to run **once, from your machine, against the production database** — not as part of Vercel's build step, since a build can re-run and you don't want the seed firing repeatedly against prod.

```bash
npm i -g vercel        # if you don't have the CLI yet
vercel link            # link this checkout to the Vercel project, once
npm run vercel:env:pull  # writes .env.production.local (gitignored)
npm run prisma:seed:prod
```

Make sure `prisma migrate deploy` has already been run against that same database first (the Vercel project's build command is `npx prisma migrate deploy && npm run build`, so every production deploy applies pending migrations automatically; you can also run it manually with the same `.env.production.local`). Check `prisma/seed.ts` before re-running it against a real environment — it upserts most rows, but confirm it won't create duplicate demo data if run twice.

## CI/CD

- **`.github/workflows/ci.yml`** runs on every pull request and push to `main`: lint, typecheck, unit tests against a real Postgres service container, production build, and a Docker build check. `react-hooks/set-state-in-effect` is currently downgraded to `warn` in `eslint.config.mjs` (8 existing components fetch in effects) so lint can pass — tracked in #63. Nothing in GitHub *enforces* CI on merge (see below), so the CD gate is what actually protects production.
- **`.github/workflows/cd.yml`** runs after CI succeeds on `main`: builds and pushes the production image to GitHub Container Registry (`ghcr.io/<owner>/<repo>`), then a `deploy` job (gated by the `production` GitHub Environment) deploys that commit to Vercel with the Vercel CLI (`vercel deploy --prod`; Vercel builds remotely, so its project env vars like `DATABASE_URL` stay in Vercel). Vercel's own Git auto-deploy is disabled for `main` in `vercel.json` so production only ships from a green commit; other branches still get Vercel preview deployments. Requires a `VERCEL_TOKEN` secret (the org/project IDs are in the workflow file).

### Repo settings

- Branch protection/rulesets aren't available on this private, free-plan repo, so a red CI run can't block a merge. Production is still safe: the `deploy` job only runs after CI succeeds. If the repo moves to GitHub Pro (or goes public), protect `main` and require the CI workflow plus PR review.
- Add a `production` GitHub Environment with required reviewers if deploys should be gated by human approval.
- Set the `VERCEL_TOKEN` secret (on the `production` environment or repo-wide) for the deploy step — do not commit it.

## Docker

```bash
docker compose up --build
```

Runs the production image against a local Postgres instance.

> **Known caveat**: `docker compose` was unavailable on the machine this was originally scaffolded on (Docker Desktop install without the compose plugin registered), so this file is written to spec but wasn't exercised end-to-end there. Verified separately: a plain `docker build .` succeeds, and a plain `docker run` Postgres container works with `prisma migrate dev` + `prisma db seed` against it. If `docker compose up` fails for you, that's the most likely first thing to check, not a schema/app problem.
