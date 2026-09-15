---
status: accepted
---

# Promote Framework from a free-text Requirement tag to a first-class catalog entity

`Requirement.framework` was a bare `String[]` free-text tag (see #52's "author once, tag many" model). #55 needed two new things that a free-text tag can't support: a per-framework `strictComplianceRequired` flag (some frameworks — e.g. CMMC — only accept 100% Fulfilled when computing compliance percentage, no partial credit for Waived/Not Applicable), and a second, independent relation from the *System* side — which Framework's audit/certification boundary a System falls within (its "Framework Scope," e.g. "this System is in ISO scope but not CMMC scope"). Both needed a real row to attach to, not a string.

We considered keeping `framework` as a tag and adding a separate `Scope` entity for the System-side relation, decoupled from the Requirement-tagging concept. We rejected this: "ISO scope" and "the ISO 27001:2022 Annex A framework tag" are conceptually the same real-world thing (an ISO 27001 certification effort), and a second table with the same shape (name, description) and no distinct fields of its own would just be the same catalog duplicated under a different name. Instead, `Framework` is one catalog entity with two independent many-to-many relations off it: `Requirement.frameworks` (which Requirements count toward it — the original tagging relation, now a real FK) and `System.frameworkScopes` (which Systems are in its audit boundary — new). A System can be in a Framework's scope without any of its Requirements needing to be tagged with that Framework, and vice versa; the two relations compose only where a caller (the compliance-percentage calculation) explicitly intersects them.

This is a breaking, hand-written data migration (see `prisma/migrations/20260915120000_add_business_unit_and_framework_entity/migration.sql`): every distinct existing `framework` string value becomes a `Framework` row, and every Requirement's tags become `_FrameworkToRequirement` join rows, before the free-text column is dropped.
