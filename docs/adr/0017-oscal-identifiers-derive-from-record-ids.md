---
status: accepted
---

# OSCAL identifiers are derived from record ids, not stored

OSCAL requires a UUID for every System, Control, party and component in an OSCAL Package, and the same thing must keep the same UUID across exports so a recipient can follow it from one package to the next. The app's records have CUIDs. We derive each OSCAL UUID from the record's CUID as a name-based UUID (version 5) under one fixed namespace that belongs to the app, so every export gives the same UUID for the same record without any schema change. The CUID itself never appears in a package. *(Agreed with the product owner 2026-11-23, from `docs/research/oscal-compliance-as-code.md`.)*

## Considered options

- **A stored `uuid` column on each exported model**: rejected for now. It needs a migration and a backfill on every exported table, and gives nothing a derived UUID doesn't while packages are generated on demand.
- **Random UUIDs per export**: rejected. A recipient could not tell that two packages describe the same System or Control.

## Consequences

- The namespace UUID must never change once a package has left the app; changing it gives every record a new identity.
- A record that is deleted and recreated gets a new CUID and so a new OSCAL UUID. Document UUIDs are a separate matter: each generated document gets a fresh one, as OSCAL expects for changed content.
