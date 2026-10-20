# Framework import files

One JSON file per Framework version. `npm run frameworks:load` loads them as a **Draft** Framework; a Compliance Manager reviews it at `/admin/frameworks` and publishes it in the UI.

```
npm run frameworks:load -- path/to/file.json      load one file
npm run frameworks:load                           load every *.json in this folder
npm run frameworks:load -- --allow-published ...  also update a Framework that is already Published
```

Files load in file-name order. A file whose Requirements map to Supplementary Controls defined by another file must sort after it, which is why the DEF STAN 05-138 files are numbered by level (a higher level maps to Supplementary Controls the lower level defines). The command prints a summary per file and exits 1 if any file was refused, invalid or failed. The other files are still processed. It runs against the database `DATABASE_URL` (or `.env`) names. A real content file here is loaded by every run of the command, so only commit content that is meant to exist as a Draft in every environment. Sample files for tests live in `src/test/fixtures/frameworks/`.

## Format

```jsonc
{
  "framework": {
    "name": "CSA CCM",            // with version, the key of the Framework
    "version": "4.0",
    "description": "…",           // optional
    "supersedes": { "name": "CSA CCM", "version": "3.0.1" },   // optional, null, or an existing Framework
    "licensing": "PARAPHRASE_ONLY",    // or "QUOTABLE"; the enum spelling only
    "strictComplianceRequired": false, // optional
    "isBase": false               // optional; see below
  },
  "supplementaryControls": [      // optional: Controls this Framework introduces
    { "code": "SUP-CCM-01", "title": "…", "description": "…", "category": "…",
      "applicability": "PER_SYSTEM",              // ORGANIZATIONAL | PER_SYSTEM | BOTH
      "question": "…",                            // required unless ORGANIZATIONAL
      "intent": "…", "examples": ["…"], "mandatory": true,
      "deploymentFacets": ["Cloud IaaS/PaaS"],    // names of existing Deployment Facets
      "minConfidentialityImpactLevel": "HIGH" }   // also Integrity, Availability; LOW|MODERATE|HIGH|CRITICAL
  ],
  "requirements": [
    { "code": "CEK-03", "section": "Cryptography", "title": "Data Encryption", "text": "<own-words paraphrase>",
      "mappings": [ { "control": "A.8.24", "coverage": "FULL", "rationale": "…" } ] }
  ]
}
```

- A mapping's `control` is the code of a Control in the database or of one of the file's Supplementary Controls. `coverage` is `FULL` or `PARTIAL`.
- Unknown keys are rejected, so a typo is reported instead of ignored.
- A Supplementary Control gets this Framework as its origin Framework. A Requirement without `mappings` is a Coverage Gap until it is mapped.
- Licensed standards are paraphrased in `text` (PRD 0001 section 8); never paste verbatim text.

## What a load does

- **Validation first.** The whole file is checked before anything is written: field values, duplicate Requirement or Supplementary Control codes, a Control mapped twice in one Requirement, a mapping to a Control that is neither in the database nor in the file, an unknown Deployment Facet or `supersedes` target. An invalid file changes nothing and the message names each problem. All writes for a file are one transaction.
- **Idempotent.** The file is the source of truth for the Framework's metadata, each listed Requirement's section, title and text, its set of Control Mappings (Coverage and rationale) and its Supplementary Controls. A second run of the same file changes nothing.
- **Omitted optional fields are left as they are** on an existing row (and take the default on a new one). To clear a nullable field, write `null`.
- **Nothing is deleted except mappings.** A mapping missing from a listed Requirement is removed. A Requirement or Supplementary Control in the database but not in the file is kept (the summary lists the Requirements), because deleting a Requirement loses its gap acceptance. Remove one in the UI.
- **A Supplementary Control** can only be created or updated by the file of its own Framework. A code that already exists as a base Control, or belongs to another Framework, makes the file invalid, and so does a changed `applicability`.
- **Draft Frameworks are inert**, so loading into one writes no Change Events and recomputes nothing. The one exception: changing the Deployment Facets or Impact Level thresholds of an existing Supplementary Control that is also mapped to a Requirement of a Published Framework recomputes the Systems it reaches, as editing a Control in the UI does.
- **Published Frameworks are refused** (exit 1, nothing changed) unless `--allow-published` is given. With the flag the changes go through the same code as the UI: each mapping added, removed or changed in Coverage writes a Control Mapping Change Event (actor `system`, naming the file), a Full mapping clears a gap acceptance, and the Systems that have the Framework in scope are recomputed. The Framework stays Published.
- **`isBase` is never created or changed.** A file with `"isBase": true` is accepted only if it matches the existing base Framework by name and version (which is Published, so it needs the flag), and a file for the base Framework must say `"isBase": true`.
- **`supersedes`** names another Framework by name and version, which must exist, and may not form a loop.
