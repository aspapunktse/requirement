---
status: accepted
amends: 0003-multiselect-deployment-facets-plus-overlays.md
---

# Continuous compliance replaces the Draft-only classification lock

ADR 0003 locked a System's classification (Deployment Facets, Regulatory Overlays, Impact Levels, and Capabilities) to Draft. That was one consistent cutoff for a one-off onboarding check. As the app grows into a GRC tool, Systems live for years after onboarding, and the things that decide what applies to them keep changing: a System moves from on-prem to cloud, a new law such as Cybersäkerhetslagen brings it into scope, or its data becomes more sensitive. Under the Draft lock none of this can be recorded without rebuilding the System, so the app's picture of compliance goes silently wrong.

We're removing the lock. Classification, Framework Scope and Provider dependencies can change at any lifecycle stage. Every change goes through the same recompute that Draft changes already use:
- newly applicable Controls get Not Started Assessments,
- untouched no-longer-applicable ones are removed,
- touched no-longer-applicable ones are kept as stale.

A change after onboarding does **not** reopen the onboarding Approval. Onboarding becomes a System's first assessment, and the gaps a later change opens show up in compliance figures and task lists instead of blocking the System.

We considered keeping the lock and requiring a formal "re-onboarding" to change classification. We rejected it because it turns routine drift into a heavyweight workflow. Owners would avoid that workflow, and the result would be exactly the stale data a GRC tool exists to prevent.
