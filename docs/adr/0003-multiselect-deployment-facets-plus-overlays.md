---
status: accepted
supersedes: 0002-single-system-type-not-multiselect.md
---

# Multi-select Deployment Facets, plus a separate Overlay layer, replacing single-select System Type

ADR 0002 chose a single System Type per System, with Hybrid modeled as its own dedicated, hand-curated catalog entry, to avoid the ambiguity of reconciling overlapping Requirement mappings when several Types would otherwise apply at once. In practice this made Hybrid unusable: a System spanning on-prem and cloud needs the union of two full frameworks (e.g. ISO 27001 + CIS 8 for the on-prem part, CSA CCM 4.0 for the cloud part), and hand-authoring that union from scratch for every hosting-model combination was exactly the cost ADR 0002 accepted — nobody has ever actually created a Hybrid System Type, because doing so means re-deriving two frameworks' worth of Requirements by hand instead of simply getting what On-Prem and Cloud already define.

Separately, real onboarding needs Requirement sets to grow along axes that have nothing to do with hosting model at all — GDPR when a System processes EU personal data, export-control regimes like EAR/ITAR, and impact-driven requirements tied to how sensitive the System's data or downtime actually is. These axes are independent of each other and of deployment: a System can be Cloud-hosted, GDPR-relevant, and Availability-Critical all at once, each pulling in its own additional Requirements.

We're replacing System Type's single-select model with two separate mechanisms:

**Deployment Facet** (was System Type): a System now declares *one or more* facets (e.g. On-Prem, Cloud) instead of exactly one Type. Hybrid stops being a dedicated catalog entry — it's simply a System with both facets selected, and its applicable Requirement set is the union of what each declared facet requires. This is the multi-select approach ADR 0002 explicitly rejected, but the reconciliation problem it was rejected to avoid is solved differently now (see below), so the trade-off no longer applies.

**Overlay**: a second, independent classification layer applied on top of the facet-derived base set, of two kinds — **Regulatory Overlay** (GDPR, EAR/ITAR, ...), a boolean flag a System Owner self-declares at onboarding, the same way Capabilities are declared today; and **Impact Level**, an ordinal Confidentiality/Integrity/Availability triad sharing one common Low/Moderate/High/Critical scale, replacing the current unenforced free-text `dataClassification` field. A Requirement can be scoped to require a minimum Impact Level on any of the three axes, in addition to (or instead of) facet/overlay scoping.

The reconciliation problem ADR 0002 was avoiding — two frameworks defining "the same" control under different names — is solved at authoring time, not computed at assessment time: a Requirement Catalog entry is tagged with every framework, facet, and overlay it belongs to (a single "encryption at rest" Requirement can carry ISO 27001, CIS 8, *and* CSA CCM 4.0 tags, scoped to the facets and overlays each framework actually requires it for), rather than each framework getting its own separately-authored, potentially-duplicate copy of the same control. Where a control's evidence expectations genuinely differ by facet (e.g. on-prem disk encryption vs. a cloud KMS policy), that's guidance text within the one Requirement, not a second row. The catalog stays hand-authored, the same process used for the ISO 27001 Annex A seed — this decision doesn't depend on importing an external crosswalk.

This supersedes ADR 0002 and the "a System always has exactly one System Type" invariant it produced.
