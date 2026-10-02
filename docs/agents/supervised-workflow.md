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

- Work issues **one at a time**, in dependency order. Dependencies are GitHub's native "blocked by" links on each issue, and the "Next up" list in `HANDOFF.md` gives the current queue.
- Never run two implementers in parallel. They share one Postgres, the dev DB, which the tests also use, and parallel migrations or fixtures collide.
- When the product owner asks for a milestone to be "cut into issues":
  1. Read the PRD section and the relevant code (read-only).
  2. Draft vertical, independently shippable issues. Each gets: a "Part of PRD 0001 · Mx" line, **Why**, **Scope**, **Acceptance criteria**, "Blocked by: #n", and the CI-not-seeded test rule.
  3. Create a GitHub milestone named `PRD 0001 · Mx <name>`.
  4. Create the issues with labels `enhancement` and `ready-for-agent`.
  5. Add native dependencies: `gh api --method POST repos/aspapunktse/requirement/issues/<child>/dependencies/blocked_by -F issue_id=<blocker database id>`.
  6. Close the GitHub milestone once all of its issues are closed.

## Per-issue loop

1. **Prepare.**
   - `git checkout main && git pull`.
   - Stop the supervisor's preview dev server (`preview_stop`). A running `next dev` locks Prisma's query-engine DLL, and `prisma generate` then fails with EPERM.
   - Read the issue and the code it names, so the brief can carry facts, not guesses.
   - Read-only checks that decide policy (e.g. "do any rows hit this edge case?") are worth running yourself before briefing, so the product owner is asked only when it matters.
2. **Brief the implementer.** It starts cold, so the brief must be self-contained. Use the template below.
3. **Review the hand-back.**
   - Read the report critically. Check `git log`, `git diff --stat main...HEAD` and `git status`.
   - **Read any migration SQL in full.**
   - Check `npx prisma migrate status`.
   - Grep for leftovers the issue said to remove.
   - Check every changed file is valid UTF-8 (`iconv -f utf-8 -t utf-8 <file> >/dev/null`).
   - Send follow-ups to the **same** agent (SendMessage with its id), which keeps its context. Once a branch is pushed, fixes must be new commits, not amends.
   - Bring the branch up to date with `main` (`git merge main`) before verifying, so you test what will actually land.
4. **Verify in the browser.**
   - If the checkout has switched branches since the dev server last ran, run `rm -rf .next` first (see the stale-`.next` gotcha).
   - `preview_start` with name `next-dev`.
   - Hit a route once before screenshotting it. Turbopack compiles each route on its first request, so the page may briefly show "Compiling…".
   - Sign in as the relevant role with the header role switcher.
   - Exercise the change and read the console and network logs. HMR websocket errors from the preview pane are noise.
   - Prefer creating your own test data **through the app's API** (`fetch` from the page with the acting-user cookie set), e.g. a `Test #<n> …` System owned by the role you need. Changing seeded rows directly in SQL (e.g. reassigning a seeded System's owner) is blocked by the permission classifier; don't work around it.
   - If you create test data, remove it afterwards and leave the dev DB as you found it. Deleting a test System cascades to its Assessments and Change Events. Delete any Change Events your test wrote on seeded Systems, and compare row counts before and after.
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
   - `gh pr create` with a body of: Closes #n / Part of …; Summary; migration notes and a **production heads-up** if it has one; Test plan with checked boxes. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - **Don't poll PR CI** (the session harness forbids `gh pr checks --watch` and similar loops). Tell the product owner the PR is waiting, and check once (`gh pr checks <n>`) when they say "continue".
   - If the PR carries a migration, confirm its Vercel preview build ran **no** `prisma migrate deploy` (see the gotcha "Previews must never migrate or reach production"). To check: find the branch's deployment id in `MSYS_NO_PATHCONV=1 npx vercel api "/v6/deployments?projectId=prj_whCroO48Sq1pZZa0yLpdDUI8she3&limit=6"` (match `meta.githubCommitRef`), then read its build log with `MSYS_NO_PATHCONV=1 npx vercel api "/v3/deployments/<id>/events?builds=1&limit=-1"`. The log should contain the `Running "if [ "$VERCEL_ENV" = "production" ] …"` line and no "migrations found", "Applying migration" or datasource line.
   - When GitHub CI is green: `gh pr merge <n> --squash --delete-branch`. Then update `main`: use `git checkout main && git pull` only if no implementer is running. Otherwise use `git fetch origin main:main` and **don't switch branches** (see "Shared checkout" below).
   - A failing **Vercel** check alone doesn't block a merge when GitHub CI is green. Find out why first (`vercel api /v13/deployments/<id>`), and leave a PR comment saying why it's safe.
6. **Watch production.**
   - CD runs `prisma migrate deploy` against **production** on every merge to `main`. Watch the run in the background: find the CI run for the merge commit and `gh run watch` it, then do the same for the CD run. Report the result, including the "Applying migration" / "No pending migrations" lines from the deploy log.
   - Don't merge the next PR while the previous merge's CD run is still in progress, especially one that changes the pipeline itself.
   - Don't query the production DB directly. Targets named prod/production are off-limits without the product owner.
7. Move to the next issue. Report progress to the product owner briefly after each merge.

### Working with the product owner

- Put policy and product questions **in the chat reply as plain text**: numbered questions, lettered options, and a marked recommendation, so the product owner can answer like "1a, 2b". Don't use the AskUserQuestion tool; its prompts weren't visible to the product owner.
- Keep work going on anything a question doesn't block. Brief the implementer with your recommended default, kept in one named constant, and relay the answer with SendMessage when it arrives.
- Record every decision as a comment on the relevant issue, and in `HANDOFF.md`.
- Vercel project settings and other production configuration are the product owner's to change. The permission classifier blocks the supervisor from changing them. Give exact dashboard steps, then read the settings back through the API to confirm.

### Shared checkout

The supervisor and the implementer work in **the same** `C:\dev\requirement` working tree. While an implementer is running:
- never `git checkout` or switch branches (it moves the implementer's uncommitted work);
- merge PRs with `gh pr merge` alone, and update local `main` with `git fetch origin main:main`;
- do any side edit (e.g. reverting a temporary commit on another PR's branch) in a separate worktree: `git worktree add <scratchpad>/wt -B wt origin/<branch>`, then push and `git worktree remove` it.

Run only one implementer at a time (see above).

## Implementer brief template (rules every brief must carry)

- **Read first:**
  - `gh issue view <n> --comments`: the issue is the spec, and comments hold product-owner decisions.
  - `AGENTS.md`: this Next.js version differs from training data, so read `node_modules/next/dist/docs/` before Next-specific code.
  - `CONTEXT.md`: use the glossary's exact terms.
  - the relevant PRD section, and the `HANDOFF.md` conventions/gotchas.
- **Supervisor context:** the files, functions and data facts you already checked; decisions already made; what's out of scope.
- **Branch and git:**
  - Branch `<issue>-<slug>` from an up-to-date `main`.
  - Commits reference `#<issue>` and end with the `Co-Authored-By:` trailer the session's attribution instructions specify.
  - Don't push, open a PR, merge or close the issue.
  - Leave `.claude/` untracked.
- **Migrations:**
  - Hand-write the SQL. The directory timestamp must **sort after the latest existing migration**, not the wall clock: `prisma migrate dev` names by clock time and can sort *before* an earlier hand-named migration.
  - If `prisma migrate dev` hangs, kill it and check `_prisma_migrations` for a stray row.
  - **Never reset the dev DB.**
  - Record before/after row counts.
  - Prove there's no drift with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch db> --exit-code`.
  - Prove the fresh path: on a second scratch DB, `migrate deploy` + `prisma db seed` gives the same shape.
  - Rehearse data migrations on a `pg_dump` of the dev DB.
  - Data migrations must be **data-driven and robust for production**: select rows by stable properties with a fallback, never hard-coded ids or display names alone (names are editable in the UI); make them idempotent where possible (`ON CONFLICT DO NOTHING`); and make them a no-op on an empty DB.
  - Scratch DBs live in the `requirement-db` container (user `app`, password from `.env`'s `DATABASE_URL`). Drop them afterwards.
  - If an already-applied migration file is edited before merge, update its `checksum` in the dev DB's `_prisma_migrations` to the sha256 of the file with CRLF normalised to LF.
- **Tests:**
  - **CI's test DB is migrated but NOT seeded.** Tests must create their own fixtures (unique `Test …` names/codes) and clean up, and never depend on seeded data.
  - A test that needs a base Framework uses the existing one or creates a temporary one. It never flips or deletes the seeded base, and never leaves a second base behind.
  - Avoid unscoped `PER_SYSTEM` Control fixtures, because they leak into concurrently running test files. Use `ORGANIZATIONAL` or Deployment-Facet-scoped fixtures.
  - Route tests call exported handlers against real Postgres (the `requestAs`/`ctxFor` pattern); component tests use Testing Library + `vi.stubGlobal("fetch", …)`.
  - Assert "no DB change" on refused writes.
- **Verification before hand-back:**
  - `npm run typecheck` and `npm run lint`: check exit codes unpiped. Piping to `tail` hides failures. No new warnings.
  - Simulate CI: on a scratch DB with `migrate deploy` only, run the full `npx vitest run`. Also run the touched files against the seeded dev DB.
  - The full suite takes about 5 minutes and can flake under load. Re-run a failing file alone; only failures that reproduce in isolation are real.
  - If typecheck complains about stale `.next/dev/types`, delete that folder.
- **Encoding:** every written file must be valid UTF-8. A PowerShell write once produced Latin-1 bytes, which Vitest and `tsc` accepted but Turbopack rejected with a 500. Use the Write/Edit tools or Git Bash, and check with `iconv`.
- **Don't** start a dev server or use the browser; the supervisor verifies.
- **Docs in the same change:** update `README.md`'s Project status (a `CLAUDE.md` rule) and `HANDOFF.md`'s "Next up" (mark the issue done, with a short key-pieces note). Touch `CONTEXT.md` only for genuine glossary changes, and flag them.
- **When unsure:** make the conservative choice (deny rather than allow; preserve data rather than drop it) and **flag it** in the report for the product owner.
- **Report back concisely:** branch + commits; what changed; migration evidence; test/typecheck/lint numbers; judgement calls and open questions.

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
- **Tests share the dev DB.** Killed runs leak `Test …` fixtures into it, so clean them up occasionally.
- **A stale `.next` cache can make API routes return a Next.js HTML 404.** After many branch switches in the shared checkout, `PATCH /api/systems/[id]/assessments/[controlId]` returned the HTML "This page could not be found" for every call, although the route file was unchanged and the handler never reached its first query. Stopping the dev server, running `rm -rf .next` and starting it again fixed it. Check for this before suspecting the code. Deleting only `.next/dev/types` (the typecheck fix above) and then starting the dev server caused the same HTML 404 on 2026-10-02, so before a browser check delete the whole `.next` folder, not part of it.
- **Inside an interactive transaction, every query must use the transaction client.** `prisma.$transaction(async (tx) => ...)` holds one connection; a query on the global `prisma` client inside it needs a second. CI's pool is 3 connections, so when other transactions hold the rest while waiting on an advisory lock, the one holding the lock never gets its second connection and all of them fail after Prisma's 10 s pool timeout (`P2024`). This failed PR #134's first CI run and passed locally, where the pool is bigger. Since then `vitest.config.ts` runs the tests with `connection_limit=3` unless `DATABASE_URL` sets one. In review, check that helpers called inside a transaction take the client as a parameter and are given `tx`.
- **Lint baseline: 6 warnings, 0 errors** (since #126; it was 7 since #122, and 8 before). Five are `react-hooks/set-state-in-effect` in components that fetch in an effect (#63) and one is the font warning in `src/app/layout.tsx`. A new warning is a regression.
- **`ControlAssessmentList.test.tsx` used to fail about 1 run in 5** (a `toBeEnabled` assertion on Save). The cause was in the component, a state reset in an effect that also ran after mount, and was fixed with #122. If a component test flakes on an assertion made right after `findBy…`, look for the same pattern before calling it load.
