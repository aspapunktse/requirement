---
status: accepted
amends: 0010-onboarding-review-runs-as-parallel-review-steps.md
---

# Staged evaluation: the advisory group recommends, the Business System Owner decides

Today a System goes Draft → In Review → Approved → Onboarded. One submission runs the parallel Review Steps of ADR 0010, and every step approves or rejects. A single rejection sends the System back to Draft. That is a compliance sign-off. It doesn't match how the enterprise actually evaluates a new system or vendor. The product owner's evaluation flowchart (grilled on 2026-11-08, terms in `CONTEXT.md` under "Evaluation") is staged: a short vendor evaluation first, then a choice between a light self-assessment and a full evaluation, and a business decision to operate at the end.

We are replacing the single review with **staged evaluation**:

- After the guided interview, every System answers the **first Requirement Round** (the Controls a Framework Owner has marked first round for a Framework in its scope), and a **Risk Analysis** follows.
- **OG1** picks the **Track**. Each advisory group with first-round Controls in its remit gives a verdict on its part, Self or Full, and the base review always takes part. Any Full means Full.
- **Self track:** second round, Risk Analysis, then OG3.
- **Full track:** Qualification, first documentation, OAG review, OG2, second round, Risk Analysis, another OAG review, then OG3.
- **OG3** grants the **Authorized to operate (ATO)**. Onboarded still marks the cutover, as ADR 0001 requires.

The groups of ADR 0010 stay as they are, now called the **Onboarding Advisory Group (OAG)**: the System's Review Groups plus the base review, with the same remits. They give a **Recommendation** (Recommend, Recommend with conditions, or Advise against, always with a comment) instead of a decision. Like today's Review Steps, Recommendations are derived live from the System's scope, are reopened by an owner edit in the group's remit, and are shown as the group's, not the person's.

The gates are decided by the **Business System Owner (BSO)**, a new per-System assignment of any User. The BSO can't be the System's owner. The BSO decides Qualification, OG2 and OG3 whatever the Recommendations say, but deciding against an Advise-against needs a written justification. At each of these gates the BSO can **Reject**, which is final (the System is closed and kept read-only), or **Send back** to an earlier stage. Sending back to the first round re-runs OG1, so the Track can change.

The gap ADR 0010 accepted, that a Framework added to an Onboarded System gets no review, is closed by a **Change Review**. It starts when a change to scope or classification adds Controls to a group's remit on an Onboarded System. Only those groups give Recommendations. The System stays Onboarded, and the BSO accepts the change or revokes the ATO, which sends the System back to a stage the BSO picks.

Systems already in evaluation when this ships stay on today's flow until a separate track that grants an **Interim ATO (IATO)** exists. Approved Systems count as ATO, and Onboarded Systems stay Onboarded.

## Consequences

- A Review Step can no longer block a System on its own. Accountability moves from the compliance groups to the business, and the record shows when the BSO decided against advice.
- Two Requirement Rounds need a first-round marking per Framework and Control, because a Control is shared across Frameworks. That needs a **Framework Owner** (#319).
- Rejection becomes final, so a System can end. Today a System always returns to Draft. Send back is the way to ask for another round without starting a new System.
- An ATO doesn't expire. It is kept current by Continuous Compliance (ADR 0006), Change Reviews and, later, continuous ATO (cATO) through Internal Audits and Check-ups.

## Considered options

- **Keep Review Steps as approvals and add the BSO as one more step**: rejected. The groups would still veto, so the BSO's decision would be a formality, and the flowchart has the groups advising.
- **Let the app pick the Track from the first-round answers** (for example, any "No" means Full): not now. The product owner wants the groups to judge their own part. An automatic or BSO-decided OG1 may come later.
- **Let the BSO decide OG1**: rejected for now, for the same reason.
- **A hard End on every rejection, as the chart draws it**: changed to Reject or Send back. Evaluations often need one more round, and a hard End alone would push people to create duplicate Systems.
- **Move in-flight Systems into the first round when this ships**: rejected, because it would reset work in progress. They stay on today's flow until the IATO track exists.
- **Make the BSO the System's owner**: rejected, because nobody decides on their own System, the same rule as for Review Steps.
