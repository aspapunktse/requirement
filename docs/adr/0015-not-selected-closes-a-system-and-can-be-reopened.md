---
status: accepted
amends: 0014-staged-evaluation-oag-recommends-bso-decides.md
---

# Not selected closes a System, and an Admin can reopen it

ADR 0014 gave a System one way to end: the Business System Owner rejects it at a gate, and that is final. A **Comparison** (terms in `CONTEXT.md` under "Evaluation", grilled on 2026-11-16) sets several **Candidate** Systems side by side so that one can be chosen. Each Candidate is a real System, so every Comparison leaves behind the Systems that were not chosen. Left alone they stay in Draft, show as stale in the Systems list and keep tasks open for their owners.

We are adding a second way for a System to be closed: **Not selected**.

- When the outcome of a Comparison is recorded, the app offers to close each Candidate that was not chosen. It is never automatic.
- Only a Candidate still in evaluation can be closed this way, never one with an ATO or one that is Onboarded.
- The Comparison's owner can close the Candidates they own. An Admin can close any.
- A Not selected System is read-only for every role and kept for the record, the same as a Rejected one.
- An Admin can reopen it, with a comment. It returns to the stage it was in, with its Assessments as they were.
- Closing and reopening are Change Events on the System.

## Consequences

- A System can now be closed by someone other than its Business System Owner, and without a gate. The reason is a business choice between Systems, not a judgment of the System.
- "Closed" no longer means "final". Code that refuses writes on a closed System keeps working, but anything that reads a closed System as Rejected must tell the two apart.
- Not selected is its own lifecycle status in lists, counts and trend lines, so a lost Candidate no longer counts as a Draft.
- A reopened System may meet a changed catalogue. Continuous Compliance (ADR 0006) already recomputes its Controls, so nothing extra is needed.

## Considered options

- **Leave the Candidates that lost as they are**: rejected. They would pile up as stale Drafts, and the owner has no way to end a System.
- **Have the Business System Owner reject them**: rejected. Reject is final and says the System failed evaluation, which is not what happened. A Candidate in its first round may not have a Business System Owner yet.
- **Delete them**: rejected. The answers given are the evidence for the choice, and a second choice is often picked up when the first falls through.
- **Make Not selected final, like Rejected**: rejected, for the same reason. Reopening is limited to an Admin so that a closed System doesn't quietly come back.
- **Close them automatically when the outcome is recorded**: rejected. A Candidate may also be wanted for another need, and it can be in more than one Comparison.
