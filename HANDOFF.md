# Handoff

Read this first in a fresh session. Then read:
1. [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md), for **how** work is run: you are the supervisor, and Sonnet sub-agents implement;
2. [`README.md`](README.md)'s Project status section;
3. [`CONTEXT.md`](CONTEXT.md);
4. [PRD 0001](docs/prd/0001-grc-requirement-database.md);
5. [`docs/adr/`](docs/adr/) (at least 0003 and 0005–0008).

This file holds current state and the queue, and nothing else. The rule is in the workflow doc under "What goes in `HANDOFF.md`": what an issue built, its migration evidence, test numbers and judgement calls are in its PR description, and product-owner decisions are on the issue. The "Done" list below gives the PR for each issue.

## Next up: the queue (start here)

**Where the last session stopped (2026-10-14). Do this first.**
1. **PRD 0001 · M5 Internal audit is complete** with #158 (PR #177). Close the GitHub milestone once #158 is closed.
2. **M4:** #149 is done (PR #178). The product owner loaded CSA CCM 4.1.1 into production as a Draft on 2026-10-14; CD and the seed don't run the loader, so a later content file needs the same manual load. #148 waits on the product owner (`ready-for-human`) until the source documents are attached. Nothing else in PRD 0001 is cut into issues.
3. **Design:** #181 moved the app to the Register design system (PR #182). Follow-ups: list components to RegisterRow, filter panels to FilterFields, the header tab row. New code uses the `--rg-*` tokens and `rg-*` Tailwind colours, not `--ems-*`.
   Design proposals are listed at `/design` with thumbs-up voting (#186). Each new proposal adds its entry to `public/design/proposals.js` (rule in `AGENTS.md`).
4. **Framework Review Groups (2026-10-18):** grilled with the product owner; the design is in `CONTEXT.md` (Review Group, Review Step, Review Round) and [ADR 0010](docs/adr/0010-onboarding-review-runs-as-parallel-review-steps.md), and cut into #197–#201 (queue below). #197 is done (PR #204), #198 is done (PR #205); next is #199.
5. Nothing is in flight. The dev DB is in its seeded state (see below).

**The queue**

PRD 0001 · M4 Content & SoA:
1. #144 Framework import format and idempotent loader. **Done: PR #163.**
2. #145 Statement of Applicability view. **Done: PR #162.**
3. #146 Framework version lineage in the Framework list. **Done: PR #164.**
4. #150 Statement of Applicability: exclusion justifications. **Done: PR #165.**
5. #151 CSV export of the Framework Coverage view and the Statement of Applicability. **Done: PR #167.**
6. #148 Cybersäkerhetslagen content as a Framework import file. Blocked by #144. **`ready-for-human`**: the product owner attaches the source documents first, then relabels it `ready-for-agent`.
7. #149 CSA CCM 4.1.1 content as a Framework import file. **Done: PR #178.**

PRD 0001 · M5 Internal audit:
1. #147 Add the Internal Auditor role. **Done: PR #168.**
2. #152 Create a draft Internal Audit. **Done: PR #171.**
3. #153 Select an Internal Audit's Systems by filter. **Done: PR #173.**
4. #154 Check-up questions and launching an Internal Audit. **Done: PR #172.**
5. #155 Answer a Check-up from My tasks. **Done: PR #174.**
6. #156 Evaluate a Check-up. **Done: PR #175.**
7. #157 Nonconformity side effects: Risk and status set-back. **Done: PR #176.**
8. #158 Withdraw Check-ups and close an Internal Audit. **Done: PR #177.**
9. #169 Read-only Control Library page for every role. **Done: PR #170.**

Framework Review Groups (ADR 0010, no milestone):
1. #197 Review Groups: groups, members and Framework ties. **Done: PR #204.**
2. #198 Review Rounds and Review Steps derived from Framework Scope. **Done: PR #205.**
3. #199 Decide Review Steps in parallel, attributed to the group. Blocked by #198.
4. #200 Reopen an approved Review Step when the owner edits its remit. Blocked by #199.
5. #201 Review Group members: System visibility and Assessment Queries. Blocked by #197, #199.
Future work, not an issue: a standalone Framework review of an Onboarded System when a Framework is added to its scope (ADR 0010), and linking a Review Group to an Entra ID group.

Not cut into issues: the PRD's two "could" features, F-OUT.6 (PDF export of the SoA) and F-IMP.4 (UI upload of Framework files, other Frameworks as data).

**State as of 2026-10-14**
- PRD 0001 milestones 1, 2 and 3 are complete, closed and in production. Milestone 5 is complete with #158. Milestone 4 has #148 left.
- Production has every migration up to `20261018110000_add_review_rounds` (43 in all) once PR #205 is deployed.
- Other open issues:
  - #46 needs re-scoping against the PRD before anyone picks it up.
  - #61 is deferred.
  - #63 is independent lint cleanup.

### Open follow-ups (none is an issue yet)

- **Audit the older interactive transactions.** The frameworks, controls and mappings routes and `assessment-queries.ts` have not been checked for queries on the global Prisma client inside a transaction (the gotcha in the workflow doc; it failed PR #134's first CI run). The test run uses a pool of 3, so a path that a test exercises concurrently would show it.
- **Bulk loaders that can throw under a concurrent catalog edit.** A `findMany` that nests a required relation (Control → mappings → requirement) runs as several statements, and a Requirement deleted between them makes Prisma throw "Inconsistent query result". The Statement of Applicability loader was fixed in #150 (one REPEATABLE READ snapshot). The same shape is in `requirement-status.ts`, `effective-status-data.ts`, `organization-inheritance.ts`, `provider-inheritance.ts`, `control-assessments.ts` and `frameworks.ts`; none has been seen to fail.
- **A target Control of a launched Internal Audit that produced no Check-up can still be deleted** (it applied to none of the picked Systems), and then leaves the audit's Control list. Controls and Systems that have Check-ups can't be deleted. The product owner accepted the gap for now on 2026-10-13 (comment on #154); closing it means refusing to delete any Control that is a target of an audit.
- **A catalog recompute writes no Change Events on a Provider's dependents.** When a Framework publish, a Control Mapping change or a Control scoping edit makes an offered Control stop or start applying to a Provider, the dependents' effective status moves live and nothing is logged on them. The product owner accepted this for now on 2026-10-02 (comment on #124).
- **Nothing renders Change Events yet** (the "Recent updates" feed was never built). Whoever builds it must give every `ChangeEventAction` a label, including the ones added since without one (`APPLICABILITY_RECOMPUTED`, `ASSESSMENT_REMOVED`, `ORGANIZATION_IMPLEMENTATION_CHANGED`, `CONTROL_OFFERING_CHANGED`), and decide how to show System-less events next to per-System ones.
- **Small polish seen in the browser:** on a Control with a Shared Offering, the Assessment form keeps saying "Set the status below to Fulfilled once this System has done it." after the System's own half is Fulfilled.
- **CSA CCM 4.1.1 leaves 94 Coverage Gaps** (9 unmapped, 85 Partial only) and adds six `CCM-SUP-*` Supplementary Controls for both cloud facets. Resolving the gaps and publishing is the Compliance Manager's work in the UI. CSA's licence allows only non-commercial use of the CCM; whether that covers this product is the product owner's call (noted on PR #178).
- **The GDPR and Export Control (EAR/ITAR) Frameworks are empty.** A curator should give them Requirements, map Controls to them and decide their licensing (follow-up from PR #102).
- **`.dockerignore` doesn't exclude `.env.production.local`**, so a local `docker build` copies the production credentials into the build stage. The final image has no env files and CI never has that file, so the pushed image isn't affected. Found during #115; not fixed.
- **The Vercel project has a `VERCEL_TOKEN` environment variable** set for Production and for Preview. The app doesn't read it (CD uses the GitHub secret of the same name), and on Preview it is available to every preview build. Removing it is the product owner's call.

### Done (one line each)

**PRD 0001 · M3 Inheritance**, closed 2026-10-04, in the order worked:
1. #119 Control Owner: PR #127.
2. #120 Organization Control Implementation: PR #128.
3. #121 effective status, Systems inherit Both Controls from the Organization: PR #130.
4. #122 count Organizational Requirements per System: PR #131.
5. #129 reset a Control Assessment to inherited: PR #132.
6. #123 Providers and Control Offerings: PR #133.
7. #124 Provider dependencies and live Full inheritance: PR #134.
8. #125 Shared inheritance and customer responsibility: PR #135.
9. #126 retire Capability, migrating each to a Provider System: PR #136.

Also in M3: #115 (CI, the CD deploy job and the Docker image on Node 24), PR #118. #116 and #117 were closed as superseded by #126.

**PRD 0001 · M2 Applicability & continuous compliance**, closed 2026-10-01, in the order worked:
1. #85 Framework Scope drives applicability: PR #99.
2. #86 continuous compliance, the Draft-only lock lifted: PR #100.
3. #87 recompute on catalog changes: PR #101.
4. #88 retire Regulatory Overlay: PR #102.
5. #89 derived Requirement status per System: PR #104.
6. #90 Requirement-based Compliance Percentage: PR #105.

Before M2: #91, unify the owner rule and restrict System creation (PR #96). Follow-ups to M2: #97 (PR #107), #98 (PR #108), #95 (PR #111), #109 (PR #112), #110 (PR #113; its code was removed again by #126), and PR #106 (Vercel records production deploys as `main`).

**PRD 0001 · M1 Model split:** #70 (PR #77), #71 (PR #79), #72 (PR #80), #73 (PR #81), #74 (PR #82), #75 (PR #83). Then #78, System write permissions (PR #84).

**Before PRD 0001:** the original 16-issue backlog, ADR 0003 (#47–#53), #54–#59, #62, #64, #65, #68 and the extension-points catalog (#31–#45). Most of these had no PR; each issue's comments hold its resolved design and what was checked.

## Dev DB seeded state

The dev DB is in its seeded state. When cleaning up after a browser check, compare with these counts.

- 11 Systems (one is the Provider "Entra ID SSO"), 11 Users (the seed adds the Internal Auditor; run `npx prisma db seed` after pulling #147), 118 Controls, 527 Control Assessments, 2 Change Events, 4 Control Offerings, 2 Provider dependencies, and 92 Organization Control Implementations, all Not Started. No Control Owners.
- The two Change Events are seeded state (the `"system"` events on GitHub and Microsoft 365 from the Capability migration): do not delete them.
- 43 rows in `_prisma_migrations`.
- 7 Approvals and 9 Review Rounds (one per Approval, plus an open one for each of the 2 Systems In Review).
- Controls by applicability: 61 Organizational, 31 Both, 26 Per-System. All mandatory.
- Frameworks: ISO/IEC 27001:2022, which is the base and Published. GDPR 1 and Export Control (EAR/ITAR) 1 are Published but have no Requirements yet. The seed doesn't load `prisma/seed-data/frameworks/`, so CSA CCM 4.1.1 is absent until `npm run frameworks:load` is run.
- ISO/IEC 27001:2022 figures: Jira 56 of 117 (47.9%), CATIA 9 of 117, Unily 6 of 117 ("needs assessment" 44 and 47), the Provider "Entra ID SSO" 4 of 117 ("needs assessment" 52), pooled 467 of 1288 (36.3%).

## Conventions and gotchas

Conventions and gotchas that outlive an issue are in [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md): the brief template has the rules for migrations, tests and encoding, and "Known environment gotchas" has the rest. Add new ones there, not here.

- **Domain vocabulary:** `CONTEXT.md` is the glossary of record. Use its exact terms in code, tests, commits and issues, and avoid the synonyms each entry's `_Avoid_` line names.
- **Issue tracker:** GitHub Issues through the `gh` CLI; conventions are in `docs/agents/issue-tracker.md`.
- **README currency** (an `AGENTS.md` rule): update `README.md`'s Project status in the same change whenever what it describes changes.
