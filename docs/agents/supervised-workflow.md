# Supervised sub-agent workflow

How implementation work on this repo is run. The product owner set this up on 2026-09-29, and PRD 0001's milestone 1 and #78 were delivered this way.

## Roles

- **Supervisor**: the main Claude Code session (the most capable model available, currently Opus). It doesn't write feature code itself. Its jobs are to:
  - pick the next issue;
  - brief a sub-agent;
  - review what comes back;
  - verify in the browser;
  - open the PR, wait for CI, merge, and watch the production deploy;
  - keep `HANDOFF.md` current;
  - bring policy questions to the product owner.

  Small mechanical fixes found in review may be made directly. Examples: a stray non-UTF-8 byte, a one-line doc correction, a follow-up comment on an issue. Anything bigger goes back to the sub-agent that did the work.
- **Implementer**: one sub-agent per issue, launched with the Agent tool as `subagent_type: "general-purpose"`, **`model: "sonnet"`**, `run_in_background: true`. It implements, tests and commits on a branch. It **never** pushes, opens a PR, merges or closes the issue.
- **Product owner**: the user. Decides policy and product questions. When a sub-agent flags something debatable, the supervisor asks the user (AskUserQuestion) and doesn't decide it silently. Decisions are recorded on the relevant issue as a comment.

## Order of work

- Work issues in dependency order. Dependencies are GitHub's native "blocked by" links on each issue, and the "Next up" list in `HANDOFF.md` gives the current queue.
- Up to two issues may be in progress at once, each with its own implementer, worktree and database. See "Parallel implementers" below for which issues qualify. Review, merge and the production watch stay one at a time.
- When the product owner asks for a milestone to be "cut into issues":
  1. Read the PRD section and the relevant code (read-only).
  2. Draft vertical, independently shippable issues. Each gets: a "Part of PRD 0001 · Mx" line, **Why**, **Scope**, **Acceptance criteria**, "Blocked by: #n", and the CI-not-seeded test rule.
  3. Create a GitHub milestone named `PRD 0001 · Mx <name>`.
  4. Create the issues with labels `enhancement` and `ready-for-agent`.
  5. Add native dependencies: `gh api --method POST repos/aspapunktse/requirement/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`.
  6. Close the GitHub milestone once all of its issues are closed.

## Parallel implementers: one worktree and one database each

Every implementer works in its own git worktree against its own Postgres database, also when only one is running. The main checkout `C:\dev\requirement` stays on `main` and belongs to the supervisor. The dev DB `requirement` only ever receives migrations that have been merged to `main`, and no implementer connects to it.

### Which issues may run together

- At most **two** implementers at a time. The supervisor's review is the bottleneck, and the full test suite flakes under load.
- No "blocked by" link between the issues, direct or through another open issue.
- At most **one** in-flight issue carries a migration. Two branches each name their migration to sort after the latest one on `main` and can't see each other's.
- The issues don't rework the same files. Compare their Scope sections before briefing; two issues that restructure the same module run in sequence.
- When in doubt, run them in sequence.

### Set up (supervisor, before briefing)

For issue `<n>` on branch `<n>-<slug>`, run `npm run implementer:create -- <n> <slug>` in the main checkout (`scripts/implementer-env.ts`). It takes about ten minutes, nearly all of it `npm ci`, and prints the worktree path, branch and database name. It refuses to start if the checkout is not on `main`, if a migration is pending, or if the worktree, branch or database already exists. Check the seeded row counts yourself first; the script does not.

What it does, which can also be done by hand:

1. **Check the dev DB** is at `main`'s state: in the main checkout, `git pull` and `npx prisma migrate status` reports nothing pending, and the row counts match the seeded state in `HANDOFF.md`.
2. **Worktree:** `git worktree add ../requirement-wt/<n>-<slug> -b <n>-<slug> origin/main`. Worktrees live in `C:\dev\requirement-wt\`, outside OneDrive like the main checkout.
3. **Database**, a copy of the dev DB: `docker exec requirement-db sh -c "createdb -U app requirement_<n> && pg_dump -U app requirement | psql -U app -q -d requirement_<n>"`.
4. **`.env`** in the worktree: the main checkout's `.env` with the database name changed to `requirement_<n>`. Never copy `.env.production.local` into a worktree.
5. **Dependencies:** `npm ci` in the worktree, which also runs `prisma generate`. Each worktree has its own `node_modules` and `.next`, so a dev server running elsewhere no longer locks Prisma's query engine for the implementer.

Give the implementer the worktree path and the database name in the brief.

### While implementers run

- An implementer stays inside its worktree and its own databases. Scratch DBs for drift and fresh-path proofs are named `requirement_<n>_<purpose>`, so two implementers never pick the same name.
- An implementer may drop and recreate `requirement_<n>` whenever it likes. "Never reset the dev DB" still holds, and now also means "never connect to it".
- The supervisor doesn't edit files in a worktree whose implementer is running. Follow-ups go to that implementer as messages.
- The supervisor may `git pull` in the main checkout at any time; no implementer has work there.

### Review and verify

- Review in the worktree: `git -C ../requirement-wt/<n>-<slug> log`, `diff --stat main...HEAD`, `status`.
- The browser check runs **from the worktree, against `requirement_<n>`**: a launch configuration whose command is `npm --prefix C:/dev/requirement-wt/<n>-<slug> run dev`. Run one dev server at a time, on port 3000, and stop the main checkout's first.
- Test data made during the check doesn't need cleaning up, because the database is dropped at tear-down. The dev DB stays in its seeded state.

### Merge, one at a time

- Merges stay serial, and the next one waits for the previous merge's CD run (step 6 of the loop).
- After each merge, in the main checkout: `git pull`, stop the dev server, `npm ci` if the lockfile changed, `npx prisma migrate deploy`. This is the only way a migration reaches the dev DB.
- Then bring the other in-flight branch up to date. Tell its implementer to `git merge origin/main`, run `npx prisma migrate deploy` against its database, resolve conflicts (`README.md`'s Project status is the usual one) and re-run the tests it touched.
- If the "one migration in flight" rule was broken and the second branch also carries a migration: rename its migration directory to sort after the one just merged, recreate `requirement_<n>` from the dev DB, and repeat the drift and fresh-path proofs.

### Tear down (after the merge)

Run `npm run implementer:destroy -- <n> <slug>` in the main checkout. It does the following:

- `git worktree remove ../requirement-wt/<n>-<slug>` and `git branch -D <n>-<slug>` (a squash merge leaves the branch unmerged in git's eyes). It stops if the worktree has uncommitted changes; add `--force` to discard them.
- `dropdb` for `requirement_<n>` and every `requirement_<n>_*` scratch DB. `docker exec requirement-db psql -U app -l` lists what's left.

## Per-issue loop

1. **Prepare.**
   - `git pull` in the main checkout, which is always on `main`.
   - Set up the issue's worktree and database (see "Set up" above).
   - Read the issue and the code it names, so the brief can carry facts, not guesses.
   - Read-only checks that decide policy (e.g. "do any rows hit this edge case?") are worth running yourself before briefing, so the product owner is asked only when it matters.
2. **Brief the implementer.** It starts cold, so the brief must be self-contained. Use the template below.
3. **Review the hand-back.**
   - Read the report critically. In the issue's worktree, check `git log`, `git diff --stat main...HEAD` and `git status`.
   - **Read any migration SQL in full.**
   - Check `npx prisma migrate status`.
   - Grep for leftovers the issue said to remove.
   - Check every changed file is valid UTF-8 (`iconv -f utf-8 -t utf-8 <file> >/dev/null`).
   - Send follow-ups to the **same** agent (SendMessage with its id), which keeps its context. Once a branch is pushed, fixes must be new commits, not amends.
   - Bring the branch up to date with `main` (`git merge main`) before verifying, so you test what will actually land.
4. **Verify in the browser.**
   - Stop any running dev server, then start one from the issue's worktree (see "Review and verify" above). It uses the issue's database, not the dev DB.
   - Hit a route once before screenshotting it. Turbopack compiles each route on its first request, so the page may briefly show "Compiling…".
   - Sign in as the relevant role with the header role switcher.
   - Exercise the change and read the console and network logs. HMR websocket errors from the preview pane are noise.
   - Prefer creating your own test data **through the app's API** (`fetch` from the page with the acting-user cookie set), e.g. a `Test #<n> …` System owned by the role you need. Changing seeded rows directly in SQL (e.g. reassigning a seeded System's owner) is blocked by the permission classifier; don't work around it.
   - Test data you create lives in the issue's database and goes when that is dropped. Nothing needs cleaning up in the dev DB, because the check never touches it.
   - Restart the dev server after any migration, because it caches the old Prisma client.
   - **Recipe for inheritance features** (used for #121, #122, #129, #123 and #124). Never change a seeded Control's Organization Control Implementation or a seeded System: it moves the seeded figures and writes Change Events on seeded Systems. Build throwaway data through the API instead, with `fetch` from the page:
     1. as the Compliance Manager: a `Test #<n> Framework` (`POST /api/frameworks`), one Requirement, a `TEST-<n>-…` Control (`POST /api/controls`), a Full mapping, then publish;
     2. as a System Owner: a `Test #<n> System` (`POST /api/systems` with one Deployment Facet) and the Framework in its scope (`POST /api/systems/[id]/framework-scopes`). The Control then applies to that System only.
     3. Clean up with `npx tsx prisma/cleanup-test-fixtures.ts`, **twice** (the first run skips the Control while the System still references it), and delete the System-less Change Events the setup wrote (`CONTROL_MAPPING_CHANGED`, `FRAMEWORK_PUBLISHED`) with SQL filtered on the test names. Then compare row counts with the seeded state in `HANDOFF.md`.
   - The acting-user cookie is HttpOnly, so `document.cookie` can't set it. Switch users from a script with `POST /api/session/acting-user` and body `{ userId }`, and check the status of each call: a script that goes on after a 403 fails later with a confusing error.
   - To onboard a test System through the API (needed for a Provider, #124): set every Not Started mandatory Control to In Progress as the owner, `POST .../submit`, `POST .../approvals` as the Reviewer with `{ decision: "APPROVED", comment }`, then `POST .../onboard` as the owner.
   - The System page loads its Control list after the first paint. Wait until "Loading Controls…" is gone before looking for a button in it.
   - A script run with the browser's JavaScript tool loses its return value if it navigates at the end, so set up the data in one call and navigate in the next. Stub `window.confirm` (capture the message, return true) before clicking an action that confirms. The first request to a route compiles it and can take several seconds, so wait before judging a save.
5. **PR and merge.**
   - `git push -u origin <branch>`.
   - `gh pr create` with a body of: Closes #n / Part of …; Summary, including the key pieces and judgement calls from the implementer's report; migration notes and a **production heads-up** if it has one; Test plan with checked boxes. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - **Don't poll PR CI** (the session harness forbids `gh pr checks --watch` and similar loops). Tell the product owner the PR is waiting, and check once (`gh pr checks <n>`) when they say "continue".
   - If the PR carries a migration, confirm its Vercel preview build ran **no** `prisma migrate deploy` (see the gotcha "Previews must never migrate or reach production"). To check: find the branch's deployment id in `MSYS_NO_PATHCONV=1 npx vercel api "/v6/deployments?projectId=prj_whCroO48Sq1pZZa0yLpdDUI8she3&limit=6"` (match `meta.githubCommitRef`), then read its build log with `MSYS_NO_PATHCONV=1 npx vercel api "/v3/deployments/<id>/events?builds=1&limit=-1"`. The log should contain the `Running "if [ "$VERCEL_ENV" = "production" ] …"` line and no "migrations found", "Applying migration" or datasource line.
   - When GitHub CI is green: `gh pr merge <n> --squash --delete-branch`. Then follow "Merge, one at a time" and "Tear down" above.
   - A failing **Vercel** check alone doesn't block a merge when GitHub CI is green. Find out why first (`vercel api /v13/deployments/<id>`), and leave a PR comment saying why it's safe.
6. **Watch production.**
   - CD runs `prisma migrate deploy` against **production** on every merge to `main`. Watch the run in the background: find the CI run for the merge commit and `gh run watch` it, then do the same for the CD run. Report the result, including the "Applying migration" / "No pending migrations" lines from the deploy log.
   - Don't merge the next PR while the previous merge's CD run is still in progress, especially one that changes the pipeline itself.
   - Don't query the production DB directly. Targets named prod/production are off-limits without the product owner.
7. Move to the next issue. Report progress to the product owner briefly after each merge.

### Working with the product owner

- Put policy and product questions **in the chat reply as plain text**: numbered questions, lettered options, and a marked recommendation, so the product owner can answer like "1a, 2b". Don't use the AskUserQuestion tool; its prompts weren't visible to the product owner.
- Keep work going on anything a question doesn't block. Brief the implementer with your recommended default, kept in one named constant, and relay the answer with SendMessage when it arrives.
- Record every decision as a comment on the relevant issue. A decision that changes how later work is done also goes into this document, `CONTEXT.md` or an ADR, whichever it belongs to.
- Vercel project settings and other production configuration are the product owner's to change. The permission classifier blocks the supervisor from changing them. Give exact dashboard steps, then read the settings back through the API to confirm.

### What goes in `HANDOFF.md`

`HANDOFF.md` is read first in every fresh session and edited for every issue, so it is kept short and is the supervisor's file.

- It holds **current state and the queue**: what is in flight, the "Next up" list, the dev DB's seeded state, and conventions or gotchas that still apply.
- Per-issue history doesn't go in it. What was built, the migration evidence, test numbers and judgement calls go in the **PR description**; product-owner decisions go on the **issue**. Both stay findable from the issue number.
- Implementers **don't edit** `HANDOFF.md`. With two branches open, two edits to the same list are the most likely merge conflict.
- The supervisor updates it in the issue's worktree as the last commit before pushing, after the branch has merged `main`: mark the issue done in "Next up" with one line and the PR number, and change any current-state fact the issue altered (e.g. the seeded row counts).
- A convention or gotcha that outlives the issue goes into this document's gotchas, not into a per-issue note.

## Implementer brief template (rules every brief must carry)

- **Read first:**
  - `gh issue view <n> --comments`: the issue is the spec, and comments hold product-owner decisions.
  - `AGENTS.md`: this Next.js version differs from training data, so read `node_modules/next/dist/docs/` before Next-specific code.
  - `CONTEXT.md`: use the glossary's exact terms.
  - the relevant PRD section, and the `HANDOFF.md` conventions/gotchas.
- **Supervisor context:** the files, functions and data facts you already checked; decisions already made; what's out of scope.
- **Branch and git:**
  - Work only in the worktree `C:\dev\requirement-wt\<issue>-<slug>`, already on branch `<issue>-<slug>`, and only against the database `requirement_<issue>` its `.env` points at. Never touch the main checkout or the `requirement` database.
  - Commits reference `#<issue>` and end with the `Co-Authored-By:` trailer the session's attribution instructions specify.
  - Don't push, open a PR, merge or close the issue.
  - Leave `.claude/` untracked.
- **Migrations:**
  - Hand-write the SQL. The directory timestamp must **sort after the latest existing migration**, not the wall clock: `prisma migrate dev` names by clock time and can sort *before* an earlier hand-named migration.
  - If `prisma migrate dev` hangs, kill it and check `_prisma_migrations` for a stray row.
  - **Never connect to the dev DB** (`requirement`). Your own `requirement_<issue>` may be dropped and recreated.
  - Record before/after row counts.
  - Prove there's no drift with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch db> --exit-code`.
  - Prove the fresh path: on a second scratch DB, `migrate deploy` + `prisma db seed` gives the same shape.
  - Rehearse data migrations on `requirement_<issue>`, which starts as a copy of the dev DB.
  - Data migrations must be **data-driven and robust for production**: select rows by stable properties with a fallback, never hard-coded ids or display names alone (names are editable in the UI); make them idempotent where possible (`ON CONFLICT DO NOTHING`); and make them a no-op on an empty DB.
  - Scratch DBs live in the `requirement-db` container (user `app`, password from `.env`'s `DATABASE_URL`). Name them `requirement_<issue>_<purpose>` and drop them afterwards.
  - If an already-applied migration file is edited before merge, update its `checksum` in `requirement_<issue>`'s `_prisma_migrations` to the sha256 of the file with CRLF normalised to LF.
- **Tests:**
  - **CI's test DB is migrated but NOT seeded.** Tests must create their own fixtures (unique `Test …` names/codes) and clean up, and never depend on seeded data.
  - A test that needs a base Framework uses the existing one (`getBaseFramework()`). It never creates, flips or deletes a base; see "Test fixtures" in the gotchas below.
  - Avoid unscoped `PER_SYSTEM` Control fixtures, because they leak into concurrently running test files. Use `ORGANIZATIONAL` or Deployment-Facet-scoped fixtures.
  - Route tests call exported handlers against real Postgres (the `requestAs`/`ctxFor` pattern); component tests use Testing Library + `vi.stubGlobal("fetch", …)`.
  - Assert "no DB change" on refused writes.
- **Verification before hand-back:**
  - `npm run typecheck` and `npm run lint`: check exit codes unpiped. Piping to `tail` hides failures. No new warnings.
  - Simulate CI: on a scratch DB with `migrate deploy` only, run the full `npx vitest run`. Also run the touched files against `requirement_<issue>`, which holds the seeded data.
  - The full suite takes about 5 minutes and can flake under load. Re-run a failing file alone; only failures that reproduce in isolation are real.
  - If typecheck complains about stale `.next/dev/types`, delete that folder.
- **Encoding:** every written file must be valid UTF-8. A PowerShell write once produced Latin-1 bytes, which Vitest and `tsc` accepted but Turbopack rejected with a 500. Use the Write/Edit tools or Git Bash, and check with `iconv`.
- **Don't** start a dev server or use the browser; the supervisor verifies.
- **Docs in the same change:** update `README.md`'s Project status (an `AGENTS.md` rule). Don't edit `HANDOFF.md`; the supervisor does. Touch `CONTEXT.md` only for genuine glossary changes, and flag them.
- **When unsure:** make the conservative choice (deny rather than allow; preserve data rather than drop it) and **flag it** in the report for the product owner.
- **Report back concisely:** branch + commits; what changed; migration evidence; test/typecheck/lint numbers; judgement calls and open questions. The supervisor builds the PR description from this report, and it is the lasting record of the issue.

## Known environment gotchas

- **Git Bash path mangling.** An argument starting with `/`, such as a `vercel api /v13/…` path, gets rewritten to a Windows path. Prefix the command with `MSYS_NO_PATHCONV=1`. `/tmp` also maps oddly, so use the session scratchpad for temp files.
- **Vercel preview "Resource provisioning failed" = Neon branch limit.** *(Since 2026-10-01 the product owner has turned off the Neon integration's preview branching, because previews no longer use a database, so this should not recur. If it does, check that setting first.)* The first preview deploy of each git branch makes the Neon integration (resource `neon-coffee-kite`) create a `preview/<git-branch>` database branch. Neon's free plan allows 10 branches per project, and it doesn't delete them when the git branch is merged or deleted; there's no setting for that. Once the limit is reached, every *new* git branch's preview fails with `errorCode: BUILD_FAILED`, `errorMessage: Resource provisioning failed` and `"integrations": {"status": "error"}`, before any build step runs, and a redeploy fails the same way. This first happened at PR #82 (the 11th branch, counting `main`). Confirm with `MSYS_NO_PATHCONV=1 npx vercel api /v13/deployments/<dpl_id>`. The fix is for the **product owner** to delete the `preview/*` branches of merged PRs in the Neon console (`npx vercel integration open neon neon-coffee-kite` → Branches), keeping `main`. The supervisor has no Neon credentials and shouldn't delete databases anyway, so ask. Meanwhile, if GitHub CI (lint-typecheck, test, build, docker-build) is green, comment on the PR and merge: production ships from `cd.yml`, not from previews. If a *different* Vercel error appears, investigate it.
- **Previews must never migrate or reach production.** Until 2026-09-30 they did. `DATABASE_URL` was a manual Vercel variable set for Production **and** Preview; the Neon integration only adds `DATA_*`-prefixed variables. The build command was `npx prisma migrate deploy && npm run build`, so every preview build applied its branch's unmerged migrations to the **production** database, and a running preview read and wrote production data. It was caught when #87's CD log said "No pending migrations to apply": production's `_prisma_migrations` showed `20260929180000` applied at 15:53:56 UTC by the PR #101 preview, 48 minutes before merge. Nothing was lost; that migration only added an enum value. The product owner fixed it in the dashboard:
  - the build command is now `if [ "$VERCEL_ENV" = "production" ]; then npx prisma migrate deploy; fi && npm run build`;
  - `DATABASE_URL` targets Production only.

  The first preview built after the fix (PR #102, for #88, whose migration drops tables) shows no migrate step or datasource line. **Before pushing a branch that carries a migration**, read the settings back:
  - `MSYS_NO_PATHCONV=1 npx vercel api /v9/projects/prj_whCroO48Sq1pZZa0yLpdDUI8she3` for `buildCommand`;
  - `.../env` for `DATABASE_URL`'s `target`.

  Changing Vercel settings is the product owner's job; the permission classifier treats it as a production deploy. The 18 `DATA_*` variables hold production credentials the app doesn't read. They were exposed to Preview until the product owner limited them to Production on 2026-10-01.
- **Keep the checkout out of OneDrive.** The repo lives at `C:\dev\requirement`. It used to sit in a OneDrive-synced folder, which made first compiles take tens of seconds, caused transient 404/500 responses and made sync fight the tooling over file locks. It was moved on 2026-09-29. Don't clone or move it back under a synced folder.
- **Tests run against whatever `.env` points at.** In a worktree that is the issue's own database, so leaked `Test …` fixtures go when it is dropped. A test run in the main checkout still hits the dev DB and can leak fixtures into it.
- **A stale `.next` cache can make API routes return a Next.js HTML 404.** After many branch switches in the shared checkout, `PATCH /api/systems/[id]/assessments/[controlId]` returned the HTML "This page could not be found" for every call, although the route file was unchanged and the handler never reached its first query. Stopping the dev server, running `rm -rf .next` and starting it again fixed it. Check for this before suspecting the code. Deleting only `.next/dev/types` (the typecheck fix above) and then starting the dev server caused the same HTML 404 on 2026-10-02, so before a browser check delete the whole `.next` folder, not part of it.
- **Inside an interactive transaction, every query must use the transaction client.** `prisma.$transaction(async (tx) => ...)` holds one connection; a query on the global `prisma` client inside it needs a second. CI's pool is 3 connections, so when other transactions hold the rest while waiting on an advisory lock, the one holding the lock never gets its second connection and all of them fail after Prisma's 10 s pool timeout (`P2024`). This failed PR #134's first CI run and passed locally, where the pool is bigger. Since then `vitest.config.ts` runs the tests with `connection_limit=3` unless `DATABASE_URL` sets one. In review, check that helpers called inside a transaction take the client as a parameter and are given `tx`.
- **Lint baseline: 6 warnings, 0 errors** (since #126; it was 7 since #122, and 8 before). Five are `react-hooks/set-state-in-effect` in components that fetch in an effect (#63) and one is the font warning in `src/app/layout.tsx`. A new warning is a regression.
- **`ControlAssessmentList.test.tsx` used to fail about 1 run in 5** (a `toBeEnabled` assertion on Save). The cause was in the component, a state reset in an effect that also ran after mount, and was fixed with #122. If a component test flakes on an assertion made right after `findBy…`, look for the same pattern before calling it load.
- **Merging is the product owner's.** On 2026-10-04 the permission classifier refused the supervisor's `gh pr merge` as a production deploy, because CD deploys every merge to `main`. Prepare the PR, check CI and the preview, then ask the product owner to merge, and watch CI and CD after they do.
- **Transient network errors.** `prisma migrate deploy` and `gh` have a few times failed with `Can't reach database server` or `TLS handshake timeout` when nothing was wrong. Retry once. To check the dev DB itself (the supervisor only): `docker exec requirement-db psql -U app -d requirement -c "SELECT 1;"`. The container is `requirement-db`, user `app`, database `requirement`, port 5432.
- **Test fixtures.**
  - `vitest.global-setup.ts` makes sure exactly one base Framework exists for the run: it does nothing on a seeded database, and on CI's unseeded one it creates a base and removes it at the end. So a test file never creates, flips or deletes a base.
  - A fixture Control applies to a System only if it is mapped to a Published Framework in that System's scope. `src/test/framework-fixtures.ts` has the helpers (`getBaseFramework`, `mapControlsToBase`, `mapControlsToFramework`, `createFixtureFramework`) and removes what they create.
  - **Never map a fixture Organizational Control to the base Framework.** Since #122 it would count on every System, other test files' and the seeded ones included. Map it to a Framework from `createFixtureFramework` and put only your own fixture Systems in that Framework's scope.
  - A change of an Organizational Control's implementation status writes a System-less Change Event, which no System cascade removes. A test that makes one deletes its `systemId: null` events in `afterAll`.
  - Provider and dependency tests use `src/test/provider-fixtures.ts` (`setupProviderFixtures`).
  - A Control with an `originFrameworkId` must be deleted before its Framework (the relation is `Restrict`).
- **A new enum value can't be used in the migration that adds it.** Postgres refuses to use a value added by `ALTER TYPE ... ADD VALUE` in the transaction that adds it, and a migration file runs as one. Add the value in its own migration, sorted before the one that uses it, as #123 did (`20261002100000_add_control_offering_changed_change_event`).
- **Renaming a Prisma model can swap the columns of its implicit many-to-many join tables.** Prisma names such a table `_<A>To<B>` with the two model names in alphabetical order, and column `A` belongs to the first. A rename that changes the order flips which side is `A`, and `prisma migrate dev` can't express that, or a required foreign key becoming a many-to-many relation, without losing data. Hand-write the SQL: rename in place, backfill the join table before dropping the old column, and state each join table's `A`/`B` sides in the migration's header. `20260914175041_replace_system_type_with_deployment_facet` and `20260929120000_rename_requirement_to_control` are worked examples.
- **A data migration that aborts blocks every later deploy.** When a migration raises an exception, Prisma records it as failed, and every later `migrate deploy`, so every CD run, refuses to run (P3009) until someone fixes the data and runs `npx prisma migrate resolve --rolled-back <migration>` against production. A migration that can abort therefore ships with a read-only pre-check script that exits 1 when it would abort (`scripts/check-overlay-migration.ts` and `scripts/check-capability-migration.ts` are the pattern), and the product owner runs it against production before merging. `scripts/check-unmapped-controls.ts` is the same kind of check for a change to applicability.
