# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Stack

- **Next.js 16 (App Router) + TypeScript** — frontend & API routes
- **Prisma + PostgreSQL** — data layer
- **Vitest + Testing Library** — unit/integration tests
- **Docker** — local Postgres and production container image
- **GitHub Actions** — CI on every PR, CD on merge to `main`

## Domain model

- **System** — a system or cloud solution being onboarded, with an owner and an onboarding status (draft → in review → approved/rejected → onboarded).
- **Requirement** — a reusable requirement definition (security, privacy, legal, operational), tagged to a framework (e.g. ISO 27001) where relevant.
- **RequirementAssessment** — fulfillment status of one Requirement for one System, with evidence and notes.
- **Risk** — a risk identified during onboarding of a System, with severity, likelihood, status, and mitigation plan.
- **Approval** — a formal sign-off record on a System's onboarding decision.

See [`prisma/schema.prisma`](prisma/schema.prisma) for the full schema.

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
