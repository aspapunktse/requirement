/**
 * OSCAL package validator (#441, PRD #440). Used by tests and CI, not on the request path.
 *
 * A package is three documents: a Catalog, an OSCAL Profile and a System Security Plan; when the System has a closed Internal
 * Audit (#454) it also holds an Assessment Plan and Assessment Results, which are checked the same way.
 * Two layers, because the JSON schema does not catch broken links:
 *   1. schema: each document against NIST's pinned OSCAL v1.2.3 schema, using the per-model
 *      definition rather than the schema root (a `oneOf` over every model).
 *   2. reference: links between and inside the documents (see `referenceErrors`).
 * The reference layer only runs when every document passes the schema, so it can rely on shape.
 *
 * In-package href convention: `catalog.json` and `profile.json`, with or without a leading `./`.
 * The Profile imports `catalog.json`; the SSP's import-profile is `profile.json`. Any other href
 * (an http URL, `../x`, `#uuid`) points outside the package and is an error.
 */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import oscalSchema from "./schema/oscal_complete_schema.json";
import { OSCAL_APP_NS } from "./ids";

export type OscalDocumentName = "catalog" | "profile" | "ssp" | "assessment-plan" | "assessment-results" | "poam";
export type OscalValidationError = {
  layer: "schema" | "reference";
  document: OscalDocumentName;
  /** JSON pointer into the document file, starting at its root key (e.g. `/profile/imports/0`). */
  path: string;
  message: string;
};
export type OscalPackage = { catalog: unknown; profile: unknown; ssp: unknown; assessmentPlan?: unknown; assessmentResults?: unknown; poam?: unknown };

const ROOT_KEY: Record<OscalDocumentName, string> = {
  catalog: "catalog",
  profile: "profile",
  ssp: "system-security-plan",
  "assessment-plan": "assessment-plan",
  "assessment-results": "assessment-results",
  poam: "plan-of-action-and-milestones",
};
const MODEL_DEFINITION: Record<OscalDocumentName, string> = {
  catalog: "oscal-complete-oscal-catalog:catalog",
  profile: "oscal-complete-oscal-profile:profile",
  ssp: "oscal-complete-oscal-ssp:system-security-plan",
  "assessment-plan": "oscal-complete-oscal-ap:assessment-plan",
  "assessment-results": "oscal-complete-oscal-ar:assessment-results",
  poam: "oscal-complete-oscal-poam:plan-of-action-and-milestones",
};
/** Package file name (without `./`) of each in-package document. */
export const PACKAGE_FILES = { catalog: "catalog.json", profile: "profile.json", ssp: "ssp.json", "assessment-plan": "assessment-plan.json", poam: "poam.json" } as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

let validators: (Record<OscalDocumentName, ValidateFunction> & { directive: ValidateFunction }) | undefined;
function getValidators() {
  if (!validators) {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(oscalSchema);
    const id = (oscalSchema as { $id: string }).$id;
    const get = (name: OscalDocumentName) => {
      const fn = ajv.getSchema(`${id}#/definitions/${MODEL_DEFINITION[name]}`);
      if (!fn) throw new Error(`OSCAL schema definition ${MODEL_DEFINITION[name]} not found`);
      return fn;
    };
    const directive = ajv.getSchema(`${id}#/definitions/json-schema-directive`);
    if (!directive) throw new Error("OSCAL schema definition json-schema-directive not found");
    validators = {
      catalog: get("catalog"),
      profile: get("profile"),
      ssp: get("ssp"),
      "assessment-plan": get("assessment-plan"),
      "assessment-results": get("assessment-results"),
      poam: get("poam"),
      directive,
    };
  }
  return validators;
}

export function schemaErrors(document: OscalDocumentName, doc: unknown): OscalValidationError[] {
  const root = ROOT_KEY[document];
  if (!isObject(doc) || !(root in doc)) {
    return [{ layer: "schema", document, path: "", message: `must be an object with a "${root}" property` }];
  }
  const extra = Object.keys(doc).filter((k) => k !== root && k !== "$schema");
  const errors: OscalValidationError[] = extra.map((k) => ({
    layer: "schema",
    document,
    path: `/${k}`,
    message: `must not have the property "${k}"`,
  }));
  const { directive, ...models } = getValidators();
  if ("$schema" in doc && !directive(doc.$schema)) {
    for (const e of directive.errors ?? []) {
      errors.push({ layer: "schema", document, path: "/$schema", message: e.message ?? "is invalid" });
    }
  }
  const validate = models[document];
  if (!validate(doc[root])) {
    for (const e of validate.errors ?? []) {
      const extraProperty = e.keyword === "additionalProperties" ? ` (${JSON.stringify(e.params.additionalProperty)})` : "";
      errors.push({
        layer: "schema",
        document,
        path: `/${root}${e.instancePath}`,
        message: `${e.message ?? "is invalid"}${extraProperty}`,
      });
    }
  }
  return errors;
}

/** Strips one leading `./` and returns the in-package document an href names, if any. */
export function packageDocumentForHref(href: string): "catalog" | "profile" | "ssp" | "assessment-plan" | undefined {
  const name = href.startsWith("./") ? href.slice(2) : href;
  if (name === PACKAGE_FILES.catalog) return "catalog";
  if (name === PACKAGE_FILES.profile) return "profile";
  if (name === PACKAGE_FILES.ssp) return "ssp";
  if (name === PACKAGE_FILES["assessment-plan"]) return "assessment-plan";
  return undefined;
}

/** Ids of every control in a Catalog document, including controls nested in groups and enhancements. */
export function catalogControlIds(catalog: unknown): Set<string> {
  const ids = new Set<string>();
  const walkControl = (c: unknown) => {
    if (!isObject(c)) return;
    if (typeof c.id === "string") ids.add(c.id);
    asArray(c.controls).forEach(walkControl);
  };
  const walkGroup = (g: unknown) => {
    if (!isObject(g)) return;
    asArray(g.controls).forEach(walkControl);
    asArray(g.groups).forEach(walkGroup);
  };
  const root = isObject(catalog) && isObject(catalog.catalog) ? catalog.catalog : {};
  asArray(root.controls).forEach(walkControl);
  asArray(root.groups).forEach(walkGroup);
  return ids;
}

/**
 * Resolves a Profile against its Catalog. Supports only `include-controls` with `with-ids`; every
 * other way of selecting or changing controls is reported as unsupported, not guessed at.
 * Returns the selected control ids (in order, no duplicates) and the problems found.
 */
export function resolveProfile(
  profile: unknown,
  catalog: unknown,
): { ids: string[]; errors: Omit<OscalValidationError, "layer" | "document">[] } {
  const ids = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  const root = isObject(profile) && isObject(profile.profile) ? profile.profile : {};
  const have = catalogControlIds(catalog);
  const unsupported = (path: string, what: string) =>
    errors.push({ path, message: `unsupported: ${what} (only include-controls with with-ids is supported)` });

  if (root.merge !== undefined) unsupported("/profile/merge", "merge");
  if (root.modify !== undefined) unsupported("/profile/modify", "modify");

  asArray(root.imports).forEach((imp, i) => {
    if (!isObject(imp)) return;
    const base = `/profile/imports/${i}`;
    if (imp["include-all"] !== undefined) unsupported(`${base}/include-all`, "include-all");
    if (imp["exclude-controls"] !== undefined) unsupported(`${base}/exclude-controls`, "exclude-controls");
    const includes = asArray(imp["include-controls"]);
    if (imp["include-all"] === undefined && includes.length === 0) {
      errors.push({ path: base, message: "import selects no controls: expected include-controls with with-ids" });
    }
    includes.forEach((inc, j) => {
      if (!isObject(inc)) return;
      const ip = `${base}/include-controls/${j}`;
      if (inc.matching !== undefined) unsupported(`${ip}/matching`, "matching");
      if (inc["with-child-controls"] === "yes") unsupported(`${ip}/with-child-controls`, "with-child-controls");
      if (inc["with-ids"] === undefined && inc.matching === undefined) {
        errors.push({ path: ip, message: "include-controls without with-ids" });
      }
      asArray(inc["with-ids"]).forEach((id, k) => {
        if (typeof id !== "string") return;
        if (have.has(id)) ids.add(id);
        else errors.push({ path: `${ip}/with-ids/${k}`, message: `control "${id}" is not in the Catalog` });
      });
    });
  });
  return { ids: [...ids], errors };
}

function hrefError(
  hasTarget: boolean,
  document: OscalDocumentName,
  path: string,
  href: unknown,
  expected: "catalog" | "profile" | "ssp" | "assessment-plan",
): OscalValidationError | undefined {
  const target = typeof href === "string" ? packageDocumentForHref(href) : undefined;
  if (target === expected && hasTarget) return undefined;
  return {
    layer: "reference",
    document,
    path,
    message: `href ${JSON.stringify(href)} does not resolve to ${PACKAGE_FILES[expected]} inside the package${hasTarget ? "" : ` (the package has no ${expected})`}`,
  };
}

/** Every uuid and id the SSP defines, for checking the references made to them. */
function sspDefinitions(ssp: Json) {
  const metadata = isObject(ssp.metadata) ? ssp.metadata : {};
  const impl = isObject(ssp["system-implementation"]) ? ssp["system-implementation"] : {};
  const pick = (list: unknown, key: string) =>
    new Set(asArray(list).flatMap((x) => (isObject(x) && typeof x[key] === "string" ? [x[key] as string] : [])));
  return {
    components: pick(impl.components, "uuid"),
    roles: pick(metadata.roles, "id"),
    parties: pick(metadata.parties, "uuid"),
    resources: pick((isObject(ssp["back-matter"]) ? ssp["back-matter"] : {}).resources, "uuid"),
  };
}

export function referenceErrors(pkg: OscalPackage): OscalValidationError[] {
  const errors: OscalValidationError[] = [];
  const add = (document: OscalDocumentName, path: string, message: string) =>
    errors.push({ layer: "reference", document, path, message });
  const profileDoc = pkg.profile as Json;
  const sspDoc = (pkg.ssp as Json)[ROOT_KEY.ssp] as Json;

  // Links between the documents.
  const profileRoot = profileDoc.profile as Json;
  asArray(profileRoot.imports).forEach((imp, i) => {
    const e = hrefError(true, "profile", `/profile/imports/${i}/href`, (imp as Json).href, "catalog");
    if (e) errors.push(e);
  });
  const sspImportError = hrefError(
    true,
    "ssp",
    "/system-security-plan/import-profile/href",
    (sspDoc["import-profile"] as Json | undefined)?.href,
    "profile",
  );
  if (sspImportError) errors.push(sspImportError);

  // The Profile: only the supported subset, every id in the Catalog.
  const resolved = resolveProfile(pkg.profile, pkg.catalog);
  for (const e of resolved.errors) add("profile", e.path, e.message);
  const selected = new Set(resolved.ids);

  // The SSP: controls in the selected set, and every referenced uuid or id defined.
  asArray((sspDoc["control-implementation"] as Json | undefined)?.["implemented-requirements"]).forEach((ir, i) => {
    const id = (ir as Json)["control-id"];
    if (typeof id === "string" && !selected.has(id)) {
      add(
        "ssp",
        `/system-security-plan/control-implementation/implemented-requirements/${i}/control-id`,
        `control "${id}" is not in the set selected by the Profile`,
      );
    }
  });

  const defs = sspDefinitions(sspDoc);
  const check = (path: string, value: unknown, defined: Set<string>, what: string) => {
    if (typeof value === "string" && !defined.has(value)) add("ssp", path, `${what} "${value}" is not defined in the SSP`);
  };
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}/${i}`));
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}/${key}`;
      if (key === "component-uuid") check(p, value, defs.components, "component");
      else if (key === "role-id") check(p, value, defs.roles, "role");
      else if (key === "role-ids") asArray(value).forEach((v, i) => check(`${p}/${i}`, v, defs.roles, "role"));
      else if (key === "links")
        asArray(value).forEach((link, i) => {
          const href = isObject(link) ? link.href : undefined;
          // A `#<uuid>` link points at a back-matter resource of this SSP.
          if (typeof href === "string" && href.startsWith("#")) check(`${p}/${i}/href`, href.slice(1), defs.resources, "resource");
        });
      else if (key === "party-uuid") check(p, value, defs.parties, "party");
      else if (key === "party-uuids" || key === "member-of-organizations")
        asArray(value).forEach((v, i) => check(`${p}/${i}`, v, defs.parties, "party"));
      else walk(value, p);
    }
  };
  walk(sspDoc, "/system-security-plan");
  errors.push(...assessmentReferenceErrors(pkg, defs.components));
  errors.push(...poamReferenceErrors(pkg));
  return errors;
}

/** The statement ids of a Catalog (every part named `statement`), and the control each belongs to. */
function catalogStatements(catalog: unknown): Map<string, string> {
  const statements = new Map<string, string>();
  const walkParts = (parts: unknown, owner: string) =>
    asArray(parts).forEach((part) => {
      if (!isObject(part)) return;
      if (part.name === "statement" && typeof part.id === "string") statements.set(part.id, owner);
      walkParts(part.parts, owner);
    });
  const walkControl = (c: unknown) => {
    if (!isObject(c)) return;
    if (typeof c.id === "string") walkParts(c.parts, c.id);
    asArray(c.controls).forEach(walkControl);
  };
  const walkGroup = (g: unknown) => {
    if (!isObject(g)) return;
    asArray(g.controls).forEach(walkControl);
    asArray(g.groups).forEach(walkGroup);
  };
  const root = isObject(catalog) && isObject(catalog.catalog) ? catalog.catalog : {};
  asArray(root.controls).forEach(walkControl);
  asArray(root.groups).forEach(walkGroup);
  return statements;
}

/** Control ids a `reviewed-controls` block includes (only `include-controls` is supported, as for Profiles). */
function reviewedControlIds(reviewed: unknown, path: string, add: (path: string, message: string) => void) {
  const controls = new Set<string>();
  const selections = isObject(reviewed) ? asArray(reviewed["control-selections"]) : [];
  selections.forEach((sel, i) => {
    if (!isObject(sel)) return;
    if (sel["include-all"] !== undefined) add(`${path}/control-selections/${i}/include-all`, "unsupported: include-all (only include-controls is supported)");
    asArray(sel["include-controls"]).forEach((inc) => {
      if (isObject(inc) && typeof inc["control-id"] === "string") controls.add(inc["control-id"]);
    });
  });
  return controls;
}

/**
 * Reference checks of the Assessment Plan and Assessment Results (#454), run when the package holds them:
 * `import-ssp` is the package's `ssp.json` and `import-ap` its `assessment-plan.json`; every reviewed control and finding target
 * exists in the Catalog (a finding's statement belongs to a control the result reviewed); subjects name an SSP component; activities,
 * observations, risks and parties that are referred to are defined where they are referred to; and every Risk the SSP cites for
 * a Waived Control resolves to a risk of the Assessment Results.
 */
function assessmentReferenceErrors(pkg: OscalPackage, components: Set<string>): OscalValidationError[] {
  const errors: OscalValidationError[] = [];
  const hasPlan = pkg.assessmentPlan !== undefined;
  const hasResults = pkg.assessmentResults !== undefined;
  if (!hasPlan && !hasResults) return errors;
  const add = (document: OscalDocumentName, path: string, message: string) => errors.push({ layer: "reference", document, path, message });
  const catalogIds = catalogControlIds(pkg.catalog);
  const statements = catalogStatements(pkg.catalog);
  const resolvedControls = (document: OscalDocumentName, reviewed: unknown, path: string): Set<string> => {
    const ids = reviewedControlIds(reviewed, path, (p, m) => add(document, p, m));
    asArray(isObject(reviewed) ? reviewed["control-selections"] : undefined).forEach((sel, i) =>
      asArray(isObject(sel) ? sel["include-controls"] : undefined).forEach((inc, j) => {
        if (!isObject(inc)) return;
        const base = `${path}/control-selections/${i}/include-controls/${j}`;
        if (typeof inc["control-id"] === "string" && !catalogIds.has(inc["control-id"])) add(document, `${base}/control-id`, `control "${inc["control-id"]}" is not in the Catalog`);
        asArray(inc["statement-ids"]).forEach((sid, k) => {
          if (typeof sid !== "string") return;
          if (!statements.has(sid)) add(document, `${base}/statement-ids/${k}`, `statement "${sid}" is not in the Catalog`);
          else if (statements.get(sid) !== inc["control-id"]) add(document, `${base}/statement-ids/${k}`, `statement "${sid}" does not belong to control "${String(inc["control-id"])}"`);
        });
      }),
    );
    return ids;
  };
  const checkSubjects = (document: OscalDocumentName, subjects: unknown, path: string) =>
    asArray(subjects).forEach((subject, i) =>
      asArray(isObject(subject) ? subject["include-subjects"] : undefined).forEach((ref, j) => {
        if (isObject(ref) && ref.type === "component" && typeof ref["subject-uuid"] === "string" && !components.has(ref["subject-uuid"])) {
          add(document, `${path}/${i}/include-subjects/${j}/subject-uuid`, `component "${ref["subject-uuid"]}" is not defined in the SSP`);
        }
      }),
    );

  if (hasPlan) {
    const plan = (pkg.assessmentPlan as Json)["assessment-plan"] as Json;
    const e = hrefError(true, "assessment-plan", "/assessment-plan/import-ssp/href", (plan["import-ssp"] as Json | undefined)?.href, "ssp");
    if (e) errors.push(e);
    resolvedControls("assessment-plan", plan["reviewed-controls"], "/assessment-plan/reviewed-controls");
    checkSubjects("assessment-plan", plan["assessment-subjects"], "/assessment-plan/assessment-subjects");
    const activities = new Set(
      asArray(isObject(plan["local-definitions"]) ? plan["local-definitions"].activities : undefined).flatMap((a) => (isObject(a) && typeof a.uuid === "string" ? [a.uuid] : [])),
    );
    const walkTasks = (tasks: unknown, path: string) =>
      asArray(tasks).forEach((task, i) => {
        if (!isObject(task)) return;
        const tp = `${path}/${i}`;
        asArray(task["associated-activities"]).forEach((assoc, j) => {
          if (!isObject(assoc)) return;
          if (typeof assoc["activity-uuid"] === "string" && !activities.has(assoc["activity-uuid"])) {
            add("assessment-plan", `${tp}/associated-activities/${j}/activity-uuid`, `activity "${assoc["activity-uuid"]}" is not defined in the plan`);
          }
          checkSubjects("assessment-plan", assoc.subjects, `${tp}/associated-activities/${j}/subjects`);
        });
        checkSubjects("assessment-plan", task.subjects, `${tp}/subjects`);
        walkTasks(task.tasks, `${tp}/tasks`);
      });
    walkTasks(plan.tasks, "/assessment-plan/tasks");
  }

  if (hasResults) {
    const results = (pkg.assessmentResults as Json)["assessment-results"] as Json;
    const e = hrefError(hasPlan, "assessment-results", "/assessment-results/import-ap/href", (results["import-ap"] as Json | undefined)?.href, "assessment-plan");
    if (e) errors.push(e);
    const metadata = isObject(results.metadata) ? results.metadata : {};
    const parties = new Set(asArray(metadata.parties).flatMap((p) => (isObject(p) && typeof p.uuid === "string" ? [p.uuid] : [])));
    const riskUuids = new Set<string>();
    asArray(results.results).forEach((result, i) => {
      if (!isObject(result)) return;
      const rp = `/assessment-results/results/${i}`;
      const reviewed = resolvedControls("assessment-results", result["reviewed-controls"], `${rp}/reviewed-controls`);
      const observations = new Set(asArray(result.observations).flatMap((o) => (isObject(o) && typeof o.uuid === "string" ? [o.uuid] : [])));
      const risks = new Set(asArray(result.risks).flatMap((r) => (isObject(r) && typeof r.uuid === "string" ? [r.uuid] : [])));
      risks.forEach((u) => riskUuids.add(u));
      const checkOrigins = (origins: unknown, path: string) =>
        asArray(origins).forEach((origin, a) =>
          asArray(isObject(origin) ? origin.actors : undefined).forEach((actor, b) => {
            if (isObject(actor) && actor.type === "party" && typeof actor["actor-uuid"] === "string" && !parties.has(actor["actor-uuid"])) {
              add("assessment-results", `${path}/${a}/actors/${b}/actor-uuid`, `party "${actor["actor-uuid"]}" is not defined in the results' metadata`);
            }
          }),
        );
      const checkObservationRefs = (refs: unknown, path: string) =>
        asArray(refs).forEach((ref, j) => {
          if (isObject(ref) && typeof ref["observation-uuid"] === "string" && !observations.has(ref["observation-uuid"])) {
            add("assessment-results", `${path}/${j}/observation-uuid`, `observation "${ref["observation-uuid"]}" is not in this result`);
          }
        });
      asArray(result.observations).forEach((o, j) => {
        if (!isObject(o)) return;
        checkOrigins(o.origins, `${rp}/observations/${j}/origins`);
        asArray(o.subjects).forEach((s, k) => {
          if (isObject(s) && s.type === "component" && typeof s["subject-uuid"] === "string" && !components.has(s["subject-uuid"])) {
            add("assessment-results", `${rp}/observations/${j}/subjects/${k}/subject-uuid`, `component "${s["subject-uuid"]}" is not defined in the SSP`);
          }
        });
      });
      asArray(result.risks).forEach((r, j) => {
        if (!isObject(r)) return;
        checkOrigins(r.origins, `${rp}/risks/${j}/origins`);
        checkObservationRefs(r["related-observations"], `${rp}/risks/${j}/related-observations`);
      });
      asArray(result.findings).forEach((f, j) => {
        if (!isObject(f)) return;
        const fp = `${rp}/findings/${j}`;
        checkOrigins(f.origins, `${fp}/origins`);
        checkObservationRefs(f["related-observations"], `${fp}/related-observations`);
        asArray(f["related-risks"]).forEach((ref, k) => {
          if (isObject(ref) && typeof ref["risk-uuid"] === "string" && !risks.has(ref["risk-uuid"])) add("assessment-results", `${fp}/related-risks/${k}/risk-uuid`, `risk "${ref["risk-uuid"]}" is not in this result`);
        });
        const target = isObject(f.target) ? f.target : {};
        const id = target["target-id"];
        if (target.type === "statement-id" && typeof id === "string") {
          if (!statements.has(id)) add("assessment-results", `${fp}/target/target-id`, `statement "${id}" is not in the Catalog`);
          else if (!reviewed.has(statements.get(id)!)) add("assessment-results", `${fp}/target/target-id`, `statement "${id}" belongs to a control this result did not review`);
        }
      });
    });

    // Every Risk the SSP cites for a Waived Control must be one of the results' risks.
    const sspRoot = (pkg.ssp as Json)[ROOT_KEY.ssp] as Json;
    asArray((sspRoot["control-implementation"] as Json | undefined)?.["implemented-requirements"]).forEach((ir, i) =>
      asArray(isObject(ir) ? ir["by-components"] : undefined).forEach((bc, j) =>
        asArray(isObject(bc) ? bc.props : undefined).forEach((p, k) => {
          if (isObject(p) && p.name === "risk" && p.ns === OSCAL_APP_NS && typeof p.value === "string" && !riskUuids.has(p.value)) {
            add("ssp", `/system-security-plan/control-implementation/implemented-requirements/${i}/by-components/${j}/props/${k}/value`, `risk "${p.value}" (a Waived Control's Risk) is not a risk of the Assessment Results`);
          }
        }),
      ),
    );
  }
  return errors;
}

const poamRoot = (pkg: OscalPackage): Json | undefined =>
  pkg.poam !== undefined && isObject(pkg.poam) && isObject(pkg.poam[ROOT_KEY.poam]) ? (pkg.poam[ROOT_KEY.poam] as Json) : undefined;

/**
 * Reference checks of the POA&M (#456), run when the package holds one: `import-ssp` is the package's `ssp.json`; `system-id` is the
 * SSP's system id; every item relates to risks, findings and observations the POA&M defines; parties named in `origins` and
 * `logged-by` and roles named in `logged-by` are defined in its metadata; a risk whose uuid is also a risk of the Assessment Results
 * says the same status there (the same Risk can't be both open and closed in one package); no two entries share a uuid.
 */
function poamReferenceErrors(pkg: OscalPackage): OscalValidationError[] {
  const root = poamRoot(pkg);
  if (!root) return [];
  const errors: OscalValidationError[] = [];
  const add = (path: string, message: string) => errors.push({ layer: "reference", document: "poam", path, message });
  const base = "/plan-of-action-and-milestones";
  const e = hrefError(true, "poam", `${base}/import-ssp/href`, (root["import-ssp"] as Json | undefined)?.href, "ssp");
  if (e) errors.push(e);

  const sspRoot = (pkg.ssp as Json)[ROOT_KEY.ssp] as Json;
  const sspIds = asArray(isObject(sspRoot["system-characteristics"]) ? sspRoot["system-characteristics"]["system-ids"] : undefined).flatMap((x) =>
    isObject(x) && typeof x.id === "string" ? [x.id] : [],
  );
  const systemId = isObject(root["system-id"]) ? root["system-id"].id : undefined;
  if (typeof systemId === "string" && !sspIds.includes(systemId)) add(`${base}/system-id/id`, `system id "${systemId}" is not a system id of the SSP`);

  const metadata = isObject(root.metadata) ? root.metadata : {};
  const parties = new Set(asArray(metadata.parties).flatMap((p) => (isObject(p) && typeof p.uuid === "string" ? [p.uuid] : [])));
  const roles = new Set(asArray(metadata.roles).flatMap((r) => (isObject(r) && typeof r.id === "string" ? [r.id] : [])));
  const uuidsOf = (list: unknown) => new Set(asArray(list).flatMap((x) => (isObject(x) && typeof x.uuid === "string" ? [x.uuid] : [])));
  const risks = uuidsOf(root.risks);
  const findings = uuidsOf(root.findings);
  const observations = uuidsOf(root.observations);

  const seen = new Set<string>();
  const unique = (path: string, uuid: unknown) => {
    if (typeof uuid !== "string") return;
    if (seen.has(uuid)) add(path, `uuid "${uuid}" is used more than once in the POA&M`);
    seen.add(uuid);
  };
  const checkOrigins = (origins: unknown, path: string) =>
    asArray(origins).forEach((origin, a) =>
      asArray(isObject(origin) ? origin.actors : undefined).forEach((actor, b) => {
        if (isObject(actor) && actor.type === "party" && typeof actor["actor-uuid"] === "string" && !parties.has(actor["actor-uuid"])) {
          add(`${path}/${a}/actors/${b}/actor-uuid`, `party "${actor["actor-uuid"]}" is not defined in the POA&M's metadata`);
        }
      }),
    );
  const checkRefs = (list: unknown, key: string, defined: Set<string>, path: string, what: string) =>
    asArray(list).forEach((ref, i) => {
      if (isObject(ref) && typeof ref[key] === "string" && !defined.has(ref[key] as string)) add(`${path}/${i}/${key}`, `${what} "${ref[key]}" is not defined in the POA&M`);
    });

  const arRisks = new Map<string, unknown>();
  const results = pkg.assessmentResults !== undefined && isObject(pkg.assessmentResults) && isObject(pkg.assessmentResults["assessment-results"]) ? (pkg.assessmentResults["assessment-results"] as Json) : undefined;
  for (const result of asArray(results?.results)) for (const r of asArray(isObject(result) ? result.risks : undefined)) if (isObject(r) && typeof r.uuid === "string") arRisks.set(r.uuid, r.status);

  asArray(root.observations).forEach((o, i) => {
    if (!isObject(o)) return;
    unique(`${base}/observations/${i}/uuid`, o.uuid);
    checkOrigins(o.origins, `${base}/observations/${i}/origins`);
  });
  asArray(root.findings).forEach((f, i) => {
    if (!isObject(f)) return;
    unique(`${base}/findings/${i}/uuid`, f.uuid);
    checkOrigins(f.origins, `${base}/findings/${i}/origins`);
    checkRefs(f["related-observations"], "observation-uuid", observations, `${base}/findings/${i}/related-observations`, "observation");
    checkRefs(f["related-risks"], "risk-uuid", risks, `${base}/findings/${i}/related-risks`, "risk");
  });
  asArray(root.risks).forEach((r, i) => {
    if (!isObject(r)) return;
    const rp = `${base}/risks/${i}`;
    unique(`${rp}/uuid`, r.uuid);
    checkOrigins(r.origins, `${rp}/origins`);
    checkRefs(r["related-observations"], "observation-uuid", observations, `${rp}/related-observations`, "observation");
    if (typeof r.uuid === "string" && arRisks.has(r.uuid) && arRisks.get(r.uuid) !== r.status) {
      add(`${rp}/status`, `risk "${r.uuid}" is "${String(r.status)}" here but "${String(arRisks.get(r.uuid))}" in the Assessment Results`);
    }
    asArray(r.remediations).forEach((rem, j) => {
      if (!isObject(rem)) return;
      unique(`${rp}/remediations/${j}/uuid`, rem.uuid);
      asArray(rem.tasks).forEach((t, k) => isObject(t) && unique(`${rp}/remediations/${j}/tasks/${k}/uuid`, t.uuid));
    });
    const log = isObject(r["risk-log"]) ? r["risk-log"] : {};
    asArray(log.entries).forEach((entry, j) => {
      if (!isObject(entry)) return;
      const ep = `${rp}/risk-log/entries/${j}`;
      unique(`${ep}/uuid`, entry.uuid);
      asArray(entry["logged-by"]).forEach((by, k) => {
        if (!isObject(by)) return;
        if (typeof by["party-uuid"] === "string" && !parties.has(by["party-uuid"])) add(`${ep}/logged-by/${k}/party-uuid`, `party "${by["party-uuid"]}" is not defined in the POA&M's metadata`);
        if (typeof by["role-id"] === "string" && !roles.has(by["role-id"])) add(`${ep}/logged-by/${k}/role-id`, `role "${by["role-id"]}" is not defined in the POA&M's metadata`);
      });
    });
  });
  asArray(root["poam-items"]).forEach((item, i) => {
    if (!isObject(item)) return;
    const ip = `${base}/poam-items/${i}`;
    unique(`${ip}/uuid`, item.uuid);
    checkRefs(item["related-risks"], "risk-uuid", risks, `${ip}/related-risks`, "risk");
    checkRefs(item["related-findings"], "finding-uuid", findings, `${ip}/related-findings`, "finding");
    checkRefs(item["related-observations"], "observation-uuid", observations, `${ip}/related-observations`, "observation");
  });
  return errors;
}

/** Validates a package. Reference checks run only if every document passes the schema. */
export function validateOscalPackage(pkg: OscalPackage): OscalValidationError[] {
  const schema = [
    ...(["catalog", "profile", "ssp"] as const).flatMap((name) => schemaErrors(name, pkg[name])),
    ...(pkg.assessmentPlan === undefined ? [] : schemaErrors("assessment-plan", pkg.assessmentPlan)),
    ...(pkg.assessmentResults === undefined ? [] : schemaErrors("assessment-results", pkg.assessmentResults)),
    ...(pkg.poam === undefined ? [] : schemaErrors("poam", pkg.poam)),
  ];
  return schema.length > 0 ? schema : referenceErrors(pkg);
}
