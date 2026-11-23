// PROTOTYPE — throwaway spike, not production code. Lives on branch prototype/oscal-validator only.
//
// Question: can Node validate an OSCAL v1.2.3 package (Catalog + OSCAL Profile + SSP) in CI?
//   1. ajv against NIST's pinned oscal_complete_schema.json (v1.2.3, sha256 3843241…a206)
//   2. a minimal resolver for a Profile that only uses include-controls/with-ids
//   3. reference checks across the three documents
//   4. a broken fixture that passes the schema but fails the reference checks
//   5. do v1.2.3 rules accept non-FIPS-199 impact values?
//
// Run: cd src/lib/oscal/PROTOTYPE-validator && npm install && node spike.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// ---------- UUIDv5 from CUID (ADR 0017) ----------
const APP_NAMESPACE = "6f1c2a3e-0b7d-4c55-9a8e-2d4f6b1e9c70"; // placeholder; the real one is fixed once, forever
function uuidv5(name, ns = APP_NAMESPACE) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const uid = (model, cuid) => uuidv5(`${model}:${cuid}`);

// Control code -> OSCAL token. Codes are free text in the app; OSCAL control ids must be tokens.
// Finding: keep a code that is already a valid token unchanged (A.5.15, SEC-001); escape anything else
// reversibly (_xHH_) so two distinct codes can never collide. Lowercasing would collide "A.1" with "a.1".
const TOKEN = /^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$/u;
const controlId = (code) =>
  TOKEN.test(code) ? code : "_" + [...code].map((ch) => (/[\p{L}\p{N}.-]/u.test(ch) ? ch : `_x${ch.codePointAt(0).toString(16)}_`)).join("");

const APP_NS = "https://requirement.example/ns/oscal"; // app namespace for props; real value TBD
const now = "2026-11-23T20:00:00Z";
const meta = (title) => ({ title, "last-modified": now, version: "PROTOTYPE", "oscal-version": "1.2.3" });

// ---------- Fixture: the pilot System from the research ----------
const controls = [
  { cuid: "c_a515", code: "A.5.15", title: "Access control" },
  { cuid: "c_a85", code: "A.8.5", title: "Secure authentication" },
  { cuid: "c_a82", code: "A.8.2", title: "Privileged access rights" },
  { cuid: "c_a530", code: "A.5.30", title: "ICT readiness for business continuity" },
  { cuid: "c_a811", code: "A.8.11", title: "Data masking" },
  { cuid: "c_sec1", code: "SEC-001", title: "Supplementary: payroll export review" },
  { cuid: "c_a78", code: "A.7.8", title: "Equipment siting and protection" }, // in library, not applicable
];
const system = { cuid: "s_pay", name: "Test Payroll", owner: { cuid: "u_ann", name: "Ann Owner" } };
const org = { cuid: "ORGANIZATION" };
const provider = { cuid: "s_dir", name: "Test Directory" };
// Effective statuses as the System page would show them (Q12/Q13).
const rows = [
  { c: "c_a515", status: "FULFILLED", by: [["SYSTEM", "Access reviewed quarterly by the owner."]] },
  { c: "c_a85", status: "FULFILLED", by: [["ORGANIZATION", "Organization-wide SSO with MFA."]] },
  { c: "c_a82", status: "IN_PROGRESS", by: [["PROVIDER", "Directory enforces privileged MFA."], ["SYSTEM", null]] }, // customer half open
  { c: "c_a530", status: "NOT_APPLICABLE", by: [["SYSTEM", "Batch system; no continuity requirement agreed."]] },
  { c: "c_a811", status: "WAIVED", by: [["SYSTEM", null]], risk: "r_mask" },
  { c: "c_sec1", status: "NOT_STARTED", by: [["SYSTEM", null]] },
];
const applicable = rows.map((r) => controls.find((c) => c.cuid === r.c));

// ---------- Build ----------
function buildCatalog() {
  return {
    catalog: {
      uuid: uid("doc-catalog", now),
      metadata: meta("Control Library"),
      controls: controls.map((c) => ({ id: controlId(c.code), title: c.title, props: [{ name: "label", value: c.code }] })),
    },
  };
}
function buildProfile() {
  return {
    profile: {
      uuid: uid("doc-profile", system.cuid + now),
      metadata: meta(`OSCAL Profile: ${system.name}`),
      imports: [{ href: "./catalog.json", "include-controls": [{ "with-ids": applicable.map((c) => controlId(c.code)) }] }],
    },
  };
}
const OSCAL_STATE = { FULFILLED: "implemented", IN_PROGRESS: "partial", NOT_APPLICABLE: "not-applicable" };
const comp = { SYSTEM: uid("system", system.cuid), ORGANIZATION: uid("org", org.cuid), PROVIDER: uid("system", provider.cuid) };
function buildSsp({ impact = "app-sensitivity-3", state = "under-development" } = {}) {
  return {
    "system-security-plan": {
      uuid: uid("doc-ssp", system.cuid + now),
      metadata: {
        ...meta(`System Security Plan: ${system.name}`),
        roles: [{ id: "system-owner", title: "System's owner" }],
        parties: [{ uuid: uid("user", system.owner.cuid), type: "person", name: system.owner.name }],
      },
      "import-profile": { href: "./profile.json" },
      "system-characteristics": {
        "system-ids": [{ "identifier-type": APP_NS, id: uid("system", system.cuid) }],
        "system-name": system.name,
        description: "Payroll batch system (fixture).",
        "system-information": {
          "information-types": [
            {
              uuid: uid("info-type", "it_payroll"),
              title: "Payroll",
              description: "Salary and bank details.",
              "confidentiality-impact": { base: impact },
              "integrity-impact": { base: "app-integrity-3" },
              "availability-impact": { base: "app-availability-2" },
            },
          ],
        },
        status: { state },
        "authorization-boundary": { description: "Generated: Deployment Facets SaaS; Data Location EU; depends on Provider Test Directory." },
        "responsible-parties": [{ "role-id": "system-owner", "party-uuids": [uid("user", system.owner.cuid)] }],
      },
      "system-implementation": {
        components: [
          { uuid: comp.SYSTEM, type: "this-system", title: system.name, description: "The System itself.", status: { state: "under-development" } },
          { uuid: comp.ORGANIZATION, type: "policy", title: "Organization", description: "Organization Control Implementations.", status: { state: "operational" } },
          { uuid: comp.PROVIDER, type: "service", title: provider.name, description: "Provider (a System, ADR 0008).", status: { state: "operational" } },
        ],
      },
      "control-implementation": {
        description: "Controls in the System's OSCAL Profile, with effective status and who does the work.",
        "implemented-requirements": rows.map((r) => {
          const c = controls.find((x) => x.cuid === r.c);
          const st = OSCAL_STATE[r.status];
          return {
            uuid: uid("assessment", system.cuid + c.cuid),
            "control-id": controlId(c.code),
            props: [{ name: "app-status", ns: APP_NS, value: r.status.toLowerCase().replace("_", "-") }, ...(r.risk ? [{ name: "risk", ns: APP_NS, value: uid("risk", r.risk) }] : [])],
            "by-components": r.by.map(([who, text]) => ({
              "component-uuid": comp[who],
              uuid: uid("by-comp", system.cuid + c.cuid + who),
              description: text ?? "No implementation description recorded.",
              ...(st ? { "implementation-status": { state: st } } : {}),
            })),
          };
        }),
      },
    },
  };
}

// ---------- Check 1: schema ----------
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(new URL("./schema/oscal_complete_schema.json", import.meta.url))));
const schemaErrors = (doc) => (validate(doc) ? [] : validate.errors.filter((e) => e.instancePath).slice(0, 3).map((e) => `${e.instancePath} ${e.message}`));

// ---------- Check 2: resolve profile (include-controls/with-ids only) ----------
function resolveProfile(profile, docs) {
  const ids = new Set();
  const problems = [];
  for (const imp of profile.profile.imports) {
    const cat = docs[imp.href];
    if (!cat?.catalog) { problems.push(`import ${imp.href} not in package`); continue; }
    const have = new Set(cat.catalog.controls.map((c) => c.id));
    if (imp["include-all"] || imp["exclude-controls"] || profile.profile.merge || profile.profile.modify) problems.push("unsupported profile feature");
    for (const inc of imp["include-controls"] ?? []) for (const id of inc["with-ids"] ?? []) have.has(id) ? ids.add(id) : problems.push(`with-id ${id} not in catalog`);
  }
  return { ids, problems };
}

// ---------- Check 3: references across the package ----------
const STATE_VALUES = ["operational", "under-development", "under-major-modification", "disposition", "other"]; // allow-other="no" in the metaschema
function referenceErrors(docs) {
  const errs = [];
  const ssp = docs["./ssp.json"]["system-security-plan"];
  const prof = docs[ssp["import-profile"].href];
  if (!prof?.profile) return [`import-profile ${ssp["import-profile"].href} not in package`];
  const { ids, problems } = resolveProfile(prof, docs);
  errs.push(...problems);
  const comps = new Set(ssp["system-implementation"].components.map((c) => c.uuid));
  const roles = new Set((ssp.metadata.roles ?? []).map((r) => r.id));
  const parties = new Set((ssp.metadata.parties ?? []).map((p) => p.uuid));
  if (!STATE_VALUES.includes(ssp["system-characteristics"].status.state)) errs.push(`status.state "${ssp["system-characteristics"].status.state}" not allowed`);
  for (const rp of ssp["system-characteristics"]["responsible-parties"] ?? []) {
    if (!roles.has(rp["role-id"])) errs.push(`role ${rp["role-id"]} undefined`);
    for (const p of rp["party-uuids"]) if (!parties.has(p)) errs.push(`party ${p} undefined`);
  }
  for (const ir of ssp["control-implementation"]["implemented-requirements"]) {
    if (!ids.has(ir["control-id"])) errs.push(`control-id ${ir["control-id"]} not in resolved profile`);
    for (const bc of ir["by-components"] ?? []) if (!comps.has(bc["component-uuid"])) errs.push(`component ${bc["component-uuid"]} undefined`);
  }
  return errs;
}

// ---------- Scenarios ----------
const pkg = (ssp = buildSsp(), cat = buildCatalog(), prof = buildProfile()) => ({ "./catalog.json": cat, "./profile.json": prof, "./ssp.json": ssp });
function run(name, docs) {
  const schema = Object.entries(docs).flatMap(([f, d]) => schemaErrors(d).map((e) => `${f}${e}`));
  const refs = schema.length ? ["(skipped)"] : referenceErrors(docs);
  console.log(`\n■ ${name}\n  schema: ${schema.length ? "FAIL " + JSON.stringify(schema) : "ok"}\n  refs:   ${refs.length ? "FAIL " + JSON.stringify(refs) : "ok"}`);
}

const good = pkg();
const { ids } = resolveProfile(good["./profile.json"], good);
console.log("Resolved OSCAL Profile:", [...ids].join(", "));
console.log("App's applicable set :", applicable.map((c) => controlId(c.code)).join(", "));
console.log("Match:", [...ids].sort().join() === applicable.map((c) => controlId(c.code)).sort().join());
console.log("UUIDv5 stable:", uid("system", "s_pay") === uid("system", "s_pay"), uid("system", "s_pay"));

run("1. Good package", good);

const broken = buildSsp();
broken["system-security-plan"]["control-implementation"]["implemented-requirements"][0]["control-id"] = "A.7.8"; // in catalog, not selected
broken["system-security-plan"]["control-implementation"]["implemented-requirements"][1]["by-components"][0]["component-uuid"] = uid("system", "s_ghost");
run("2. Broken references (valid schema, bad links)", pkg(broken));

run("3. Non-FIPS impact value (app-sensitivity-3)", pkg(buildSsp({ impact: "app-sensitivity-3" })));
run("4. Status state outside the allowed list ('approved')", pkg(buildSsp({ state: "approved" })));

const badToken = buildCatalog();
badToken.catalog.controls[0].id = "5.1 Policy"; // raw free-text code, unsanitised
run("5. Raw Control code with a space as control id", pkg(undefined, badToken));
console.log("\nToken rule examples:", ["A.5.15", "SEC-001", "5.1 Policy", "5.1_Policy", "Ä.1"].map((c) => `${c} -> ${controlId(c)}`).join(" | "));

const missingProfile = buildSsp();
missingProfile["system-security-plan"]["import-profile"].href = "./baseline.json";
run("6. import-profile pointing outside the package", pkg(missingProfile));
