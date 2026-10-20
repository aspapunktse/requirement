# Requirement & Risk Onboarding

Internal webapp for tracking requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise.

## Direction: becoming a GRC tool

The app is being developed into a governance, risk and compliance (GRC) tool. The first module is a **requirement database**: Frameworks (ISO 27001:2022 as the base, plus Cybersäkerhetslagen, CSA CCM 4, …), each made up of its own Requirements, all mapped onto one Control Library. Controls are inherited from the Organization or from Provider Systems, compliance is continuous rather than frozen at onboarding, and internal audit can verify Controls through Check-ups. The steering document is [PRD 0001](docs/prd/0001-grc-requirement-database.md), with decisions in [ADRs 0005–0008](docs/adr/).

## Project status

PRD 0001 is delivered in five milestones. Three are in production, milestone 5 is built, and milestone 4 is in progress.

| Milestone | Status |
| --- | --- |
| 1. Model split | In production |
| 2. Applicability & continuous compliance | In production |
| 3. Inheritance | In production |
| 4. Content & SoA | In progress: the Statement of Applicability view (#145) with its exclusion justifications (#150), the Framework import loader (#144), Framework version lineage (#146), CSV export (#151), and the CSA CCM 4.1.1 (#149), CMMC Level 1 (#209), CMMC Level 2 (#210), DEF STAN 05-138 Issue 4 Level 0–3 (#211) and Cyber Essentials 3.3 (#212) content files are built; issue #148 remains |
| 5. Internal audit | Built: the Internal Auditor role (#147), draft Internal Audits (#152) with Systems by filter (#153), questions and launch (#154), answering a Check-up (#155), evaluating one (#156), a Nonconformity's side effects (#157), and withdrawing Check-ups and closing an audit (#158) |

The queue and what to do next are in [`HANDOFF.md`](HANDOFF.md). The per-issue record of how everything up to milestone 3 was built (routes, migrations, rules, test files) is in [`docs/implementation-history.md`](docs/implementation-history.md).

### What works today

- **Onboarding lifecycle:** create a System, assess it against the Control Library, log Risks, submit for review (each submission is a Review Round), each Review Step is decided in parallel (a Reviewer the base step, any member of a Review Group that group's step, an Admin any; never the System's owner), the System is Approved once every step has approved and one rejection returns it to Draft, then mark Onboarded. A System In Review shows the round's Review Steps (the base step plus one per Review Group with a Control in its remit, derived live from the Framework Scope; a step that disappears and returns in the same round comes back open, and an approved step reopens, with when and why shown, if a person edits an Assessment of a Control in its remit) and the approval history grouped by round. Decisions show as the group ("GDPR Review Group: Rejected"); only an Admin, Internal Auditor, Compliance Manager and the step's own deciders see who decided. Open steps appear in the deciders' My tasks.
- **Roles:** a dev-only auth stub with a role switcher and server-enforced authorization for eight roles: Admin, Risk Owner, System Owner, Reviewer, Viewer, Business Risk Owner, Compliance Manager and Internal Auditor. Seeing a System never implies writing to it; owner actions belong to the System's owner or an Admin. The Internal Auditor reads everything and writes nothing, even as a System's or Control's recorded owner.
- **Requirement database:** Frameworks (versioned, Draft or Published) own their Requirements, which are linked to Controls by Control Mappings with Full or Partial Coverage. ISO/IEC 27001:2022 is the base Framework, with Annex A and clauses 4–10.
- **Framework import:** `npm run frameworks:load` loads Framework files (Requirements, Control Mappings, Supplementary Controls) as a Draft, idempotently; a Published Framework is only touched with `--allow-published`. The format is in [`prisma/seed-data/frameworks/README.md`](prisma/seed-data/frameworks/README.md).
- **Framework authoring and coverage:** a Compliance Manager authors Requirements and mappings and publishes a Framework. The Framework Coverage view shows covered Requirements, Coverage Gaps and accepted gaps, and a Supplementary Control can be created straight from a gap. Its Download CSV exports the whole view. Both Framework lists show each Framework's version lineage; a Draft is hidden from users who can't see Drafts.
- **Control Library:** 118 Controls with Deployment Facet and Impact Level scoping, a Self-Assessment Question each (Yes fulfils, No opens a linked Risk, N/A is gated) and a Control Owner. Compliance Managers and Admins edit it; every role reads it (a Draft Framework stays hidden from roles that can't see Drafts).
- **Applicability:** a Control applies to a System when it is mapped to a Published Framework in the System's Framework Scope and passes the Control's Deployment Facet and Impact Level scoping.
- **Continuous compliance:** classification, Framework Scope and Provider dependencies can change at any lifecycle stage. Those changes, and catalog changes (a Framework published, a mapping or a Control's scoping edited), recompute the System's Control Assessments without touching its onboarding status. Assessments someone worked on are kept as stale and can be removed.
- **Inheritance:** the Organization records its own implementation of each Organizational and Both Control. A System can be a Provider with Full or Shared Control Offerings, and other Systems depend on it. A Control's effective status is resolved live from the System's own Assessment and its sources, never copied, and an Assessment can be reset to inherited.
- **Compliance figures:** each Requirement's status per System (Met, Partially Met, Not Met, Not Applicable) is derived from the effective status of its mapped Controls. The Compliance Percentage is Met ÷ applicable Requirements for one Framework, pooled across Systems.
- **Internal Audits:** an Internal Auditor plans a draft audit (target Controls, Systems picked by hand or by filter, whether the Organization is included, a due date), writes each Control's questions and launches it. Launching generates one Check-up per applicable System and Control, plus one per Organizational or Both Control when the Organization is included, and freezes the audit. A Check-up appears in its recipient's "My tasks" (the System's owner, or the Control Owner), marked overdue after the due date; the recipient answers each question Yes / No / N/A with a description and evidence links, which changes no status. An Internal Auditor evaluates each answered Check-up as Conforming, Observation or Nonconformity with a comment; the evaluation is final, freezes the response, is readable by the recipient and writes one System-less Change Event. A Nonconformity also opens a Risk linked to the Check-up (on the System, or one Organization Risk with no System, which Risk Owners and Admins manage and the Internal Auditor reads) and sets a Fulfilled target back to In Progress as `"system"` (a System that is Fulfilled only through inheritance gets its own In Progress override), reaching inheriting Systems live. An Internal Auditor can withdraw a Check-up that isn't evaluated, with a reason (final; it leaves the recipient's tasks and can't be answered or evaluated, but keeps any response), and close a launched audit once every Check-up is evaluated or withdrawn; closing is refused while any is open, naming which. A closed audit and everything in it is read-only for every role. The audit list shows Draft / Launched / Closed, and the audit page shows progress (sent, answered, evaluated, withdrawn, overdue), each response, outcome and withdrawal. Only an Internal Auditor writes, evaluates, withdraws or closes; Admin, Compliance Manager and Risk Owner can read audits.
- **Statement of Applicability:** a page every role reads, listing every Control with whether it is included (applies to the Organization or to at least one System, derived live, never stored), a justification generated from its Published Framework mappings, and its implementation status (the Organization's, or a rollup of effective status across Systems). A Compliance Manager or an Admin writes, edits and clears the exclusion justification of an excluded Control inline (a Change Event per change); excluded Controls without one are flagged "justification missing" and counted. Download CSV exports every Control.
- **Views:** a role-differentiated `/home` with "My tasks", the System page (Controls with effective status and source, Requirements by Framework), the Business Risk Owner's scoped dashboard and System Portfolio, and the Organization Control Implementations page.
- **Assessment Queries:** non-blocking question threads on one Control Assessment.
- **Change Events:** a curated log of compliance-relevant changes. Nothing shows it in the UI yet.
- **Admin catalogs:** Deployment Facets, Business Units, Frameworks, users and Business Risk Owner assignments.
- **Review Groups:** an Admin creates named groups of Users (any role but Internal Auditor) and manages their members; an Admin or Compliance Manager ties a group to non-base Frameworks (a Framework has at most one group), and a tied group with no members is flagged. A tied group adds a Review Step to Systems In Review that have one of its Frameworks in scope, and its members can decide that step, see every System (any status) with one of its Frameworks in scope, and raise and resolve Assessment Queries on Controls in its remit; their Query Messages show as the group ("Base review" for a Reviewer), by the same rule as step decisions.
- **Design proposals:** browsable at `/design`, with interactive alternatives for onboarding, the Systems list, System detail, the Control Library, an Enterprise Control Library alternative, the Statement of Applicability, Home by role and creating an Internal Audit, and anonymous thumbs-up voting per proposal.
- **Pipeline:** CI on every pull request, and CD to Vercel production gated on green CI (see CI/CD below).

### Not built yet

- **Milestone 4:** the Cybersäkerhetslagen content.
- **The GDPR and Export Control (EAR/ITAR) Frameworks** are Published but have no Requirements.
- **Other open issues:** #46 (Control content versioning and notifications; needs re-scoping against the PRD), #61 (a per-System audit trail; deferred) and #63 (a lint cleanup of effect-based data fetching).

### Deliberately deferred

- **Real authentication (SSO/OIDC).** Still the dev-only role switcher. It is a go-live gate (PRD 0001 §11).
- **Multi-tenancy.** The app is single-tenant, and tenant scoping is meant to come later.
- **Notifications.** The app relies on "My tasks".
- **Retiring a Control** from the Control Library (see [issue #13](https://github.com/aspapunktse/requirement/issues/13)'s closing comment).

**Picking this up in a fresh session?** Read, in order: [`HANDOFF.md`](HANDOFF.md), this section, [`CONTEXT.md`](CONTEXT.md), [PRD 0001](docs/prd/0001-grc-requirement-database.md) and [`docs/adr/`](docs/adr/). [`docs/agents/`](docs/agents/) documents how work is run on this repo.

## Stack

- **Node.js 24** — the version production (Vercel) runs. It is set once in `package.json` (`"engines": { "node": "24.x" }`); CI and the CD deploy job read it from there (`node-version-file: package.json`), and the `Dockerfile` mirrors it (`node:24-alpine`), so keep the two in step
- **Next.js 16 (App Router) + TypeScript** — frontend & API routes
- **Prisma + PostgreSQL** — data layer
- **Vitest + Testing Library** — unit/integration tests
- **Docker** — local Postgres and production container image
- **GitHub Actions** — CI on every PR, CD on merge to `main`; jobs run on `ubuntu-latest` and the actions are pinned to major tags that run on Node 24

## Domain model

Vocabulary and workflow rules live in [`CONTEXT.md`](CONTEXT.md), not here — that's the source of truth so it doesn't drift out of sync with a second copy. It describes the GRC model from [PRD 0001](docs/prd/0001-grc-requirement-database.md), including the parts not built yet (see "Project status" above). Architectural decisions (e.g. why `Approved` and `Onboarded` are separate states) are in [`docs/adr/`](docs/adr/). The Prisma schema implementing all of this is [`prisma/schema.prisma`](prisma/schema.prisma).

## Getting started

You need Node.js 24 (see `engines` in `package.json`), Docker (for the local Postgres) and npm.

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
| `npm run frameworks:load -- [--allow-published] [file.json …]` | Load Framework import files as Draft Frameworks (all of `prisma/seed-data/frameworks/` with no file) |
| `npm run prisma:seed:prod` | Run the seed script against `.env.production.local` (see below) |
| `npm run implementer:create -- <issue> <slug>` | Create an implementer's git worktree and its own copy of the dev DB (see [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md)) |
| `npm run implementer:destroy -- <issue> <slug>` | Remove that worktree and branch and drop its databases |

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

- **Node version:** CI, the CD deploy job and the Docker image all run Node 24, the same as production. The workflows read it from `engines.node` in `package.json`; the `Dockerfile` can't, so it carries a matching `node:24-alpine`.
- **`.github/workflows/ci.yml`** runs on every pull request and push to `main`: lint, typecheck, unit tests against a real Postgres service container, production build, and a Docker build check. `react-hooks/set-state-in-effect` is currently downgraded to `warn` in `eslint.config.mjs` (8 existing components fetch in effects) so lint can pass — tracked in #63. Nothing in GitHub *enforces* CI on merge (see below), so the CD gate is what actually protects production.
- **`.github/workflows/cd.yml`** runs after CI succeeds on `main`: builds and pushes the production image to GitHub Container Registry (`ghcr.io/<owner>/<repo>`), then a `deploy` job (gated by the `production` GitHub Environment) deploys that commit to Vercel with the Vercel CLI (`vercel deploy --prod`; Vercel builds remotely, so its project env vars like `DATABASE_URL` stay in Vercel). Vercel's own Git auto-deploy is disabled for `main` in `vercel.json` so production only ships from a green commit; other branches still get Vercel preview deployments. **Migrations run only in production:** the Vercel project's build command is `if [ "$VERCEL_ENV" = "production" ]; then npx prisma migrate deploy; fi && npm run build`, and `DATABASE_URL` is set for the Production environment only. So a preview builds without touching any database, and its pages have no database at runtime. (The workflow doc has the history of why.) The Neon Vercel integration still creates a `preview/<git-branch>` Neon branch per preview. Neon's free plan caps a project at 10 branches and doesn't delete merged ones, so clear old `preview/*` branches in the Neon console from time to time. When the cap is hit, new previews fail with "Resource provisioning failed". Requires a `VERCEL_TOKEN` secret (the org/project IDs are in the workflow file).

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
