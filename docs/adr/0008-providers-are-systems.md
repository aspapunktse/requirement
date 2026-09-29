---
status: accepted
---

# Providers are Systems; Capability is retired

Capability was a standalone catalog entry (e.g. Active Directory, central KMS). Declaring one fully auto-fulfilled the Requirements mapped to it, and the glossary explicitly said it was "not a reference to any actual onboarded System". In a GRC tool that separation hides the thing that matters most: the landing zone or directory service a System inherits from is itself a System, with its own Control Assessments, and its own gaps. A Capability could claim to fulfil encryption on behalf of a hundred Systems while the platform behind it had never been assessed.

We're replacing Capability with **Provider**: any System that other Systems declare they depend on. A Provider publishes **Control Offerings**, one per Control, each **Full** or **Shared**, with a customer-responsibility text for Shared. Dependent Systems inherit those offerings **live**: their inherited status always reflects the Provider's current Assessment, not a copy taken when the dependency was declared. Offerings count only once the Provider is itself Onboarded. Organization-level Controls follow the same inheritance model, with the Organization as the source.

We considered keeping Capability and adding a copied status snapshot. We rejected it because snapshots go stale silently, and because Full-only inheritance can't express the shared-responsibility split (the platform encrypts disks, the tenant manages its keys) that cloud Providers actually offer. Existing Capabilities are migrated to Provider Systems.
