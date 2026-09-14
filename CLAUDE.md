@AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (aspapunktse/requirement), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Keep README.md current

Whenever a change lands that affects what's described in `README.md` — a feature ships, an issue closes, the project status changes, a deferred item gets picked up, setup/scripts/stack change — update `README.md` in the same piece of work rather than leaving it to drift. In particular, keep the "Project status" section an accurate snapshot of what's actually implemented, not a point-in-time note that goes stale. Don't treat this as optional cleanup; treat a change as incomplete until README reflects it.
