# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Project status

**As of this writing: the full original 16-issue backlog, the follow-on [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md) design (issues #47–#53), and the Business Risk Owner role (#55) are implemented, tested, and merged.** The core onboarding workflow, the ISO 27001 Annex A Requirement Catalog, multi-axis classification (Deployment Facet, Regulatory Overlay, Impact Level), and scoped cross-System Risk/compliance reporting all work end-to-end. The extension-points catalog (10 "evaluate this question" tickets) has also been fully worked through and closed. Two issues are open right now — see `HANDOFF.md`.

What exists and works:
- Next.js/Prisma/Postgres scaffold, CI/CD, Docker (see Stack/CI-CD below)
- Dev-only auth stub with a role switcher and server-enforced authorization for all 6 roles (`ADMIN`, `RISK_OWNER`, `SYSTEM_OWNER`, `REVIEWER`, `VIEWER`, `BUSINESS_RISK_OWNER`)
- The full onboarding lifecycle: create a System → assess it against the Requirement Catalog → log Risks → submit for review → a Reviewer's Approve/Reject decision (Rejected returns to Draft, not a dead end) → mark Onboarded
- The Requirement Catalog: the 93-control ISO 27001:2022 Annex A seed, Deployment Facet-based scoping (a System declares one or more facets — e.g. On-Prem, Cloud — and Hybrid is simply declaring more than one, not its own catalog entry), self-declared Regulatory Overlay scoping (e.g. GDPR, EAR/ITAR — same self-declaration model as Capability), self-declared CIA Impact Level thresholds (Confidentiality/Integrity/Availability, each an independent Low/Moderate/High/Critical axis a Requirement can set a minimum on), the per-Requirement Self-Assessment Question (Yes auto-fulfills, No auto-opens a linked Risk, N/A is Admin/Risk-Owner-gated), and Capability declaration that auto-fulfills mapped Requirements and reverts them on removal (unless a human has since touched the Assessment) — see [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)
- Changing any of a Draft System's three classification axes — declared Deployment Facets, declared Regulatory Overlays, or Impact Level thresholds — recomputes its applicable Requirement set (a single diff against the combined old vs. new classification) without discarding work already done: newly-applicable mandatory Requirements get `NOT_STARTED` Assessments, no-longer-applicable untouched ones are removed, and no-longer-applicable *touched* ones are left in place as stale for the owner to resolve
- All three classification axes (Deployment Facets, Regulatory Overlays, Impact Levels) are locked the same way Capability already was: changeable only while a System is Draft, not just once Onboarded — one consistent rule across all four mechanisms rather than each picking its own lifecycle cutoff
- Admin CRUD (including retire) for the Deployment Facet, Capability, Regulatory Overlay, Business Unit, and Framework catalogs
- Full Requirement authoring: create a new Requirement Catalog entry (code, title, description, category, mandatory flag, applicability, Self-Assessment Question/intent/examples) and edit any of it later, from the admin UI — not just the facet/overlay/capability/framework mappings. `Requirement.frameworks` is a relation to the Framework catalog (not free text), so one Requirement row can be tagged as satisfying more than one framework at once (e.g. both an ISO 27001 control and a CSA CCM control) rather than needing a duplicate row per framework — the "author once, tag many" model ADR 0003 called for. The admin list view surfaces every Requirement's full tag set (framework(s), Deployment Facets, Regulatory Overlays, Impact Level thresholds) at a glance, to spot near-duplicates before creating a new row instead of tagging an existing one
- The `BUSINESS_RISK_OWNER` role (#55): a System now also self-declares which Business Unit(s) consume it and which Framework(s)' audit/certification boundary it's in scope for ("Framework Scope") — both purely reporting dimensions, editable at any lifecycle stage (not Draft-locked, unlike the four classification mechanisms above, since usage/audit scope can genuinely change after a System is live). A Business Risk Owner is assigned a portfolio of Business Unit(s) and/or Framework(s) (independent axes, admin-managed) and gets a scoped, read-only dashboard: a cross-System Risk queue and a compliance-percentage view (pooled per scope, not averaged; a Framework can require strict 100%-Fulfilled scoring via `strictComplianceRequired`) — see [ADR 0004](docs/adr/0004-framework-as-first-class-entity.md) for why `framework` was promoted from a free-text tag to a first-class catalog entity to support this

What's *not* decided yet (deliberately deferred, not overlooked):
- Real authentication (SSO/OIDC) — still the dev-only role switcher
- Multi-tenancy — currently single-tenant; the intent is to add tenant/org scoping later. This was deliberately *not* written up as an ADR, since single-tenancy is a stepping stone, not a permanent commitment — expect an `Organization`/tenant scope to eventually land on `System`, `User`, and the `Requirement` catalog
- Notifications on status changes — out of scope until now; the core workflow is proven, so this is a reasonable next thing to propose
- Retiring a `Requirement` from the catalog — Deployment Facet, Capability, Regulatory Overlay, Business Unit, and Framework can be retired, Requirement deliberately wasn't (see [issue #13](https://github.com/aspapunktse/requirement/issues/13)'s closing comment)

**Picking this up in a fresh session?** Read, in order: [`HANDOFF.md`](HANDOFF.md) (what's in flight and what to do next), this section, [`CONTEXT.md`](CONTEXT.md), [`docs/adr/`](docs/adr/). The original backlog, ADR 0003, the extension-points catalog, and #55 (Business Risk Owner) are all fully shipped/closed — two issues are open: #46 (Requirement content versioning + targeted notifications) and #54 (a real, role-differentiated landing page, replacing the current `src/app/page.tsx` placeholder), both fully scoped and ready to pick up whenever. [`docs/agents/`](docs/agents/) documents how the repo is configured for Matt Pocock's engineering skills (issue tracker conventions, domain-doc consumer rules) if you're using those.

## Stack

- **Next.js 16 (App Router) + TypeScript** — frontend & API routes
- **Prisma + PostgreSQL** — data layer
- **Vitest + Testing Library** — unit/integration tests
- **Docker** — local Postgres and production container image
- **GitHub Actions** — CI on every PR, CD on merge to `main`

## Domain model

Vocabulary and workflow rules live in [`CONTEXT.md`](CONTEXT.md), not here — that's the source of truth so it doesn't drift out of sync with a second copy. Architectural decisions (e.g. why `Approved` and `Onboarded` are separate states) are in [`docs/adr/`](docs/adr/). The Prisma schema implementing all of this is [`prisma/schema.prisma`](prisma/schema.prisma).

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

## CI/CD

- **`.github/workflows/ci.yml`** runs on every pull request and push to `main`: lint, typecheck, unit tests against a real Postgres service container, production build, and a Docker build check. All must pass before a PR can merge.
- **`.github/workflows/cd.yml`** runs after CI succeeds on `main`: builds and pushes the production image to GitHub Container Registry (`ghcr.io/<owner>/<repo>`), then runs a `deploy` job gated by the `production` GitHub Environment (use this to require manual approval and to add the real deploy step once a hosting target — Azure/AWS/Vercel/etc. — is chosen).

### Recommended repo settings

- Protect `main`: require the CI workflow to pass and require PR review before merge.
- Add a `production` GitHub Environment with required reviewers if deploys should be gated by human approval.
- Set repo secrets/variables for the eventual deploy step (cloud credentials) — do not commit them.

## Docker

```bash
docker compose up --build
```

Runs the production image against a local Postgres instance.

> **Known caveat**: `docker compose` was unavailable on the machine this was originally scaffolded on (Docker Desktop install without the compose plugin registered), so this file is written to spec but wasn't exercised end-to-end there. Verified separately: a plain `docker build .` succeeds, and a plain `docker run` Postgres container works with `prisma migrate dev` + `prisma db seed` against it. If `docker compose up` fails for you, that's the most likely first thing to check, not a schema/app problem.
