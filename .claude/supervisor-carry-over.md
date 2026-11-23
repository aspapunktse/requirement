# Supervisor carry-over

Local and untracked. Kept by the supervisor; read back into context after every compaction, resume or new session. Template and rules: `docs/agents/supervised-workflow.md`, "Context budget".

Updated: 2026-11-23 evening

## Mandate from the PO
- 2026-11-22: "Start work on #416 and all sub-issues tied to that" (#417-#424). Docs merged as PR #425.

## In flight
- #417, #418, #419 MERGED + deployed + torn down (PRs #426, #427, #428). Prod reconcile dry run: 0 Systems, nothing to apply.
- #422 MERGED (PR #429, 8c38244), torn down, CD SUCCESS (run 45129449259).
- #423 MERGED (PR #430, 72e29c5), torn down, CD SUCCESS (45131792568).
- Note: seed non-base Frameworks (GDPR, Export Control) have NO Control Mappings, so Boundary percentages show '—' in browser checks; tests cover numbers.

- DESIGN boundaries-b/-c MERGED (PR #431), worktree removed. PO to pick A/B/C at /design (Qs in PR #431 body).

## Queue after these
- After #428 merges: #420 (per-Boundary SoA + ISMS migration; blocked on PO pick of boundaries-a), #421 export (after 420); #422, #423, #424 sequential (each touches the Boundary page; #424 has a migration). #422/#423/#424 are unblocked by #419 and can start without the PO pick — start #422 next, possibly alongside #420 only if PO has answered (max one migration in flight).

- #420 MERGED (PR #434, 4b2af97), torn down, CD SUCCESS (45238470945), migration 20261128100000 applied.

- #421 MERGED (PR #435, 3fbe1dc) incl. PO follow-ups (per-System CSV columns, Boundary-page buttons); torn down (worktree, branch, DB). CD watch bwmhgnaxx.
- #433 MERGED (PR #436, 2a2548e) incl. Codex fixes; torn down (worktree, branch, DB, launch.json emptied). CD SUCCESS (45247441233). #416 CLOSED: mandate complete.

## Waiting on CI / CD
- #424 MERGED (PR #432, 30a1e8e), torn down, CD SUCCESS (45135461682), migration applied.

## Open product-owner questions
- DONE: PO ran reconcile dry run on prod 2026-11-23: 0 Systems in a Boundary, nothing to apply.
- Dev DB `requirement` NOT seeded (0 Systems, 90 Users, 2 Controls). PO to run `npx prisma migrate reset --force` outside Claude Code; then supervisor runs `npx tsx prisma/seed-demo-systems.ts`. After #427 merges, main checkout also needs migrate deploy.
- Pick/adjust boundaries-a; Qs in PR #426 body (Change Review only for Onboarded? ISMS no Business Unit? plain-text justification).
- #418 picker: PO kept default (recorded). #420 ISMS incl Draft/closed, #424 retired name/Frameworks: PO kept defaults (recorded).

## Environment
- No preview running. launch.json in this sessio## Next action
1) #420 CD: CI on main for 4b2af97 was in progress; confirm CD + migration 20261128100000 applied. 2) #421 PR: wait CI+Codex, merge --squash --delete-branch, watch CD, tear down (worktree, DB requirement_421, launch.json app-421). 3) #433 (list counters PER FRAMEWORK only, no state/retired counters; scope doc; perimeter w/ Providers): new worktree + DB, brief. PO Qs open: PR #434 (old export URL-only — now moot after #421; ISMS includes Draft/closed), PR #432 (retired name reserved; Frameworks undeletable), #421 Qs ANSWERED yes/yes.

## Auto snapshot (written by the PreCompact hook, 2026-11-23T19:01:16.710Z, trigger: auto)

Mechanical state only; the sections above are the supervisor's own notes.

Worktrees:
```
/Users/jocke/dev/requirement                                                       4b2af97 [main]
/Users/jocke/dev/requirement-wt/433-boundary-scope-doc                             5aba5ce [433-boundary-scope-doc]
/Users/jocke/dev/requirement/.claude/worktrees/admin-controls-page-purpose-6d9f9b  126d45a [claude/admin-controls-page-purpose-6d9f9b]
/Users/jocke/dev/requirement/.claude/worktrees/admin-frameworks-retirement-0096cb  126d45a [claude/admin-frameworks-retirement-0096cb]
/Users/jocke/dev/requirement/.claude/worktrees/context-dependent-soa-04099c        34961e4 [claude/context-dependent-soa-04099c]
/Users/jocke/dev/requirement/.claude/worktrees/control-pack-creation-layout-26b777 d6e70e9 [claude/control-pack-creation-layout-26b777]
/Users/jocke/dev/requirement/.claude/worktrees/internal-audit-ui-design-59f5cf     4c8811a [handoff-audit-picks]
/Users/jocke/dev/requirement/.claude/worktrees/issue-369-status-0b839c             4973267 [claude/ai-assistant]
/Users/jocke/dev/requirement/.claude/worktrees/issue-373-hybrid-framework-4c0621   b86b641 [claude/issue-373-hybrid-framework-4c0621]
/Users/jocke/dev/requirement/.claude/worktrees/issue-416-sub-issues-d7ae7a         989655c [claude/issue-416-sub-issues-d7ae7a]
/Users/jocke/dev/requirement/.claude/worktrees/issues-374-376-6e178d               782dbce [376-not-selected]
/Users/jocke/dev/requirement/.claude/worktrees/production-system-population-1db103 30a8027 [385-production-like-seed]
```

Open PRs:
```
#436 433-boundary-scope-doc: Compliance Boundaries: per-Framework counters, scope document and perimeter with Providers (#433)
```
