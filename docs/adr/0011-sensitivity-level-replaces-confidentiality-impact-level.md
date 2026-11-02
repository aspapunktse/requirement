---
status: accepted
amends: 0003-multiselect-deployment-facets-plus-overlays.md
---

# Sensitivity Level replaces the Confidentiality Impact Level

We want everyone to see, from a colour, what information a System may hold, and we want more sensitive information to bring in more Controls (for example step-up authentication from Highly Sensitive up). That is exactly what the Confidentiality axis of Impact Level was for: a self-declared ordinal level with Control thresholds on it. Keeping both would let a System be "Highly Sensitive" with "Confidentiality: Low", and the two would drift apart.

So a System now declares one **Sensitivity Level** on a fixed, ordered scale of five (Public, Internal, Sensitive, Highly Sensitive, Critical Sensitivity), and Impact Level keeps only Integrity and Availability. A Control's minimum Confidentiality Impact Level becomes a minimum Sensitivity Level, filtered in the same way and combined with AND with its Facet and Impact scoping. Existing values are migrated Low→Internal, Moderate→Sensitive, High→Highly Sensitive, Critical→Critical Sensitivity, and unset stays unset. Nothing migrates to Public. A System can't be submitted for review until its level is set.

The five levels are fixed. An Admin can change each one's label, description and colours, but can't add, remove or reorder levels, because that would silently change which Controls apply to every System. The colours mean the same in every theme: only the light/dark mode changes them.

## Considered options

- **Keep both, side by side**: rejected, because two confidentiality scales on one System invite contradictions and double the Control scoping.
- **Recolour the Confidentiality axis and grow it to five values**: rejected, because Integrity and Availability share that scale and would have gained a "Public" value that means nothing for them.
- **Classify Information Types and derive the System's level from them**: deferred, not rejected. A catalogue of Information Types, each with a Sensitivity Level, can later drive the System's level without changing this model.
