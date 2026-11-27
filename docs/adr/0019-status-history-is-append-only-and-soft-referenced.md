---
status: accepted
---

# Status history is append-only and soft-referenced

A POA&M must show how a Risk got to its status, and the app only kept the current status (the Change Events are prose and say so only for some paths). We keep a dedicated table, `StatusChange`, written in the same transaction as every change to a Risk's status or a Control Assessment's stored status, through one helper that takes the caller's `tx` (`src/lib/status-history.ts`). *(Agreed with the product owner 2026-11-26, #456: a dedicated append-only table, for Risks and Control Assessments; Change Events stay prose.)*

One row holds the subject type (`RISK` or `CONTROL_ASSESSMENT`), the subject's id, the Control's id for an assessment, the from status (null when the row was just created) and the to status as text, the actor (null when the system made the change) and the time. A write that leaves the status as it was records nothing.

## Considered options

- **Two nullable foreign keys with a CHECK that exactly one is set, or two tables**: rejected. The subject is not a foreign key on purpose (below), and the two kinds share every other column.
- **A foreign key to the Risk and the Control Assessment (cascade)**: rejected. The app deletes a Control Assessment when its Control stops applying (stale-assessment removal, applicability recompute) and recreates it with a new id later; cascading would erase the history exactly when someone asks what happened. Plain text ids keep it.
- **Foreign key with SET NULL or RESTRICT**: rejected. SET NULL keeps a row that points at nothing, and RESTRICT would stop the app removing an Assessment it must remove.
- **Backfill from Change Events**: rejected. They are prose and incomplete; the past is unknown, so existing rows have no history and a POA&M leaves out a risk log for them.

## Consequences

- The table only grows. No route, function or job updates or deletes a row; the only deletion is the cascade from the System (`systemId`, null for an Organization Risk), and a removed User's rows keep their place with the actor set to null.
- Status is stored as text, not as the enums: a later change to an enum does not touch old rows.
- Not every status change is a write: a dependent System's effective status that moves because its Provider's status moved changes no Control Assessment, so it adds no row (the Change Events still say so). Seed scripts write through Prisma directly and record no history.
- Creating Control Assessments in bulk (applicability recompute) records one creation row each, so the table is as large as the number of Assessments ever created.
