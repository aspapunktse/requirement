---
status: accepted
---

# OSCAL Releases are stored and immutable

The OSCAL Package was "generated on demand, not stored". That is right for a download whose reader wants the System as it is now, but a recipient of an assessed package (an Internal Audit's evidence, a customer's due diligence) needs to point at one exact package later and be sure it is the same one. We store it. An **OSCAL Release** is one System's OSCAL Package as of one moment: the three documents plus a `manifest.json` with the SHA-256 of each, kept as the exact zip in Postgres (as `SystemDocumentFile` keeps files), with its own SHA-256 and a number counting the System's releases from 1. The number is the `metadata.version` of every document in it, and each document lists the earlier releases in `metadata.revisions`. A release is made by the System's owner or an Admin from the System page, and the app also makes one for each System in an Internal Audit when the audit closes (#454). The live download stays on demand, as `unreleased`. *(Agreed with the product owner 2026-11-26, #453; reverses the "not stored" line of the OSCAL Package entry in `CONTEXT.md`.)*

## Considered options

- **Keep generating on demand**: rejected. Two downloads of the same version can differ, so nothing a recipient holds can be checked against what the app said.
- **Store the data and rebuild the zip when asked**: rejected. The app changes (the Control Library, the builder, the app version), so a rebuild is not the package that was handed out.
- **Copy the evidence files into the release**: rejected by the product owner. The manifest lists each evidence file by title and SHA-256 only; a recipient who is given the file can check it, and the release stays small.

## Consequences

- A release is never edited or deleted through the app: no update or delete route exists. Its System is `Restrict`, so a System that has a release can't be deleted either (the app never deletes Systems today). The Internal Audit and creator links are pointers only and are set null if their record goes.
- Releases take database space: a zip of a few hundred KB each, kept for good.
- An evidence file uploaded before digests were recorded (#455) is listed with no hash until it is uploaded again.
- A recipient can no longer tell a release from a rebuilt package by content alone: the release's SHA-256 and `manifest.json` are the check.
