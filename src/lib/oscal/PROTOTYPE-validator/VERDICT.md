# PROTOTYPE verdict: can CI validate an OSCAL v1.2.3 package in Node?

**Yes.** Throwaway spike for the OSCAL pilot (`docs/research/oscal-compliance-as-code.md`, decisions in `CONTEXT.md` "Exchange (OSCAL)" and ADR 0017). Run with `npm install && node spike.mjs` in this folder; runs in ~0.1 s.

| Question | Answer |
| --- | --- |
| ajv against NIST's schema | ajv 8 + ajv-formats compile `oscal_complete_schema.json` v1.2.3 (sha256 `384324105c7a…a206`, draft-07) with `strict: false`. Unicode token patterns work. Errors for a document match every root branch of the schema's `oneOf`, so filter to errors with an `instancePath`, or pick the per-model definition. |
| Closed value lists | Enforced by the JSON schema itself: `status.state: "approved"` fails. Open lists (`implementation-status`, impact `base`) are `anyOf: [token, enum]`, so any token passes. |
| Non-FIPS impact values (Q15) | Accepted. The metaschema's `oscal-fips-199-impact-levels` is `allow-other="yes"`, the schema accepts any string, and `security-objective-*` are plain strings. Q15 stands. |
| Profile resolution | A ~15-line resolver for `include-controls/with-ids` only is enough for our own Profiles; it refuses `include-all`, `exclude-controls`, `merge` and `modify`. The resolved set matched the app's applicable set. No NIST resolver needed for the pilot. |
| Reference checks | Schema validation does not catch broken links: a package with a `control-id` outside the Profile and a `component-uuid` with no component passes the schema and fails our checks. CI needs both layers. |
| UUIDv5 from CUID | `node:crypto` SHA-1 gives a stable v5 UUID in a few lines; no dependency. |

## New finding for the spec

Control codes are free text, but an OSCAL control id must be a token (`^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$`). A raw code such as `5.1 Policy` fails the schema. Rule tried here: keep a code that is already a valid token unchanged (`A.5.15`, `SEC-001`); escape anything else reversibly (`_5.1_x20_Policy`) so two distinct codes never collide. Don't lowercase (`A.1` and `a.1` would collide). The original code always travels as the control's `label` prop.

Not covered: Metaschema constraints beyond allowed values (`index-has-key`, `matches`, cardinality across documents). Our own reference checks cover the ones that matter for the three documents we produce.
