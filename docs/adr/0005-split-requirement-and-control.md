---
status: accepted
amends: 0003-multiselect-deployment-facets-plus-overlays.md
---

# Split "Requirement" into Framework Requirements and organizational Controls

ADR 0003 solved cross-framework duplication at authoring time: one `Requirement` row ("encryption at rest") carried tags for every Framework it satisfied. That was enough while Frameworks were only reporting labels. It stops working once the app becomes a GRC tool, which needs to answer questions per Framework: which NIS2 articles are covered, which only partly, and which have nothing mapped to them. A tag on the organizational row can't say that "A.8.24 fully covers CCM CEK-03 but only partly covers NIS2 Art. 21(2)(h)", or list a Framework's line items that nothing covers yet. The seed data had already drifted towards this split: every `Requirement` row is really an ISO 27001 Annex A *control* (`A.5.1`, `A.8.24` and so on).

We're splitting the concept in two:
- A **Requirement** is now a line item of exactly one Framework, as the standard states it.
- A **Control** is the organization-authored safeguard that Systems are actually assessed against. It is what today's `Requirement` row really is.

A many-to-many **Control Mapping**, with Full or Partial coverage, links the two. ISO 27001:2022 is the base Framework: its Annex A seeds the base Control Library 1:1. Other Frameworks map onto that library, and add **Supplementary Controls** (recording their origin Framework) only where a Requirement would otherwise be a Coverage Gap.

We considered keeping `Requirement` as the name for the unified thing and calling the standard's line item a "Framework Clause". That avoids a large rename (`RequirementAssessment`, `RequirementQuery` and the Self-Assessment Question all hang off it). We rejected it because every GRC tool, auditor and standard uses "requirement" for what the standard demands and "control" for what the organization does about it. Keeping the inverted naming would mean translating in every conversation with a compliance user. The rename is paid once. The inverted vocabulary would cost something every time the app is used.

This amends ADR 0003: its "author once, tag many" idea survives as "implement once, satisfy many" through Control Mappings, but the direct Framework tag on the organizational row goes away. ADR 0003's scoping axes (Deployment Facet, Impact Level) and its hand-authored, no-runtime-crosswalk stance are unaffected.
