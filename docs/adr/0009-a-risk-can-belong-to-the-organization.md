---
status: accepted
---

# A Risk can belong to the Organization, and a Nonconformity overrides inherited status

A Risk always belonged to a System: it was logged on one, or auto-opened from a "No" answer to one System's Self-Assessment Question. An Internal Audit **Nonconformity** on the Organization's own implementation of a Control has no System to belong to. The finding is about how the Organization implements the Control, and every System that inherits a Both Control, or counts an Organizational one, is affected only through live inheritance.

A Nonconformity on an Organization-level Check-up therefore opens **one Organization Risk** with no System, linked to the Check-up (a Nonconformity on a System-level Check-up still opens an ordinary Risk on that System, also linked to its Check-up). We considered copying the Risk onto every inheriting System and rejected it: N copies drift apart as owners edit them and inflate each System's Risk list with something that is not that System's own. We also rejected a placeholder "Organization" System, which would pollute every System list, count and compliance figure with something that is not a System. The product owner decided this on 2026-10-12 (comment on #157).

The consequences run through every Risk reader. Each handles a missing System: a Risk Owner's tasks label it "Organization", and the Business Risk Owner's scoped views, being per System, never show one. Organization Risks are managed on their own page, `/risks/organization`, by Risk Owners and Admins (status, mitigation plan, owner) and read by the Internal Auditor. A database CHECK keeps every Risk tied to a System or a Check-up, never neither, and a Check-up opens at most one Risk.

The other half of the decision is the **set-back**. A Nonconformity sets a Fulfilled target to In Progress as the System's or the Organization's own status, attributed to `"system"`. The System's Assessment is kept **person-set** (an existing assessor stays; otherwise the evaluating Internal Auditor is recorded), because an Assessment nobody set follows its sources and live inheritance would silently restore Fulfilled. For the same reason a System that was Fulfilled only through inheritance gets its own In Progress status written, overriding the source, so the Control stops counting as Fulfilled for it. An Organization-level set-back reaches the inheriting Systems live, with the usual events. **Reset to inherited** remains a deliberate, logged way back for the System's owner or an Admin (decisions 21b to 25a of 2026-10-13, comment on #157).
