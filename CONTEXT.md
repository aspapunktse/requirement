# Requirement & Risk (GRC)

Governance, risk, and compliance for the systems and cloud solutions an enterprise runs: a requirement database of Frameworks mapped onto one Control Library, with each System assessed against the Controls that apply to it — first at onboarding, then continuously for as long as it lives.

## Language

### Systems and classification

**System**:
A system or cloud solution the enterprise runs or is onboarding. Progresses through a single onboarding lifecycle per System record (no re-onboarding of the same System as a new entity), and stays assessable after it's Onboarded (see **Continuous Compliance**). Declares its classification — one or more Deployment Facets, an Impact Level on each of Confidentiality/Integrity/Availability, and its Framework Scope — and any number of Providers it depends on. All of these can change at any lifecycle stage; each change recomputes the System's applicable Controls (see [ADR 0006](docs/adr/0006-continuous-compliance-replaces-draft-lock.md), which supersedes the Draft-only lock from [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)).
_Avoid_: Vendor, application, service (use System even when the thing being onboarded is a SaaS vendor or cloud service)

**System's owner** (the person `ownerId` names): whoever is recorded as the System's owner, whatever their role. The creator becomes the owner, and only a System Owner, Risk Owner or Admin may create a System (#91). Being a Risk Owner, Reviewer or Viewer doesn't stop someone owning a System, and having the System Owner role doesn't make someone the owner of a System they weren't recorded on. Every owner action (editing Control Assessments and answering Self-Assessment Questions, submitting for review, changing classification, declaring Business Units and Framework Scope, logging a Risk, marking Onboarded) is allowed for the System's owner or an Admin, and nobody else, except the role-based grants that aren't about ownership (a Risk Owner logs Risks on any System and waives; see **Control Assessment** and **Risk**). A Compliance Manager is read-only on Systems, so they can't act as owner even if recorded as one. This is the one owner rule; the other entries say "the System's owner" and mean this.

**Deployment Facet**:
An admin-curated classification a System declares one or more of (e.g. On-Premises Datacenter, Cloud IaaS/PaaS, SaaS). A Control can be scoped to a subset of Facets; it then applies only to Systems declaring at least one of them. A System spanning multiple deployment models simply declares more than one Facet — Hybrid is not its own catalog entry (see [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md)).
_Historical note_: this concept was called "System Type" (exactly one per System) before ADR 0003.

**Impact Level**:
An ordinal classification — Low, Moderate, High, or Critical, one shared scale — the System's owner self-declares independently on each of three axes: Confidentiality, Integrity, and Availability. A Control may set a minimum Impact Level threshold on any of the three axes (or none); it applies to a System only once that System's declared level on that axis meets or exceeds the threshold. A System that hasn't yet declared a level on an axis ("not classified") never meets a threshold on that axis. See [ADR 0003](docs/adr/0003-multiselect-deployment-facets-plus-overlays.md).

**Framework Scope**:
The set of Frameworks a System is subject to. The base Framework (ISO 27001) is always in scope for every System; every other Framework is declared. Drives applicability: a System's applicable Controls are those mapped to Requirements of Frameworks in its scope, further filtered by each Control's Deployment Facet and Impact Level scoping (see [ADR 0007](docs/adr/0007-framework-scope-drives-applicability.md)).
_Historical note_: was a reporting-only "audit boundary" relation before ADR 0007.

**Regulatory Overlay** _(retired)_:
Was a boolean flag a System declared (e.g. GDPR, EAR/ITAR) to pull in extra Requirements. Replaced by Framework Scope: GDPR, EAR/ITAR and the like are now Frameworks in their own right (see [ADR 0007](docs/adr/0007-framework-scope-drives-applicability.md)). Don't use "overlay" for anything new.

**Business Unit**:
An admin-curated catalog entry representing an organizational consumer (e.g. Finance, HR) that a System declares is using it. Purely a reporting/grouping dimension — declaring a Business Unit has no effect on a System's applicable Controls. A System may declare any number of Business Units. Declared/changed by the System's owner or an Admin.
_Avoid_: Consumer, department, used-by (informal phrasing during design; Business Unit is the canonical term)

### The requirement database

**Framework**:
A curated catalog entry for a compliance standard, law, or regulation (e.g. ISO 27001:2022, Cybersäkerhetslagen, GDPR, CSA CCM 4, CMMC), made up of its own **Requirements** — the standard's line items (see [ADR 0005](docs/adr/0005-split-requirement-and-control.md)). ISO 27001:2022 is the **base Framework**: its Annex A defines the base Control Library, and every other Framework is mapped onto that library, adding Supplementary Controls only where no base Control covers a Requirement. Each version of a standard is its own Framework (ISO 27001:2013 and ISO 27001:2022 are two), optionally linked by "supersedes"; a national law that transposes an EU directive (e.g. Cybersäkerhetslagen for NIS2) is modeled as the Framework, not the directive. Carries a `strictComplianceRequired` flag: some Frameworks only accept Fulfilled (no partial credit for Waived/Not Applicable) when computing compliance against them. Is either **Draft** (being authored or mapped — invisible to Systems) or **Published**; only a Published Framework can be in a System's Framework Scope or affect applicability, and Supplementary Controls authored for a Draft Framework reach Systems only when it's published.
_Avoid_: Standard, regulation, overlay (Framework covers all of them)
_Historical note_: previously a bare `Requirement.framework: String[]` free-text tag, promoted to a first-class catalog entity in [ADR 0004](docs/adr/0004-framework-as-first-class-entity.md).

**Requirement**:
One line item of a Framework — a clause, article, or control objective as the standard itself states it (e.g. ISO 27001 clause 6.1.2, ISO 27001 A.8.24, NIS2 Art. 21(2)(h), CCM CEK-03). Belongs to exactly one Framework. Never assessed directly: it is satisfied through the Controls mapped to it (see **Control Mapping**), and its status for a System is derived, live, from the Control Assessments of the mapped Controls that *apply to that System* — **Met** (covered, and every such Control effectively Fulfilled or inherited), **Partially Met** (some are; also when all are but the Requirement is only Partially covered or is an accepted gap, since acceptance is a library-level judgment, not evidence that the System meets it), **Not Met** (none are), or **Not Applicable** (it has mappings but none of the mapped Controls applies to the System, e.g. only Organizational Controls; excluded from the Compliance Percentage). A Requirement with no mapped Controls at all is **Not Met** (a provisional rule, so an unmapped Framework can't look compliant). Waived / Not Applicable Assessments count as Fulfilled unless the Framework has `strictComplianceRequired`. For licensed standards the catalog holds only the identifier, title, and an own-words paraphrase, never verbatim text; public-domain texts (e.g. EU law) may be quoted.
_Avoid_: Clause, framework requirement (Requirement alone is the canonical term), Control (a different, organization-authored thing — see below)
_Historical note_: before [ADR 0005](docs/adr/0005-split-requirement-and-control.md), "Requirement" meant what is now called **Control**.

**Control**:
A reusable, organization-authored safeguard that satisfies one or more Requirements, potentially from several Frameworks at once ("implement once, satisfy many") — security, privacy, legal, or operational — independent of any specific System. Either a **base Control** (seeded 1:1 from ISO 27001:2022 Annex A) or a **Supplementary Control**. Carries an Applicability — Organizational, Per-System, or Both — and, for Per-System/Both Controls, optional Deployment Facet and Impact Level scoping (independently optional, composed with AND; empty/unset means "applies regardless"). An Organizational Control is implemented once by the Organization (see **Organization Control Implementation**) rather than assessed per System. A mandatory Control applicable to a System must have some Control Assessment recorded before that System can be submitted for review. Which Frameworks a Control serves is expressed only through Control Mappings, never by tagging the Control with Frameworks directly. Each Control has a Control Owner.
_Avoid_: Policy, measure, safeguard (Control is the canonical term)

**Supplementary Control**:
A Control added beyond the ISO 27001 Annex A base because some Framework's Requirement has no base Control covering it (e.g. "notify the national CSIRT of significant incidents within 24h" for Cybersäkerhetslagen). Records its **origin Framework**. Once it exists it is an ordinary Control — other Frameworks' Requirements can map to it too.
_Avoid_: Overlay, overlay control

**Control Library**:
The full set of Controls — base plus Supplementary — available to assess Systems against. Curated centrally, by Compliance Managers, to avoid drift or duplicate/inconsistent controls across Systems.
_Avoid_: Requirement Catalog (its name before [ADR 0005](docs/adr/0005-split-requirement-and-control.md)), Requirement database (the informal name for the whole Framework + Requirement + Control Library + mapping set)

**Control Mapping**:
A many-to-many link between one Requirement and one Control, carrying a **Coverage** of Full or Partial. A Requirement is **covered** when at least one of its mappings has Full coverage; several Partial mappings never add up to Full, so a Requirement with no mappings, or only Partial ones, is a **Coverage Gap** — the trigger for authoring a Supplementary Control (one action creates the Control with its origin Framework and a Full mapping to the Requirement). A Coverage Gap a Compliance Manager has accepted with a justification is an **accepted gap**: shown separately from open gaps, and counted as resolved for coverage metrics. Gaining a Full mapping ends an acceptance (the Requirement is covered).

**Statement of Applicability (SoA)**:
The organization-wide ISO 27001 statement listing every Control in the Control Library with whether it is included, the justification for including or excluding it, and its implementation status. Generated from applicability and assessment data, with exclusion justifications authored by a Compliance Manager.
_Historical note_: before this model, "SoA" was used loosely to mean a System's Framework Scope; it now carries only its proper ISO meaning.

### Implementing and inheriting Controls

**Organization**:
The enterprise itself, as the implementer of Organizational Controls. Single instance while the app is single-tenant.

**Organization Control Implementation**:
The Organization's own status and description of how it implements one Control (e.g. A.5.1 policies, A.6.1 screening). Maintained by that Control's Control Owner, or by a Compliance Manager or an Admin (PRD F-IN.1). Inherited by every System the Control applies to.

**Provider**:
A System that other Systems depend on and inherit Controls from (e.g. a landing zone, a directory service, a central KMS). Publishes Control Offerings. Its offerings count only once the Provider itself is Onboarded. A System declares which Providers it depends on (see [ADR 0008](docs/adr/0008-providers-are-systems.md)).
_Avoid_: Capability (the retired, non-System predecessor), platform, shared service

**Control Offering**:
A Provider's statement that it implements one Control for the Systems depending on it, with an inheritance type of **Full** or **Shared** and, for Shared, a **customer responsibility** text describing what the depending System must still do itself.

**Control Inheritance**:
A System satisfying a Control through someone else's implementation of it rather than its own — from the Organization (an Organization Control Implementation) or from a Provider (a Control Offering). **Full** inheritance covers the Control entirely; **Shared** inheritance still requires the System to address the customer responsibility itself. Inherited status is **live**: it always reflects the source's current status, never a copy taken at declaration time. A System's own Control Assessment can override an inherited one. A Control not inherited at all is **System-specific**.

**Capability** _(retired)_:
Was a standalone, non-System catalog entry (e.g. Active Directory) whose declaration auto-fulfilled mapped Requirements. Replaced by Provider (see [ADR 0008](docs/adr/0008-providers-are-systems.md)).
Until that replacement lands the code still has Capabilities, and a Capability a System declares also fulfils Controls that **become applicable later** (#110): any recompute that makes a Control newly applicable, whether from a classification change, a Framework Scope change or a change to the requirement database, creates its Control Assessment as Fulfilled (marked "Inherited via <Capability>", logged as a `"system"` Change Event) when a declared Capability covers the Control, with exactly the same rules as declaring the Capability: a touched Assessment is never overwritten. When several declared Capabilities cover the Control, the first by name (then id) is credited. *(Glossary change flagged for the product owner: this "fulfils later-applicable Controls too" wording is new.)*

### Assessing

**Control Assessment**:
The fulfillment status of one Control for one specific System (Not Started, In Progress, Fulfilled, Not Applicable, Waived). This is where "does this System implement this Control?" is answered — neither the Control nor any Requirement carries a status of its own; Requirement status for a System is derived from these. Waiving or marking Not Applicable a mandatory Control requires a justification note and is restricted to Risk Owners/Admins — a user holding the System Owner role cannot wave off their own mandatory Control, and a Risk Owner who *owns the System* cannot waive or mark Not Applicable (or answer N/A to the Self-Assessment Question of) one of its **mandatory** Controls either: another Risk Owner or an Admin has to (#97; the API answers 403, and the UI hides those options). An owning Risk Owner may still waive its non-mandatory Controls, and an Admin may waive anything, including on a System they own. Only the System's owner or an Admin may otherwise edit an Assessment or answer its Self-Assessment Question (and submit the System for review); a Risk Owner who isn't the owner may only do the waive/Not Applicable transitions, changing the status and the justification note but never the evidence (the API rejects an evidence change from such a user with 400, #91), and no other role — Reviewer, Viewer, Business Risk Owner, Compliance Manager — may edit at all (#78). Where a Control is inherited, the Assessment shows its source (e.g. "inherited from Azure Landing Zone — Shared") and stays overridable.
An Assessment whose Control no longer applies to the System but which someone already worked on is kept as **stale** (shown under "No Longer Applicable" and counted in the owner's "My tasks") rather than deleted. The System's owner or an Admin can **remove** a stale Assessment (#109; a Compliance Manager stays read-only, everyone else gets 403): its last status, evidence and notes are first recorded in a Change Event (`ASSESSMENT_REMOVED`), so the record survives in the log. Removal is refused (409) while the Control still applies, and while an Assessment Query on it is still open. *(Glossary change flagged for the product owner: removing a stale Assessment, and the Change Event that records it, are new wording here.)*
_Historical note_: called Requirement Assessment before [ADR 0005](docs/adr/0005-split-requirement-and-control.md).

**Self-Assessment Question**:
The question posed to the System's owner for one Per-System/Both Control, answered Yes, No, or N/A. Yes sets the Control Assessment to Fulfilled; No leaves the Assessment open and automatically creates a Risk linked back to it; N/A sets the Assessment to Not Applicable, still subject to the justification/Waiver rule for mandatory Controls.

**Assessment Query**:
A lightweight, non-blocking question/reply thread a Reviewer, Risk Owner, or Admin raises against one specific Control Assessment, without rejecting the whole System (see #56). Purely informational: it never changes the Assessment's status, gates an Approval decision, or affects the mandatory-Control submission check. Made up of one or more **Query Messages** and an explicit `resolved` flag set only by a Reviewer/Risk Owner/Admin (never someone acting only as the System Owner, and not necessarily whoever raised it). Posting a new Query Message on an already-resolved thread reopens it automatically. More than one Assessment Query can be open on the same Assessment at once. Visible to anyone who can already see the System.
_Avoid_: Question (that term means **Self-Assessment Question**), Comment (that's `Approval.comment`)
_Historical note_: called Requirement Query before [ADR 0005](docs/adr/0005-split-requirement-and-control.md).

**Internal Audit**:
An engagement run by an Internal Auditor to verify that one or more Controls actually work, across a selection of Systems (by filter or by hand) and/or the Organization's own implementations. Generates one Check-up per recipient per Control, all sharing the Internal Audit's due date. Ad-hoc only for now; recurring schedules are future work.
_Avoid_: Audit (alone — ambiguous with external certification audits and with Change Event's explicitly-not-an-audit-log scope), campaign, review (Approval's territory)

**Check-up**:
One Control-verification request within an Internal Audit, sent to the System Owner (for a System's Control Assessment) or the Control Owner (for an Organization Control Implementation). Its question defaults to the Control's Self-Assessment Question and can be edited or extended by the auditor. The recipient answers Yes/No/N/A with a free-text description and evidence links; the answer itself never changes any status. The Internal Auditor then evaluates it as **Conforming**, **Observation**, or **Nonconformity**. A Nonconformity automatically opens a Risk linked to the Check-up and sets the targeted Control Assessment (or Organization Control Implementation — which then flows live to every inheriting System) back from Fulfilled to In Progress, attributed to `"system"`.
_Avoid_: Assessment Query (a non-blocking reviewer thread with no formal outcome), Self-Assessment Question (the catalog-authored question a Check-up merely defaults to)

**Continuous Compliance**:
The principle that a System's Control Assessments stay live after onboarding. A change to its classification, Framework Scope, or Providers — or a new Framework or Control reaching it — recomputes its applicable Controls: newly applicable ones get Not Started Assessments (Fulfilled instead when a Capability the System declares covers the Control, #110), no-longer-applicable untouched ones are removed, and no-longer-applicable touched ones are kept as stale for the owner to resolve (by editing it, or by removing it once no Assessment Query on it is open, #109). This never reopens the onboarding Approval or changes the System's status; the newly Not Started Controls (and any stale Assessments) show up in the owner's "My tasks" and in compliance figures. See [ADR 0006](docs/adr/0006-continuous-compliance-replaces-draft-lock.md).

**Compliance Percentage**:
Always for one Framework: the proportion of that Framework's applicable Requirements that are Met, where applicable means every derived status except Not Applicable, and Partially Met counts as not Met. For a given scope (a Business Unit, a Framework, or both combined) it is pooled across every System in that scope that has the Framework in its effective scope (total Met ÷ total applicable, not an average of each System's own percentage), so a System with more applicable Requirements weighs more. A System's own percentage is also shown standalone (on the System page per Framework, and on the Business Risk Owner's portfolio cards). Null, shown as "—", when nothing is applicable. With no Framework filter the headline figure is the **base Framework's**, and the UI says so. A Framework with `strictComplianceRequired` set treats Waived/Not Applicable Control Assessments as not Fulfilled when deriving Met. Until Organization Control Implementation (M3), Requirements satisfied only by Organizational Controls are Not Applicable per System and so not counted (for ISO/IEC 27001: clauses 4–10 and the Annex A Requirements mapped only to Organizational Controls); the UI says "Organizational Requirements aren't counted yet". "Systems in scope of a Framework" means every System for the base Framework (always in scope), and the Systems with a stored Framework Scope row for any other.

### Risk, approval, and people

**Risk**:
A risk identified either ad-hoc (logged directly by the System's owner or any Risk Owner or Admin, matching no predefined Control) or automatically (generated when the System's owner answers a Control's Self-Assessment Question "No," carrying a link back to the originating Control Assessment). Both are otherwise the same record and follow the same lifecycle.
_Avoid_: Issue, finding (when referring to a tracked Risk record specifically)

**Approval**:
A reviewer's recorded decision on a System's onboarding. Approval is a judgment call made by a human reviewer — it is not automatically derived from Control Assessment or Risk status. A reviewer may approve a System despite open gaps, at their discretion.

**Onboarding Lifecycle**:
The sequence a System moves through: Draft (owner is assembling assessments) → In Review (submitted by the owner; requires every applicable mandatory Control to have an Assessment) → Approved or Rejected (a reviewer's Approval decision) → Onboarded. Rejected returns to Draft for revision and resubmission rather than ending the System's record. Approved and Onboarded are distinct: Approved means a reviewer cleared the System to proceed; Onboarded means the actual technical integration/cutover has since been completed, a separate later event triggered by the System's owner or an Admin. Onboarding is a System's first assessment, not its last (see **Continuous Compliance**).

**Control Owner**:
The User accountable for one Control organization-wide. Maintains that Control's Organization Control Implementation. Assigned per Control by a Compliance Manager; any User can hold it, independent of role.

**Compliance Manager**:
A role that curates the requirement database — Frameworks, Requirements, the Control Library, and Control Mappings — assigns Control Owners, and authors Statement of Applicability justifications. Separate from Admin, who manages users, roles, and the remaining catalogs.

**Internal Auditor**:
A role that runs Internal Audits and evaluates Check-up responses. Reads everything; cannot edit Control Assessments, the requirement database, or Risks — independence from what it audits is the point (ISO 27001 clause 9.2). Admins and Compliance Managers can't evaluate Check-ups, since they'd be auditing their own work.

**Business Risk Owner**:
A role scoped to a portfolio of Business Unit(s) and/or Framework(s) it's assigned to (independently — may own Business Units, Frameworks, or both), rather than the full cross-System visibility `Risk Owner` has. Being assigned the base Framework means seeing every System, since the base is in every System's scope. Sees Risks, Compliance Percentage, and a System Portfolio view (Systems in scope grouped by `OnboardingStatus`, each with its compliance-% and open-Risk-count) for Systems within its assigned scope only, filterable by Business Unit and Framework together. Read/reporting-only — does not manage Risk status. Can also drill into a System's own detail page for any System within its assigned scope, any status.
_Avoid_: Scoped Risk Owner (Business Risk Owner is the canonical term)

**Change Event**:
A curated record of one compliance-relevant mutation, feeding the landing page's "Recent updates" feed (see #58). Either System-scoped — a status transition, an Approval decision, a Risk status change, a Control Assessment status change or the removal of a stale one, Assessment Query activity, or a classification/Provider/Business Unit/Framework Scope declare-or-remove — or System-less, for the evidence-bearing parts of the requirement database: a Control Mapping added, removed, or changed in Coverage; a Framework published; a Statement of Applicability justification changed; a Check-up evaluated. Deliberately not a full audit trail — other catalog curation (e.g. editing a Control's text) is out of scope. Attributed to either the acting User, or the literal actor `"system"` when the backend computed the change as a side effect of a different, human-initiated action (e.g. an inherited status change, or a Risk auto-opened by a "No" Self-Assessment answer).
_Avoid_: Audit log, Activity log (this app doesn't claim compliance-grade completeness — "Change Event" is the deliberately narrower term)
