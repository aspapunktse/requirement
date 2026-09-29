@AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (aspapunktse/requirement), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Development workflow: supervisor + Sonnet sub-agents

Implementation work runs as a **supervised sub-agent workflow**. The main session is the **supervisor**, and it doesn't write feature code itself. It works issues one at a time in dependency order: it briefs one **Sonnet** sub-agent per issue (Agent tool, `model: "sonnet"`, background), reviews what comes back, verifies in the browser, opens the PR, waits for CI, merges, and watches the production deploy. Policy questions go to the product owner rather than being decided silently. Follow [`docs/agents/supervised-workflow.md`](docs/agents/supervised-workflow.md): it holds the full loop, the rules every implementer brief must carry (migrations, CI-not-seeded tests, UTF-8, no push/PR), and the known environment gotchas. The current queue is in `HANDOFF.md` under "Next up".

### Keep README.md current

Whenever a change lands that affects what's described in `README.md` — a feature ships, an issue closes, the project status changes, a deferred item gets picked up, setup/scripts/stack change — update `README.md` in the same piece of work rather than leaving it to drift. In particular, keep the "Project status" section an accurate snapshot of what's actually implemented, not a point-in-time note that goes stale. Don't treat this as optional cleanup; treat a change as incomplete until README reflects it.
