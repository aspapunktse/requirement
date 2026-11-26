# OSCAL controls over time: wider use, structured output and proving compliance

Researched 2026-11-26 against NIST's OSCAL v1.2.3 model definitions (the pinned schema in [`src/lib/oscal/schema/`](../../src/lib/oscal/schema/README.md) is byte-for-byte NIST's), NIST's OSCAL concept pages, FedRAMP and OSCAL Compass primary material, and the shipped OSCAL Package pilot (#440–#445, PRs #446–#450). It builds on [`oscal-compliance-as-code.md`](oscal-compliance-as-code.md) and doesn't repeat it.

**Recommendation.** The pilot is a sound base: stable UUIDs (ADR 0017), effective inheritance and a validator. To prove compliance *over time*, the app needs three things it doesn't have yet:

1. **Stored, immutable OSCAL Releases.** Today a package is generated on demand and thrown away.
2. **An assessment layer.** An Assessment Plan and Assessment Results from a closed Internal Audit, then a POA&M from Risks.
3. **Evidence and history as structured records.** Today evidence is free text and Change Event details are prose.

Fix document identity first, since nothing should leave the app before it is fixed: the placeholder `OSCAL_APP_NS`, the `metadata.version` meaning and `document-ids`. Wider reuse comes next: component definitions for the Organization and Providers, Framework catalogs, and a Mapping Collection. It pays off once a recipient asks for it.

## 1. Where the app stands

NIST's latest stable release is still **v1.2.3**. v1.2.0 added the Control Mapping model as an eighth model. [NIST releases](https://github.com/usnistgov/OSCAL/releases) · [Layers overview](https://pages.nist.gov/OSCAL/learn/concepts/layer/overview/)

| OSCAL model (layer) | Emitted today? | App data that feeds it (or could) |
| --- | --- | --- |
| Catalog (control) | **Yes**: the whole Control Library, `catalog.json` | Control `code`, `title`, `description` (one `statement` part, `label` prop) |
| Profile (control) | **Yes**: `include-controls`/`with-ids` only | Applicable Controls, from effective Framework Scope + Control applicability |
| Control Mapping (control) | No | `ControlMapping` (Requirement ↔ Control, Full/Partial, rationale) |
| Component Definition (implementation) | No | Organization Control Implementation, Control Offerings (Full/Shared, `customerResponsibility`) |
| SSP (implementation) | **Yes**: one per System | System, Information Types, owner/BSO, effective status per Control, components for the System, the Organization and Providers |
| Assessment Plan (assessment) | No | Internal Audit (scope, Controls, Systems, frozen questions, due date) |
| Assessment Results (assessment) | No | Check-up responses, evaluations, withdrawals; Self-Assessment answers; `assessedAt`/`assessedBy` |
| POA&M (assessment) | No | Risks (source, status, owner, severity, likelihood, `mitigationPlan`) |

Source: [`package-builder.ts`](../../src/lib/oscal/package-builder.ts), [`prisma/schema.prisma`](../../prisma/schema.prisma), [CONTEXT.md "Exchange (OSCAL)"](../../CONTEXT.md).

### Gaps against the spec in what is emitted today

| Area | What the pilot does | What OSCAL v1.2.3 offers | Matters for |
| --- | --- | --- | --- |
| Document identity | Fresh root `uuid` and `last-modified` per export (correct). `metadata.version` = the **app's** `package.json` version. No `document-ids`, `revisions` or `published` | `version` is "the version of this document". A new version should keep the original's `document-id`. `revisions` lists prior versions. `latest-version`/`successor-version` links build a version graph | Time series: a recipient can't tell two exports of the same System are versions of one document |
| App namespace | `OSCAL_APP_NS = https://requirement.example/ns/oscal` (placeholder, flagged on #440) | Props are namespaced by URI so recipients can tell app semantics from NIST ones | Anything leaving the app |
| Inheritance | By-components per Organization/Provider with app props (`customer-half`, `offering-type`, `provider-half-missing`) | Native `export.provided` / `export.responsibilities` on the provider side, and `inherited` (`provided-uuid`) / `satisfied` (`responsibility-uuid`) on the consumer side. `leveraged-authorizations` for a Provider's own authorization | Machine-readable shared responsibility another tool can follow |
| Provider half text | Always "No implementation description recorded." | `by-component.description` from the Provider's own export | Reviewer can't see what the Provider claims |
| Evidence | Folded into the description as `Evidence: <text>` | `links` and `back-matter.resources` with `rlinks` (`href`, `media-type`, `hashes`) or `base64` content | Proof: evidence can't be followed or checked against a digest |
| Statement level | One response per Control | SSP `statements[]` (`statement-id`) with their own by-components | Only if Controls get multi-part statements; low priority |
| Parameters, tailoring | None. The validator rejects `modify`, `merge`, `include-all`, `exclude-controls` | Profile `set-parameters`, `alter`, `merge` | Per-Framework or per-Boundary tailoring |
| Waived Risk | `risk` prop holds a Risk UUID with no document defining it | The Risk would be defined in an AR or POA&M with the same UUID | Dangling reference until the AR or POA&M exists |
| Categorization | App Sensitivity Level and Integrity/Availability as impact `base`, no categorization system (agreed on #444) | `security-sensitivity-level`, `security-impact-level`, `categorizations` | Only for a recipient that needs FIPS 199 or similar |

Sources: [layers overview, "Important Note to Developers" and "Document Identifiers"](https://pages.nist.gov/OSCAL/learn/concepts/layer/overview/) · [identifier use, "Consistency"](https://pages.nist.gov/OSCAL/learn/concepts/identifier-use/) · [v1.2.3 SSP reference](https://pages.nist.gov/OSCAL-Reference/models/v1.2.3/system-security-plan/json-reference/) · pinned schema definitions `oscal-ssp:by-component`, `oscal-ssp:statement`, `oscal-metadata:metadata`, `oscal-metadata:back-matter`, `oscal-ssp:system-implementation` ([schema README](../../src/lib/oscal/schema/README.md)).

## 2. Using Controls "the OSCAL way" more widely

| Move | OSCAL element | How it maps onto the app | Value / caveat |
| --- | --- | --- | --- |
| **Organization as a component definition** | `component-definition` → `defined-component` (type `policy`/`process`) → `control-implementations[].implemented-requirements` | One document per Organization: each Organization Control Implementation's status and description. Every SSP then *inherits* from it instead of restating it | NIST: component definitions are imported into SSPs and give authors "a starting point". Capability owners publish once for many Systems. Reuses the existing `oscalUuid("Organization", …)` ([NIST Component Definition](https://pages.nist.gov/OSCAL/learn/concepts/layer/implementation/component-definition/)) |
| **Provider Offerings as component definitions (or a Provider SSP `export`)** | `export.provided` + `export.responsibilities` on the Provider. Consumer SSP by-component `inherited.provided-uuid` and `satisfied.responsibility-uuid` | A Full Offering is a `provided` item. A Shared Offering is a `provided` item plus a `responsibility` (`customerResponsibility`). The dependent System's own work `satisfies` it. Providers are Systems (ADR 0008), so the Provider's own SSP can carry the `export` | Replaces today's app props with native linkage. UUIDs derive from the ControlOffering id (ADR 0017 pattern) |
| **Capabilities** | `capability` with `incorporates-components` | Several components that together satisfy a Control, for example "Identity" = directory Provider + Organization process | Optional; only if a recipient wants grouping |
| **A catalog per Framework version** | `catalog` with Requirements as controls, `groups` for sections | One catalog per Published Framework (`name`, `version`, `code`, `section`). Separate from the OSCAL Catalog, which stays the Control Library (CONTEXT.md) | Licensing: `PARAPHRASE_ONLY` Frameworks can carry paraphrase only. Verify redistribution ([ISO copyright](https://www.iso.org/copyright.html)) |
| **Mapping Collection between catalogs** | `mapping-collection` → `mappings[]` → `maps[]` with `relationship`, `sources`, `targets` (`type` `control` or `statement`), `coverage.target-coverage` (0–1), `provenance` (`method` human/automation/hybrid, `matching-rationale` syntactic/semantic/functional, `status`) | Control Library catalog ↔ each Framework catalog from `ControlMapping`. Requirements on several Frameworks mapped to one Control form a derived crosswalk (ISO 27001 ↔ CMMC ↔ Cyber Essentials) | Relationships are set-theoretic: `equivalent-to`, `equal-to`, `subset-of`, `superset-of`, `intersects-with`, `no-relationship`. App Full/Partial does not decide which one applies (earlier research). Each one needs review, or a default agreed with the Framework Owner ([NIST Control Mapping](https://pages.nist.gov/OSCAL/learn/concepts/layer/control/mapping/), [v1.2.3 metaschema](https://raw.githubusercontent.com/usnistgov/OSCAL/v1.2.3/src/metaschema/oscal_mapping-common_metaschema.xml)) |
| **Profiles per Framework / Boundary** | `profile` importing a Framework catalog (or a NIST baseline) with `include-controls`, `set-parameters`, `alter` | A Compliance Boundary's Frameworks become profiles; Boundary Exclusion Justifications become documented exclusions | The validator only supports `include-controls`/`with-ids` today, so this needs a resolver ([NIST profile resolution](https://pages.nist.gov/OSCAL/learn/concepts/processing/profile-resolution/)) |
| **Import third-party catalogs/profiles** | Same models, read instead of written | Load NIST SP 800-53 / FedRAMP baselines or vendor component definitions as Framework content | Fits the existing Framework import loader. FedRAMP Rev5 baselines are published as OSCAL by the OSCAL Foundation ([fedramp-resources](https://github.com/OSCAL-Foundation/fedramp-resources)) |
| **Boundary-level package** | Several SSPs + their profiles + the shared component definitions; the SoA stays the human view | One zip per Compliance Boundary: an SSP per counted System, shared Organization and Provider component definitions, plus the SoA CSV/print | An SSP describes *one* system's authorization boundary. A Boundary is a set of them (earlier research), so there is no single "Boundary SSP" |

## 3. Structured output

**Formats.** OSCAL serializes as JSON, XML and YAML. The JSON Schema also validates parsed YAML. NIST ships XML↔JSON converters ([v1.2.3 release](https://github.com/usnistgov/OSCAL/releases/tag/v1.2.3)). Trestle handles JSON and YAML only, not XML ([compliance-trestle docs](https://oscal-compass.dev/compliance-trestle/latest/)). **Stay JSON-only.** Add YAML only if a trestle-based recipient asks for it.

**Validation.** Keep the two layers the app already has: the pinned schema, then reference checks. Extend them to every new model: AP `import-ssp`, AR `import-ap`, finding targets, observation and risk UUIDs, and `back-matter` resource references. NIST's validation guide separates schema validity from Metaschema constraint validity. The allowed values for `implementation-status`, `relationship` and risk status live in the Metaschema, not in the JSON Schema, so the app needs targeted tests or a constraint-aware validator for them ([NIST validation](https://pages.nist.gov/OSCAL/learn/concepts/validation/)).

**Delivery.**

| Channel | Today | Recommendation |
| --- | --- | --- |
| Zip download per System | Yes (`/api/systems/[id]/oscal-package`) | Keep for people |
| JSON per document | No | `GET …/oscal/ssp.json` etc. for tools, same authz. Cheap once releases are stored |
| Machine (non-browser) access | No: `authenticate` resolves an acting user | Needs a scoped API token model, which is a new security surface. Defer until a real consumer exists |
| Stored release with permalink | No | Core of §5: `/systems/[id]/oscal-releases/[n]` serves the exact bytes released |

**Stable identity.** Per-subject UUIDs derived from record ids (ADR 0017) are what OSCAL asks for: identifiers "should only be changed if the underlying identified subject has changed in a significant way" ([identifier use](https://pages.nist.gov/OSCAL/learn/concepts/identifier-use/)). Extend the same derivation to Risks, observations, findings and POA&M items. NIST defines those as per-subject across revisions (schema descriptions of `risk.uuid`, `poam-item.uuid`). Add a `document-id` per (System, document kind) so each new export is a *version of the same document*. Make `metadata.version` a document version (for example a release counter), and keep the app version where it already is, in the `exporter-version` prop.

**Integrity and signing.** OSCAL has no signature element. It has `hashes` (SHA-224 … SHA3-512) on `rlinks` in back-matter (pinned schema `oscal-metadata:hash`). Recommended:

1. SHA-256 every released document and every attachment.
2. Write a `manifest.json` into the release with the digests.
3. Reference evidence files by `rlink` with their hash.

Detached signatures are a later step. Trestle supports detached signing and verification of JSON artifacts ([trestle docs](https://oscal-compass.dev/compliance-trestle/latest/)).

**Consumers.**

- **Auditors** read the printable review page (exists) and later an AR/POA&M view.
- **GRC tools and trestle** ingest JSON. Trestle 5.x targets OSCAL **1.2.1**, not 1.2.3, so test that it accepts the app's 1.2.3 documents ([trestle docs](https://oscal-compass.dev/compliance-trestle/latest/)).
- **C2P** turns component-definition checks into policy-engine policies and turns engine results back into OSCAL Assessment Results ([compliance-to-policy](https://github.com/oscal-compass/compliance-to-policy)). That is the pattern for automated evidence.
- **FedRAMP** is covered in §4.

## 4. Use cases, ranked

| # | Use case | Who benefits | Needs |
| --- | --- | --- | --- |
| 1 | **Certification / external audit handoff** (ISO 27001 surveillance, CMMC assessment): "here is the SSP, what we tested, what we found and what we are fixing, as of date X" | Compliance Manager, Internal Auditor, external auditor | Releases, AP/AR from Internal Audits, evidence links |
| 2 | **Proving compliance over time**: show that a Control was Fulfilled and verified across the audit period, not just today | Boundary Owner, Compliance Manager, Business Risk Owner | Releases, AR series, structured status history |
| 3 | **Supplier and Provider assurance**: a Provider publishes what it provides and what the customer still owes; dependents inherit it | System Owners of dependents, Providers | Component definition / `export` |
| 4 | **Customer trust / questionnaires**: answer security questionnaires from one SSP plus the mapping to the customer's framework | Sales/Trust, Compliance Manager | Framework catalogs + Mapping Collection, release permalink |
| 5 | **Cross-framework reuse**: show ISO 27001 ↔ CMMC ↔ Cyber Essentials coverage from one Control Library | Framework Owner, Compliance Manager | Mapping Collection |
| 6 | **Regulator / government submission**: FedRAMP Rev5 is moving to machine-readable packages with OSCAL as *one* approved format (proposed: required for new submissions from 2026-09-30). The RFC says it doesn't apply to FedRAMP 20x | Only if the organization sells to US federal agencies | NIST 800-53 baseline profile, FedRAMP-specific constraints ([RFC-0024](https://www.fedramp.gov/rfcs/0024)) |
| 7 | **Automation / CI checks**: a policy check writes an observation, the app reads AR results in | Engineering, System Owners | AR import, C2P-style pipeline |
| 8 | **AI-assisted review**: a reviewer agent reads a structured SSP+AR to spot unsupported claims and stale evidence | Internal Auditor | Any structured package; evidence `expires` makes staleness computable |

## 5. Proving compliance over time

### How OSCAL models time

OSCAL documents are **snapshots**. Time comes from a chain of documents and from timestamps inside the assessment layer.

| Element | What it records about time | Source |
| --- | --- | --- |
| SSP `metadata.last-modified`, `version`, `revisions[]`, `document-ids` | Which version of the plan was in force. The root UUID changes on every content change; `document-id` stays | [Layers overview](https://pages.nist.gov/OSCAL/learn/concepts/layer/overview/); schema `oscal-metadata:revision` (`version` required) |
| AP `tasks[].timing` | `on-date`, `within-date-range`, `at-frequency`. NIST says the plan can "specify clear continuous monitoring parameters, such as frequency" | [NIST AP](https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/assessment-plan/); schema `assessment-common:task` |
| AR `results[]` (1..n), each with required `start`, optional `end`, required `reviewed-controls` | One result per assessment period or run. NIST says that in continuous monitoring `end` "may contain the same value as start" | Schema `oscal-ar:result`; [NIST AR](https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/assessment-results/) ("allows organizations to report continuous assessment information") |
| Observation `collected` (required), `expires` | When evidence was gathered, and when it goes stale ("Typically used with continuous assessment scenarios"). `methods` EXAMINE/INTERVIEW/TEST. `origins` (party/tool). `relevant-evidence[].href` | Schema `assessment-common:observation`; [assessment-common metaschema](https://raw.githubusercontent.com/usnistgov/OSCAL/v1.2.3/src/metaschema/oscal_assessment-common_metaschema.xml) |
| Finding `target` (`statement-id`/`objective-id`) `status.state` satisfied / not-satisfied, `related-observations`, `related-risks` | The judgment at that time | Schema `assessment-common:finding`, `finding-target` |
| Risk `status`, `deadline`, `remediations[].lifecycle` (recommendation/planned/completed), `risk-log.entries[]` (`start`, `end`, `status-change`) | Remediation timeline. Risk status: open, investigating, remediating, deviation-requested, deviation-approved, closed | Schema `assessment-common:risk`; metaschema risk-status values |
| POA&M `poam-items[]`, shared observation/risk syntax with AR, `import-ssp` or `system-id` | Open weaknesses carried between assessments. Its observation and risk syntax is "identical" to AR's, so a Risk keeps its UUID from AR to POA&M | [NIST POA&M](https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/poam/) |

So a time series is: **SSP v1 → AP → AR (result 1) → POA&M v1 → SSP v2 → AR (result 2) → POA&M v2 …**. Stable per-subject UUIDs let a reader join Control X, Risk Y and the System across all of them.

### How the app's records map onto it

| App record | OSCAL element | Notes / decisions needed |
| --- | --- | --- |
| Internal Audit (draft → launched → closed) | **AP**: `reviewed-controls` from InternalAuditControl, `assessment-subjects` from InternalAuditSystem (the System's component), a task with `within-date-range` to `dueDate`, questions as activity steps. **AR**: one `result`, `start` = `launchedAt`, `end` = `closedAt` | One audit spans many Systems and maybe the Organization. Emit per System against its SSP (earlier research) |
| Check-up response (answers, `evidenceLinks`, `respondedAt`, responder) | **Observation**: `methods` INTERVIEW (plus EXAMINE when evidence is linked), `origins` party = responder, `collected` = `respondedAt`, `relevant-evidence` = links | The response can be edited (`updatedAt`) until evaluation. Use the value at evaluation time |
| Check-up evaluation (Conforming / Observation / Nonconformity, comment, evaluator, `evaluatedAt`) | **Finding**: target `statement-id` `<control>_smt` (exists in the catalog), state satisfied (Conforming) / not-satisfied (Nonconformity), `origins` party = Internal Auditor | **Observation outcome**: satisfied plus an observation of type `mitigation`/`discovery`, or not-satisfied? PO decision |
| Check-up withdrawal | No finding; result `remarks` or a prop with the reason | Keeps the audit trail honest |
| Self-Assessment answer, Control Assessment `assessedAt`/`assessedBy` | A separate AR `result` ("System Owner self-assessment"), observation `origins` = System's owner | Lower assurance than an audit. Keep it as its own result, never merged |
| Risk (`AUDIT_FINDING`, `REQUIREMENT_NONCONFORMANCE`, `AD_HOC`) | AR `risks[]` + **POA&M** `poam-items[]`, `related-risks`. UUID `oscalUuid("Risk", id)` (already used by the SSP's Waived prop) | Status mapping is a PO decision (MITIGATED, ACCEPTED, TRANSFERRED have no direct OSCAL value; ACCEPTED ≈ `deviation-approved`?). No `deadline` or milestones in the data model |
| `RISK_STATUS_CHANGED`, `ASSESSMENT_STATUS_CHANGED` … Change Events | `risk-log.entries` (`start`, `status-change`); SSP `revisions[].remarks` | Change Event `detail` is a prose string, and CONTEXT says it is "explicitly not an audit log". Usable as a narrative, not as a reliable machine source |
| Requirement gap acceptance (`gapAcceptedAt`), Boundary Exclusion Justification | SoA (human view); possibly Profile `exclude` with justification in a Boundary profile | Stays in the SoA for now |
| StatSnapshot (daily, per **User** dashboard figures) | None directly | Not per System or Framework. A per-System Compliance Percentage series would need its own snapshot |
| `SystemDocumentFile` (bytes), `SystemDocument.link`, Assessment `evidence` text | `back-matter.resources` (`rlinks` with `hashes`, or `base64`) | Replaceable uploads can't reproduce a past evidence bundle (earlier research). A release must freeze the digest, or the bytes |

### Proposed shape: the OSCAL Release

- An **OSCAL Release** is a stored, immutable copy of one package, with its own number, created at a moment that matters. Examples: an Internal Audit closing, a Boundary's certification audit, a quarterly cut, a manual "release now".
- It holds the exact JSON bytes plus a `manifest.json` with SHA-256 per file. Each document keeps its `document-id` and appends to `metadata.revisions`.
- A release never changes; a correction is a new release. Comparing release *n* with *n-1* gives "what changed and why": scope (Profile diff), implementation (SSP diff) or evidence (AR diff). That is what the earlier research's posture brief needs.
- This reverses the agreed rule that packages are "generated on demand and not stored" (CONTEXT.md). It needs a PO decision and probably an ADR.

## 6. Missing pieces (prioritized)

| P | Piece | Enables (OSCAL) | Size | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **Real `OSCAL_APP_NS` URI, `document-ids`, document `version` semantics, `revisions`** | Recipients can follow versions; safe external use | S | PO picks a URI the organization controls |
| 2 | **Stored OSCAL Releases** (table + bytes or object storage, manifest with SHA-256, permalink, list on System page) | Immutable time series; reproducible past packages | M | 1; ADR reversing "not stored"; retention decision |
| 3 | **Assessment Plan + Assessment Results from a closed Internal Audit** (per System) | AP `import-ssp`, AR `results`, observations, findings, risks | M–L | 2 (AP must reference a *stored* SSP); validator extended to AP/AR |
| 4 | **Evidence as records** (structured links with type, collected date, optional expiry; file digests; `ControlAssessment.evidence` text → links) | `back-matter` resources with `hashes`, `relevant-evidence`, observation `collected`/`expires`; evidence freshness | M | Migration + backfill of free-text evidence; freshness rule from PO |
| 5 | **POA&M from Risks** (+ Risk `deadline`, remediation milestones, structured status history) | `poam-items`, `risk.deadline`, `remediations`, `risk-log` | M | 3 for shared Risk UUIDs; status mapping decision; new Risk fields |
| 6 | **Structured status history for Control Assessments** (who/when/from/to as data, not Change Event prose) | SSP revisions with reasons; AR self-assessment results over time; "Fulfilled throughout the period" | M | Decide: structured Change Event payload vs a history table |
| 7 | **Native inheritance**: Organization and Provider component definitions / Provider SSP `export`; consumer `inherited`/`satisfied` | Component Definition model; machine-readable shared responsibility | M | 1; replaces some app props (a breaking change for recipients, so do it before external use) |
| 8 | **Per-System, per-Framework compliance snapshots** (extend the daily cron) | Trend lines in the posture brief; corroborates AR series | S–M | None |
| 9 | **Framework catalogs + Mapping Collection** | Catalog per Framework, `mapping-collection`, cross-framework reuse | M | Licensing check per Framework; relationship review with Framework Owners |
| 10 | **Boundary-level package / release** | Set of SSPs + shared component definitions + SoA | M | 2, 7 |
| 11 | **Recurring Internal Audits** (already "future work" in CONTEXT) | AP `timing.at-frequency`; continuous assessment | M | 3 |
| 12 | **Machine access** (JSON per document; scoped tokens) | Tool and CI ingestion; C2P-style pipelines | M | Security design; a named consumer |
| 13 | **AR import** (read observations from a policy engine or C2P) | Automated evidence | L | 3, 4, 12 |
| 14 | Profile tailoring / parameters / statement-level responses | `set-parameters`, `alter`, SSP `statements` | L | Resolver; only if a recipient needs it |
| 15 | Detached signatures | Tamper evidence beyond hashes | S | 2 |

**Suggested issue split** (not filed):

- **A: Document identity** (1). One small PR.
- **B: OSCAL Release PRD**, with slices:
  - storage + manifest + permalink (2);
  - System page release list + diff view;
  - per-System compliance snapshots (8).
- **C: Assessment layer PRD**, with slices:
  - validator for AP/AR;
  - AP from a closed audit;
  - AR (observations + findings);
  - review page for AR;
  - self-assessment result.
- **D: Evidence records** (4), before or alongside C's AR slice.
- **E: Risk remediation + POA&M** (5, 6).
- **F: Inheritance as components** (7), then **G: Framework catalogs + Mapping Collection** (9), then **H: Boundary release** (10).
- 11–15 stay in the backlog until a recipient asks.

## 7. Open questions for the product owner

1. **Who is the first external recipient**, and what do they need? Certification body, customer, Provider or regulator. This decides whether A–C or F–G come first.
2. **Store releases?** Reversing "generated on demand, not stored" needs an ADR. When is a release cut (audit close, quarterly, manual)? How long is it kept? Who may cut one?
3. **Freeze evidence bytes or only digests** in a release? Bytes make a release fully reproducible but copy files, so retention and privacy apply.
4. **Which URI** will the app's OSCAL namespace use? It must never change afterwards.
5. **Check-up "Observation" outcome**: satisfied with a noted weakness, or not-satisfied?
6. **Risk status mapping** to OSCAL (MITIGATED, ACCEPTED, TRANSFERRED). Should Risks gain a deadline and milestones?
7. **Self-assessments in AR**: include them as a separately labelled result, or keep AR to Internal Audits only?
8. **Evidence freshness**: should evidence carry an expiry (observation `expires`), and is it set per Control or per evidence type?
9. **Framework catalogs**: which Frameworks may be redistributed as OSCAL (licensing), and who signs off each mapping relationship?
10. **FedRAMP / NIST 800-53**: is US federal business in scope at all? If not, FedRAMP constraints can be ignored.

## 8. Sources

**NIST OSCAL**
- Releases (v1.2.3 latest; Control Mapping added in v1.2.0): https://github.com/usnistgov/OSCAL/releases · https://github.com/usnistgov/OSCAL/releases/tag/v1.2.3
- Pinned v1.2.3 JSON Schema (definitions for `oscal-ar:result`, `assessment-common:observation`/`finding`/`finding-target`/`risk`/`task`, `oscal-poam:*`, `oscal-mapping*`, `oscal-component-definition:*`, `oscal-ssp:by-component`/`statement`, `oscal-metadata:metadata`/`back-matter`/`hash`): [`src/lib/oscal/schema/oscal_complete_schema.json`](../../src/lib/oscal/schema/README.md) (SHA-256 recorded in the README)
- Layers and document identity: https://pages.nist.gov/OSCAL/learn/concepts/layer/overview/
- Identifier use: https://pages.nist.gov/OSCAL/learn/concepts/identifier-use/
- Validation: https://pages.nist.gov/OSCAL/learn/concepts/validation/
- Profile resolution: https://pages.nist.gov/OSCAL/learn/concepts/processing/profile-resolution/
- Component Definition: https://pages.nist.gov/OSCAL/learn/concepts/layer/implementation/component-definition/
- Control Mapping: https://pages.nist.gov/OSCAL/learn/concepts/layer/control/mapping/ · v1.2.3 reference https://pages.nist.gov/OSCAL-Reference/models/v1.2.3/mapping/json-reference/
- Mapping-common metaschema (relationship values): https://raw.githubusercontent.com/usnistgov/OSCAL/v1.2.3/src/metaschema/oscal_mapping-common_metaschema.xml
- Implementation-common metaschema (implementation-status values): https://raw.githubusercontent.com/usnistgov/OSCAL/v1.2.3/src/metaschema/oscal_implementation-common_metaschema.xml
- Assessment-common metaschema (observation types, methods, origin actors, risk status): https://raw.githubusercontent.com/usnistgov/OSCAL/v1.2.3/src/metaschema/oscal_assessment-common_metaschema.xml
- Assessment Plan: https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/assessment-plan/
- Assessment Results: https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/assessment-results/ · outline https://pages.nist.gov/OSCAL-Reference/models/v1.2.3/assessment-results/json-outline/
- POA&M: https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/poam/ · outline https://pages.nist.gov/OSCAL-Reference/models/v1.2.3/plan-of-action-and-milestones/json-outline/
- SSP reference: https://pages.nist.gov/OSCAL-Reference/models/v1.2.3/system-security-plan/json-reference/

**FedRAMP**
- RFC-0024, Rev5 machine-readable packages (proposal; OSCAL one approved format; not 20x): https://www.fedramp.gov/rfcs/0024
- FedRAMP 20x Key Security Indicators: https://www.fedramp.gov/docs/20x/key-security-indicators/
- OSCAL Foundation FedRAMP resources (Rev5 baselines, SSP example; SAP/SAR/POA&M examples pending): https://github.com/OSCAL-Foundation/fedramp-resources

**OSCAL Compass (CNCF)**
- compliance-trestle docs (models, CI pattern, detached signing, targets OSCAL 1.2.1): https://oscal-compass.dev/compliance-trestle/latest/ · repo https://github.com/oscal-compass/compliance-trestle (v5.2.1, 2026-11-10)
- Compliance-to-Policy (component definition → policies → OSCAL Assessment Results): https://github.com/oscal-compass/compliance-to-policy

**Repository**
- [`oscal-compliance-as-code.md`](oscal-compliance-as-code.md), [ADR 0017](../adr/0017-oscal-identifiers-derive-from-record-ids.md), [ADR 0008](../adr/0008-providers-are-systems.md), [ADR 0016](../adr/0016-compliance-boundaries-bring-frameworks-into-scope.md), [CONTEXT.md](../../CONTEXT.md)
- [`package-builder.ts`](../../src/lib/oscal/package-builder.ts), [`ids.ts`](../../src/lib/oscal/ids.ts), [`validate.ts`](../../src/lib/oscal/validate.ts), [download route](../../src/app/api/systems/[id]/oscal-package/route.ts), [`stat-snapshots.ts`](../../src/lib/stat-snapshots.ts), [`prisma/schema.prisma`](../../prisma/schema.prisma)
- Issues #440–#445, PRs #446–#450

**Could not verify**
- `github.com/GSA/fedramp-automation` returned 404 on 2026-11-26, and `automate.fedramp.gov` did not resolve. A search snippet says the site was halted in early 2025 and archived, and NIST's April 2026 workshop deck points to the OSCAL Foundation as the new home. Neither claim was checked at the source, so this document leans on the OSCAL Foundation repository and RFC-0024 only.
- Whether OSCAL is required or merely accepted under FedRAMP 20x: RFC-0024 excludes 20x, and the 20x pages fetched did not settle it.
- Whether trestle 5.x accepts OSCAL 1.2.3 documents, given that its docs say 1.2.1: untested.
