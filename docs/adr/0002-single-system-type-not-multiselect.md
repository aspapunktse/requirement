---
status: accepted
---

# Single System Type per System, not a multi-select combination

A System's applicable Requirement set is derived from its System Type. We considered letting a System declare multiple System Types at once (e.g. "On-Premises Datacenter" + "Processes Payment Data") and unioning their Requirement mappings, but decided a System declares exactly one System Type, with Hybrid modeled as its own dedicated, admin-curated catalog entry rather than a computed union of other types' mappings. This avoids the combinatorial explosion of type combinations and the ambiguity of reconciling overlapping or conflicting Requirement mappings when several Types would otherwise apply at once — instead, whoever curates the Requirement Catalog decides explicitly what a Hybrid system needs. The trade-off is that a genuinely new axis of variation (e.g. hosting model and data sensitivity as independent choices) requires the catalog admin to hand-author every needed combination as its own System Type, rather than the app composing them automatically.
