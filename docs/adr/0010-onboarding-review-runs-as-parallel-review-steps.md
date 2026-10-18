---
status: accepted
---

# Onboarding review runs as parallel Review Steps, one per Review Group

A System In Review used to need one Approval, from any Reviewer or Admin. Once Framework Scope drives applicability ([ADR 0007](0007-framework-scope-drives-applicability.md)), a System in scope of GDPR or Cybersäkerhetslagen picks up Supplementary Controls that the people who know that law should judge, not a general Reviewer. Those people sit in different teams for different Frameworks.

A **Review Group** is a named set of Users tied to one or more Frameworks. A Framework has at most one group. Each submission starts a **Review Round**, made up of the **base Review Step** (a Reviewer or an Admin, covering every base Control and the non-base Controls of Frameworks with no group) plus one **Review Step** per Review Group that has at least one Control in its remit on the System. The remit is the non-base Controls that apply through a Requirement of the group's Frameworks. Base Controls stay with the base step even when they also satisfy that Framework, so an Annex A Control is never judged twice. The System is Approved once every step has approved. A single rejection sends it back to Draft and cancels the other steps, and the next submission runs every step again.

We considered three alternatives:
- **Sequential steps** (base first, then each group). Rejected: it makes the slowest team everyone's bottleneck for no gain, since the steps judge disjoint sets of Controls.
- **Carrying earlier approvals into the next round.** Rejected: the owner can edit any answer between rounds, so an earlier approval may no longer describe what is there.
- **A general User Group with several purposes** (Control Owner, Business Risk Owner portfolio and so on), which would match how Entra ID groups get reused. Rejected for now as more model than the one use needs. Entra ID will later supply only a Review Group's membership, and the Review Group stays the app's own record.

Because nothing freezes a System In Review, steps are derived live: a scope change adds or drops steps during the round, and an owner edit to an Assessment in an approved step's remit reopens that step.

A step decides **as its group**. The owner sees "GDPR Review Group: Rejected", along with the comment, and not the person. Who decided is still recorded and shown only to Admins, Internal Auditors, Compliance Managers and that step's own deciders. The same applies to Query Messages a Review Group member posts.

Review Steps exist only for onboarding. Per [ADR 0006](0006-continuous-compliance-replaces-draft-lock.md), a Framework added to an Onboarded System doesn't reopen its Approval, so that Framework's group never reviews it. We accepted this gap for now. A standalone Framework review of an Onboarded System is future work.

Approvals recorded before this change become base-step decisions, each in a Review Round of its own. A System In Review when this ships keeps its base step and gains open group steps.
