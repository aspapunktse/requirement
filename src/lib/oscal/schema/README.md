# Pinned OSCAL schema

`oscal_complete_schema.json` is NIST's JSON Schema for the whole OSCAL model, version **OSCAL v1.2.3**.

- Source: NIST OSCAL release v1.2.3, `json/schema/oscal_complete_schema.json` (https://github.com/usnistgov/OSCAL/releases/tag/v1.2.3).
- Schema `$id`: `http://csrc.nist.gov/ns/oscal/1.0/1.2.3/oscal-complete-schema.json` (draft-07).
- SHA-256: `384324105c7a817af0f65b120a963146caa0e0d55d969cf0daf60e063b87a206`

The file is byte-for-byte NIST's. Don't reformat or edit it: the checksum must stay valid. To upgrade, replace the file, update this README and re-run the validator tests (`src/lib/oscal/__tests__/`).
