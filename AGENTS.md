<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project instructions

This file is the single source of instructions for every coding agent on this repo. Codex and other tools read it directly; Claude Code reads it through the `@AGENTS.md` import at the top of `CLAUDE.md`. Put shared rules here, outside the Next.js block above (`next dev` rewrites only what is between its markers). `CLAUDE.md` holds only what is specific to Claude Code.

## Issue tracker

Issues live in GitHub Issues (aspapunktse/requirement), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

## Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development workflow: supervisor + implementer sub-agents

Implementation work runs as a **supervised sub-agent workflow**. The main session is the **supervisor**, and it doesn't write feature code itself. It works issues in dependency order, at most two at a time, each in its own git worktree with its own database: it briefs one implementer sub-agent per issue, reviews what comes back, verifies in the browser, opens the PR, waits for CI, asks the product owner to merge, and watches the production deploy. Policy questions go to the product owner rather than being decided silently. Follow [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md): it holds the full loop, the rules every implementer brief must carry (migrations, CI-not-seeded tests, UTF-8, no push/PR), and the known environment gotchas. The current queue is in `HANDOFF.md` under "Next up".

That document names Claude Code's tools (the Agent tool, `SendMessage`, `AskUserQuestion`, `preview_stop`). In another harness, use its equivalents: the roles, the order of work, the brief rules and the review steps apply unchanged. If your harness can't spawn sub-agents, ask the product owner how to proceed before implementing an issue yourself.

## Keep README.md current

Whenever a change lands that affects what's described in `README.md` — a feature ships, an issue closes, the project status changes, a deferred item gets picked up, setup/scripts/stack change — update `README.md` in the same piece of work rather than leaving it to drift. In particular, keep the "Project status" section an accurate snapshot of what's actually implemented, not a point-in-time note that goes stale. Don't treat this as optional cleanup; treat a change as incomplete until README reflects it.
