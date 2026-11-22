---
status: accepted
amends: 0007-framework-scope-drives-applicability.md
---

# Compliance Boundaries bring Frameworks into scope; each Boundary has its own Statement of Applicability

One System can serve several perimeters at once. A Business Unit may use the same System inside its CMMC Level 1 FCI boundary, inside its ISO 27001 ISMS scope, and for a UK contract that requires DEF STAN 05-138 and Cyber Essentials. Until now a System had one flat Framework Scope and the organization had one ISO 27001 Statement of Applicability (SoA), so the app could not say which perimeter a System belongs to or produce a statement for each one. The terms are in `CONTEXT.md` (grilled with the product owner on 2026-11-22).

We are adding the **Compliance Boundary**: a named set of Systems held to one or more Published Frameworks, optionally held by a Business Unit, with a Boundary Owner. These are the rules:

- A System's **effective Framework Scope** is the Frameworks it declares, plus the Frameworks of every Boundary it is in. Joining or leaving a Boundary, or a Boundary gaining or dropping a Framework, is a scope change. It recomputes applicability (ADR 0006) and starts a Change Review on an Onboarded System.
- A declared Framework outside any Boundary means the System is **prepared for** that Framework. That is a normal state, not a gap.
- The **base Framework stays in every System's scope** for applicability. Whether a System is in the ISO 27001 *statement* is a Boundary membership like any other.
- A System keeps **one Control Assessment per Control**, whichever Boundaries read it. The Organization's implementation of a Control is likewise one record, read by every Boundary.
- Each Boundary has **its own SoA**, with one section per Framework. Each section lists that Framework's Requirements, not the Controls. A Requirement's inclusion is derived from applicability and can't be overridden. Its status is the worst across the Boundary's counted Systems (those with an ATO or Onboarded). Exclusion justifications are stored per Boundary and Requirement, not per Control.
- The existing organization-wide SoA becomes a seeded "ISMS scope (ISO 27001)" Boundary holding every current System. Each Control's exclusion justification moves to that Boundary's Annex A Requirement for the same Control.

## Considered options

- **A Boundary as a reporting perimeter only, separate from Framework Scope**: rejected. A System could then sit in the CMMC boundary without CMMC applying to it. That is the drift ADR 0007 removed.
- **Boundaries replace declared Framework Scope**: rejected. A law such as GDPR applies with no contract involved and would need a pseudo-Boundary, and "prepared for" could not be expressed.
- **Drop "base Framework always in scope"**: rejected for now. Annex A is the Control Library's spine. Dropping it would change the Compliance Percentage headline and what a Business Risk Owner sees for the base Framework.
- **Per-Boundary Assessments, or per-Boundary Organization implementations**: rejected. Either one multiplies the owner's work, breaks inheritance and gives up "implement once, satisfy many".
- **Average status across a Boundary's Systems**: rejected. An average hides the one non-compliant System that an assessor looks for.

## Consequences

- One change to a Boundary's Frameworks fans out to every member System: Change Events, recomputes and possibly a Change Review on each one.
- A Framework that comes in only through a Boundary leaves a System's scope only when the System leaves that Boundary. The System's owner can't remove it.
- Because the SoA's rows move from Controls to Requirements, its exclusion justification moves off `Control`. That needs a data migration with a read-only pre-check.
