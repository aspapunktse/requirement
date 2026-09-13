# Requirement & Risk Onboarding

Tracks requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise, through to a formal onboarding decision.

## Language

**System**:
A system or cloud solution being onboarded into the enterprise. Progresses through a single onboarding lifecycle per System record (no re-onboarding of the same System as a new entity).
_Avoid_: Vendor, application, service (use System even when the thing being onboarded is a SaaS vendor or cloud service)

**Requirement**:
A reusable, admin-curated definition of something a System must satisfy — security, privacy, legal, or operational — independent of any specific System. Requirements are managed by Admins only; other roles consume but don't edit the catalog. A Requirement marked mandatory must have some Requirement Assessment recorded against every System before that System can be submitted for review.
_Avoid_: Control, policy

**Requirement Catalog**:
The full set of Requirement definitions available to assess Systems against. Curated centrally to avoid drift or duplicate/inconsistent requirements across onboardings.

**Requirement Assessment**:
The fulfillment status of one Requirement for one specific System (e.g. Fulfilled, Waived, Not Applicable). This is where "does this System meet this Requirement?" is answered — the Requirement itself never carries a status. Waiving or marking Not Applicable a mandatory Requirement requires a justification note and is restricted to Risk Owners/Admins — the System Owner being assessed cannot wave off their own mandatory Requirement.

**Risk**:
A specific, ad-hoc risk identified during the onboarding of a System — distinct from a Requirement. Requirements are pre-defined expectations checked off; Risks are findings discovered during review that may not map to any predefined Requirement. Both the System's owner and designated risk owners may identify a Risk.
_Avoid_: Issue, finding (when referring to a tracked Risk record specifically)

**Approval**:
A reviewer's recorded decision on a System's onboarding. Approval is a judgment call made by a human reviewer — it is not automatically derived from Requirement Assessment or Risk status. A reviewer may approve a System despite open gaps, at their discretion.

**Onboarding Lifecycle**:
The sequence a System moves through: Draft (owner is assembling assessments) → In Review (submitted by the owner; requires every mandatory Requirement to have an Assessment) → Approved or Rejected (a reviewer's Approval decision) → Onboarded. Rejected returns to Draft for revision and resubmission rather than ending the System's record. Approved and Onboarded are distinct: Approved means a reviewer cleared the System to proceed; Onboarded means the actual technical integration/cutover has since been completed, a separate later event triggered by the System Owner or an Admin.
