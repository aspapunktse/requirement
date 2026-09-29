---
status: accepted
amends: 0003-multiselect-deployment-facets-plus-overlays.md, 0004-framework-as-first-class-entity.md
---

# Framework Scope drives applicability; Regulatory Overlay is retired

Before this, two overlapping mechanisms said "this System is subject to X":
- **Regulatory Overlay**, a flag (GDPR, EAR/ITAR) that scoped which Requirements applied (ADR 0003);
- **Framework Scope**, a reporting-only "audit boundary" relation (ADR 0004).

Once Frameworks carry real Requirements mapped to Controls (ADR 0005), "this System processes EU personal data" and "GDPR is in this System's scope" are the same statement, and keeping both invites them to disagree.

We're merging them. A System's Framework Scope now **drives** which Controls apply to it: the Controls mapped to Requirements of every Framework in scope, still filtered by each Control's Deployment Facet and Impact Level scoping. The base Framework (ISO 27001) is always in scope. Regulatory Overlay is retired, and each existing overlay becomes a Framework.

This reverses ADR 0004's statement that Framework Scope is "a reporting dimension only". It is safe to reverse now because ADR 0006 removed the Draft lock, which is what originally forced reporting-only relations to be kept separate from classification-driving ones.
