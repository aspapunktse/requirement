# Requirement & Risk Onboarding

Tracks requirement fulfillment and risk assessment when onboarding a new system or cloud solution into the enterprise, through to a formal onboarding decision.

## Language

**System**:
A system or cloud solution being onboarded into the enterprise. Progresses through a single onboarding lifecycle per System record (no re-onboarding of the same System as a new entity). Has exactly one System Type and may declare any number of Capabilities it consumes.
_Avoid_: Vendor, application, service (use System even when the thing being onboarded is a SaaS vendor or cloud service)

**System Type**:
An admin-curated classification a System is assigned — exactly one per System (e.g. On-Premises Datacenter, Cloud IaaS/PaaS, SaaS, Hybrid) — that determines which Requirements from the Catalog apply to it. A System spanning multiple deployment models is represented by its own dedicated Hybrid System Type, not by selecting more than one Type (see [ADR 0002](docs/adr/0002-single-system-type-not-multiselect.md)). Changeable any time before Onboarded; changing it recomputes the System's applicable Requirement set.

**Capability**:
An admin-curated catalog entry representing a centrally-provided dependency a System can declare it consumes (e.g. Active Directory, a central IAM/SSO platform, a central KMS) that, when declared, automatically fulfills the specific Requirements it's mapped to on the System's behalf. Standalone catalog concept — not a reference to any actual onboarded System, even if the same real-world thing also happens to be tracked as a System elsewhere. When a Requirement is mapped to more than one Capability, declaring any one of them is sufficient to fulfill it. Declarable/changeable any time before Onboarded, same as System Type.
_Avoid_: Service (see System's _Avoid_ list — "service" already means something else in this glossary)

**Requirement**:
A reusable, admin-curated definition of something a System must satisfy — security, privacy, legal, or operational — independent of any specific System. Requirements are managed by Admins only; other roles consume but don't edit the catalog. Each Requirement carries an Applicability scope — Organizational, Per-System, or Both — and may additionally be scoped to a subset of System Types; a Requirement not scoped to a System's Type simply never generates an Assessment for that System. A mandatory Requirement (scoped to Per-System or Both, and applicable to the System's Type) must have some Requirement Assessment recorded before that System can be submitted for review. Organizational-scoped Requirements are never assessed per System — they're satisfied centrally and exist in the catalog for reference only.
_Avoid_: Control, policy

**Requirement Catalog**:
The full set of Requirement definitions available to assess Systems against. Curated centrally to avoid drift or duplicate/inconsistent requirements across onboardings.

**Self-Assessment Question**:
The question posed to a System Owner for one Per-System/Both Requirement, answered Yes, No, or N/A. Yes sets the Requirement Assessment to Fulfilled; No leaves the Assessment open and automatically creates a Risk linked back to it; N/A sets the Assessment to Not Applicable, still subject to the existing justification/Waiver rule for mandatory Requirements.

**Requirement Assessment**:
The fulfillment status of one Requirement for one specific System (e.g. Fulfilled, Waived, Not Applicable). This is where "does this System meet this Requirement?" is answered — the Requirement itself never carries a status. Waiving or marking Not Applicable a mandatory Requirement requires a justification note and is restricted to Risk Owners/Admins — the System Owner being assessed cannot wave off their own mandatory Requirement. An Assessment can also be set to Fulfilled automatically when the System declares a Capability mapped to its Requirement (recorded with a system-generated note, e.g. "inherited via Active Directory"); this stays visible and overridable like any other Assessment. If the fulfilling Capability is later un-declared, an auto-fulfilled Assessment reverts to Not Started — unless a human has since manually touched that Assessment, in which case the manual entry is left alone.

**Risk**:
A risk identified either ad-hoc (logged directly by the System's owner or a designated risk owner, matching no predefined Requirement) or automatically (generated when a System Owner answers a Requirement's Self-Assessment Question "No," carrying a link back to the originating Requirement Assessment). Both are otherwise the same record and follow the same lifecycle — requirement fulfillment is checked off against pre-defined expectations, while an ad-hoc Risk is a finding that may not map to any predefined Requirement at all.
_Avoid_: Issue, finding (when referring to a tracked Risk record specifically)

**Approval**:
A reviewer's recorded decision on a System's onboarding. Approval is a judgment call made by a human reviewer — it is not automatically derived from Requirement Assessment or Risk status. A reviewer may approve a System despite open gaps, at their discretion.

**Onboarding Lifecycle**:
The sequence a System moves through: Draft (owner is assembling assessments) → In Review (submitted by the owner; requires every mandatory Requirement to have an Assessment) → Approved or Rejected (a reviewer's Approval decision) → Onboarded. Rejected returns to Draft for revision and resubmission rather than ending the System's record. Approved and Onboarded are distinct: Approved means a reviewer cleared the System to proceed; Onboarded means the actual technical integration/cutover has since been completed, a separate later event triggered by the System Owner or an Admin.
