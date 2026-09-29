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
2. **Brief the implementer.** It starts cold, so the brief must be self-contained. Use the template below.
3. **Review the hand-back.**
   - Read the report critically. Check `git log`, `git diff --stat main...HEAD` and `git status`.
   - **Read any migration SQL in full.**
   - Check `npx prisma migrate status`.
   - Grep for leftovers the issue said to remove.
   - Check every changed file is valid UTF-8 (`iconv -f utf-8 -t utf-8 <file> >/dev/null`).
   - Send follow-ups to the **same** agent (SendMessage with its id), which keeps its context. Once a branch is pushed, fixes must be new commits, not amends.
4. **Verify in the browser.**
   - `preview_start` with name `next-dev`.
   - Warm routes up first. The first compile on this OneDrive folder is slow (tens of seconds); PowerShell `Invoke-WebRequest -TimeoutSec 240` works well.
   - Sign in as the relevant role with the header role switcher.
   - Exercise the change and read the console and network logs. HMR websocket errors from the preview pane are noise.
   - If you create test data, remove it afterwards and leave the dev DB as you found it.
   - Restart the dev server after any migration, because it caches the old Prisma client.
5. **PR and merge.**
   - `git push -u origin <branch>`.
   - `gh pr create` with a body of: Closes #n / Part of …; Summary; migration notes and a **production heads-up** if it has one; Test plan with checked boxes. End with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
   - `gh pr checks <n> --watch`.
   - When CI is green: `gh pr merge <n> --squash --delete-branch`, then `git checkout main && git pull`.
6. **Watch production.**
   - CD runs `prisma migrate deploy` against **production** on every merge to `main`. Watch the CD run (`gh run watch`) and report the result.
   - Don't query the production DB directly. Targets named prod/production are off-limits without the product owner.
7. Move to the next issue. Report progress to the product owner briefly after each merge.

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
- **Vercel preview "Resource provisioning failed".** Since PR #82, the Vercel preview check fails with `errorCode: BUILD_FAILED`, `errorMessage: Resource provisioning failed`, before any build step runs. It's Vercel-side and not a code failure; a redeploy fails the same way. Confirm with `MSYS_NO_PATHCONV=1 npx vercel api /v13/deployments/<dpl_id>`. If GitHub CI (lint-typecheck, test, build, docker-build) is green, comment on the PR and merge. Production ships from `cd.yml`, not previews. The product owner hasn't looked at the Vercel side yet; if a *different* Vercel error appears, investigate it.
- **The dev server's first compile is slow on OneDrive.** Transient 404/500/"Loading…" states during the first compile aren't bugs.
- **Tests share the dev DB.** Killed runs leak `Test …` fixtures into it, so clean them up occasionally.
