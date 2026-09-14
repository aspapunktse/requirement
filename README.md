# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Project status

**As of this writing: the full original backlog (16 issues) is implemented, tested, and merged — the core onboarding workflow and the ISO 27001 Annex A Requirement Catalog feature set both work end-to-end.** A follow-on design ([ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)) is in progress: Deployment Facets (this README's own "Deployment Facet-based scoping" line above) is shipped as of #47; Regulatory Overlays and CIA Impact Level remain open (#48–#53).

What exists and works:
- Next.js/Prisma/Postgres scaffold, CI/CD, Docker (see Stack/CI-CD below)
- Dev-only auth stub with a role switcher and server-enforced authorization for all 5 roles (`ADMIN`, `RISK_OWNER`, `SYSTEM_OWNER`, `REVIEWER`, `VIEWER`)
- The full onboarding lifecycle: create a System → assess it against the Requirement Catalog → log Risks → submit for review → a Reviewer's Approve/Reject decision (Rejected returns to Draft, not a dead end) → mark Onboarded
- The Requirement Catalog: the 93-control ISO 27001:2022 Annex A seed, Deployment Facet-based scoping (a System declares one or more facets — e.g. On-Prem, Cloud — and Hybrid is simply declaring more than one, not its own catalog entry; see [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)), the per-Requirement Self-Assessment Question (Yes auto-fulfills, No auto-opens a linked Risk, N/A is Admin/Risk-Owner-gated), and Capability declaration that auto-fulfills mapped Requirements and reverts them on removal (unless a human has since touched the Assessment)
- Changing a Draft System's declared Deployment Facets recomputes its applicable Requirement set (the union of what each declared facet requires) without discarding work already done
- Admin CRUD (including retire) for the Deployment Facet and Capability catalogs

What's *not* decided yet (deliberately deferred, not overlooked):
- Real authentication (SSO/OIDC) — still the dev-only role switcher
- Multi-tenancy — currently single-tenant; the intent is to add tenant/org scoping later. This was deliberately *not* written up as an ADR, since single-tenancy is a stepping stone, not a permanent commitment — expect an `Organization`/tenant scope to eventually land on `System`, `User`, and the `Requirement` catalog
- Notifications on status changes — out of scope until now; the core workflow is proven, so this is a reasonable next thing to propose
- Retiring a `Requirement` from the catalog — Deployment Facet and Capability can be retired, Requirement deliberately wasn't (see [issue #13](https://github.com/aspapunktse/requirement/issues/13)'s closing comment)
- Regulatory Overlays and CIA Impact Level (GDPR/export-control flags, Confidentiality/Integrity/Availability-driven Requirements) — the rest of [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)'s design, tracked as issues #48–#53

**Picking this up in a fresh session?** Read, in order: this section, [`CONTEXT.md`](CONTEXT.md), [`docs/adr/`](docs/adr/). There's no open-issues queue to work through right now — new work starts from a feature proposal, not a pre-written ticket. [`docs/agents/`](docs/agents/) documents how the repo is configured for Matt Pocock's engineering skills (issue tracker conventions, domain-doc consumer rules) if you're using those.

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
