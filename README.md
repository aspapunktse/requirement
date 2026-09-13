# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Project status

**As of this writing: infrastructure and domain model are done; no application features are implemented yet.**

What exists:
- Next.js/Prisma/Postgres scaffold, CI/CD, Docker — all verified working (see Stack/CI-CD below)
- The domain model is settled — see [`CONTEXT.md`](CONTEXT.md) for the glossary (`System`, `Requirement`, `Requirement Assessment`, `Risk`, `Approval`, the Onboarding Lifecycle) and [`docs/adr/`](docs/adr/) for architectural decisions
- The feature backlog is broken into 7 GitHub issues, in dependency order, each a vertical slice (schema + API + UI + tests): see [open issues](https://github.com/aspapunktse/requirement/issues), labeled `ready-for-agent`. Issue #1 (dev-only auth stub) has no blockers and is the place to start.

What's *not* decided yet (deliberately deferred, not overlooked):
- Real authentication (SSO/OIDC) — issue #1 stubs a role switcher instead
- Multi-tenancy — currently single-tenant; the intent is to add tenant/org scoping later. This was deliberately *not* written up as an ADR, since single-tenancy is a stepping stone, not a permanent commitment — expect an `Organization`/tenant scope to eventually land on `System`, `User`, and the `Requirement` catalog
- Notifications on status changes — out of scope until the core workflow is built and proven

**Picking this up in a fresh session?** Read, in order: this section, [`CONTEXT.md`](CONTEXT.md), [`docs/adr/`](docs/adr/), then the [open GitHub issues](https://github.com/aspapunktse/requirement/issues) starting from the lowest unblocked number. [`docs/agents/`](docs/agents/) documents how the repo is configured for Matt Pocock's engineering skills (issue tracker conventions, domain-doc consumer rules) if you're using those.

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
