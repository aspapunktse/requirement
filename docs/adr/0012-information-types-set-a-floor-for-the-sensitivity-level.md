---
status: accepted
amends: 0011-sensitivity-level-replaces-confidentiality-impact-level.md
---

# Information Types set a floor for the Sensitivity Level

ADR 0011 had each System declare its Sensitivity Level directly and deferred a catalogue of Information Types. We now want to see which kinds of information may be handled in which Systems, so the Compliance Manager (or an Admin) curates a catalogue of **Information Types**, each with one Sensitivity Level, and a System's owner declares which of them the System handles.

The System's owner still sets the Sensitivity Level, but never below the highest level among the System's Information Types; it may be set higher, and a System with no Information Types declares it freely as before. We keep the level a declared value rather than deriving it, so the model of ADR 0011, its Control thresholds and its migration stay as they are, and an owner can classify a System above what its listed types imply (information the catalogue doesn't name yet).

When a curator raises a type's level, Systems below it are not raised. They are flagged as **below their Information Types**, and can't be submitted for review until the owner raises the level. Raising them automatically would silently change which Controls apply to many Systems, which is what ADR 0011 refused to allow for edits to the levels themselves.

An Information Type carries only a level. Letting a type bring in Frameworks (personal data → GDPR) is a separate decision (#300).

## Considered options

- **Derive the System's level as the highest of its types**: rejected, because a System holding information the catalogue doesn't list yet could not be classified correctly, and every System would need at least one type before it could have a level.
- **Let the owner set any level, with a warning when it is below the types**: rejected, because the level drives Controls and a warning is easy to ignore.
- **Raise Systems automatically when a type's level is raised**: rejected, see above.
