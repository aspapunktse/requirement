import type { OscalPackage } from "@/lib/oscal/package-builder";

/** The app's own prop that carries the Control Assessment status, and the Control's code on its Catalog control (#442). */
export const APP_STATUS_PROP = "control-assessment-status";
export const CODE_PROP = "label";
/** The status props a by-component may carry, by who does the work: the System itself, the Organization, a Provider (#443). */
export const ENTRY_STATUS_PROPS = ["control-assessment-status", "organization-status", "provider-status"] as const;

type Prop = { name: string; ns?: string; value: string };
type ByComponent = {
  "component-uuid": string;
  uuid?: string;
  description?: string;
  props?: Prop[];
  "implementation-status"?: { state: string };
  remarks?: string;
};

export type ReviewEntry = {
  /** The component that does the work, titled from the SSP's `system-implementation.components`. */
  componentTitle: string;
  componentUuid: string;
  /** OSCAL `implementation-status` state, or null when the package makes no claim. */
  implementationStatus: string | null;
  /** The app's Control Assessment status (an app prop), or null when absent. */
  appStatus: string | null;
  /** The System's customer half of a Shared Offering: "open" or "done"; null when the entry is not one. */
  customerHalf: string | null;
  /** The UUID of the Risk a Waived Control points at; null when none. */
  risk: string | null;
  description: string;
  remarks: string | null;
};

export type ReviewRow = {
  requirementUuid: string;
  controlId: string;
  /** The Control's code as the Catalog writes it (its `label` prop), falling back to the OSCAL id. */
  code: string;
  title: string;
  /** Statuses on the implemented requirement itself, if the package carries any. */
  implementationStatus: string | null;
  appStatus: string | null;
  /** The effective status (after inheritance), where it comes from, and whether the System's own status overrides an inherited one. */
  effectiveStatus: string | null;
  effectiveSource: string | null;
  overridesInherited: boolean;
  entries: ReviewEntry[];
};

export type ReviewModel = {
  systemName: string;
  state: string;
  generatedAt: string;
  /** The SSP's `metadata.version` ("unreleased" for a download) and its document id (same in every export of this System). */
  documentVersion: string;
  documentId: string | null;
  rows: ReviewRow[];
  /** The Assessment Plan and Assessment Results (#454); null when the package has neither. */
  assessment: AssessmentReview | null;
};

const appProp = (props: Prop[] | undefined, appNs: string, name: string): string | null => props?.find((p) => p.name === name && p.ns === appNs)?.value ?? null;

/**
 * The review page's rows, read only from the package the builder returns, so the page and the download can't disagree. Generic over
 * components: a requirement's `by-components` are listed in the order the package holds them, each titled from the SSP's component
 * list (a component the list doesn't name shows its UUID).
 */
export function buildReviewModel(pkg: OscalPackage, appNs: string): ReviewModel {
  const ssp = pkg.ssp["system-security-plan"];
  const catalogControls = pkg.catalog.catalog.controls as { id: string; title: string; props?: Prop[] }[];
  const controls = new Map(catalogControls.map((c) => [c.id, c]));
  const components = new Map((ssp["system-implementation"].components as { uuid: string; title: string }[]).map((c) => [c.uuid, c.title]));
  const requirements = ssp["control-implementation"]["implemented-requirements"] as unknown as {
    uuid: string;
    "control-id": string;
    props?: Prop[];
    "implementation-status"?: { state: string };
    "by-components"?: ByComponent[];
  }[];

  const rows = requirements.map((req): ReviewRow => {
    const control = controls.get(req["control-id"]);
    return {
      requirementUuid: req.uuid,
      controlId: req["control-id"],
      code: control?.props?.find((p) => p.name === CODE_PROP)?.value ?? req["control-id"],
      title: control?.title ?? "",
      implementationStatus: req["implementation-status"]?.state ?? null,
      appStatus: appProp(req.props, appNs, APP_STATUS_PROP),
      effectiveStatus: appProp(req.props, appNs, "effective-status"),
      effectiveSource: appProp(req.props, appNs, "effective-source"),
      overridesInherited: appProp(req.props, appNs, "overrides-inherited") === "true",
      entries: (req["by-components"] ?? []).map((b) => ({
        componentTitle: components.get(b["component-uuid"]) ?? b["component-uuid"],
        componentUuid: b["component-uuid"],
        implementationStatus: b["implementation-status"]?.state ?? null,
        appStatus: ENTRY_STATUS_PROPS.map((name) => appProp(b.props, appNs, name)).find((v) => v !== null) ?? null,
        customerHalf: appProp(b.props, appNs, "customer-half"),
        risk: appProp(b.props, appNs, "risk"),
        description: b.description ?? "",
        remarks: b.remarks ?? null,
      })),
    };
  });

  return {
    systemName: ssp["system-characteristics"]["system-name"],
    state: ssp["system-characteristics"].status.state,
    generatedAt: ssp.metadata["last-modified"],
    documentVersion: ssp.metadata.version ?? "",
    documentId: ssp.metadata["document-ids"]?.[0]?.identifier ?? null,
    rows,
    assessment: buildAssessmentReview(pkg, appNs),
  };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export type ReviewControlRef = { controlId: string; code: string; title: string };
export type ReviewObservation = { uuid: string; title: string; description: string; methods: string[]; collected: string; origins: string[]; evidence: string[]; kind: string | null };
export type ReviewFinding = {
  uuid: string;
  title: string;
  description: string;
  /** OSCAL finding-target state: satisfied or not-satisfied. */
  state: string;
  /** The app's Check-up outcome (an app prop), or null. */
  outcome: string | null;
  statementId: string;
  control: ReviewControlRef | null;
  observations: ReviewObservation[];
  risks: string[];
  origins: string[];
};
export type ReviewRisk = { uuid: string; title: string; description: string; state: string; appStatus: string | null; source: string | null };
export type ReviewResult = {
  uuid: string;
  title: string;
  description: string;
  start: string;
  end: string | null;
  /** "internal-audit" or "self-assessment" (an app prop), or null. */
  kind: string | null;
  controls: ReviewControlRef[];
  findings: ReviewFinding[];
  /** Observations no finding relates (a withdrawal, a Self-Assessment answer). */
  otherObservations: ReviewObservation[];
  risks: ReviewRisk[];
};
export type AssessmentReview = {
  plan: {
    title: string;
    version: string;
    importSsp: string;
    controls: ReviewControlRef[];
    subjects: string[];
    tasks: { title: string; description: string; start: string | null; end: string | null }[];
    activities: { title: string; steps: string[] }[];
  } | null;
  results: { title: string; version: string; importAp: string; results: ReviewResult[] } | null;
};

/**
 * The Assessment Plan and Assessment Results of the package (#454), read only from the package object like the SSP rows: nothing
 * when the package has neither (the System has no closed Internal Audit). Generic: results are listed in package order, whatever
 * their kind, and observations are tied to findings only through `related-observations`.
 */
export function buildAssessmentReview(pkg: OscalPackage, appNs: string): AssessmentReview | null {
  const planDoc = "assessmentPlan" in pkg ? obj(obj(pkg.assessmentPlan)["assessment-plan"]) : null;
  const resultsDoc = "assessmentResults" in pkg ? obj(obj(pkg.assessmentResults)["assessment-results"]) : null;
  if (!planDoc && !resultsDoc) return null;

  const catalogControls = pkg.catalog.catalog.controls as { id: string; title: string; props?: Prop[] }[];
  const controls = new Map(catalogControls.map((c) => [c.id, c]));
  const controlRef = (id: string): ReviewControlRef => {
    const c = controls.get(id);
    return { controlId: id, code: c?.props?.find((p) => p.name === CODE_PROP)?.value ?? id, title: c?.title ?? "" };
  };
  const reviewed = (block: unknown): ReviewControlRef[] =>
    list(obj(block)["control-selections"]).flatMap((sel) => list(sel["include-controls"]).map((inc) => controlRef(text(inc["control-id"]))));
  const components = new Map((pkg.ssp["system-security-plan"]["system-implementation"].components as { uuid: string; title: string }[]).map((c) => [c.uuid, c.title]));
  const prop = (props: unknown, name: string) => list(props).find((p) => p.name === name && p.ns === appNs)?.value as string | undefined;

  const plan: AssessmentReview["plan"] = planDoc && {
    title: text(obj(planDoc.metadata).title),
    version: text(obj(planDoc.metadata).version),
    importSsp: text(obj(planDoc["import-ssp"]).href),
    controls: reviewed(planDoc["reviewed-controls"]),
    subjects: list(planDoc["assessment-subjects"]).flatMap((s) => list(s["include-subjects"]).map((r) => components.get(text(r["subject-uuid"])) ?? text(r["subject-uuid"]))),
    tasks: list(planDoc.tasks).map((t) => {
      const range = obj(obj(t.timing)["within-date-range"]);
      return { title: text(t.title), description: text(t.description), start: text(range.start) || null, end: text(range.end) || null };
    }),
    activities: list(obj(planDoc["local-definitions"]).activities).map((a) => ({ title: text(a.title), steps: list(a.steps).map((st) => text(st.description)) })),
  };

  let results: AssessmentReview["results"] = null;
  if (resultsDoc) {
    const parties = new Map(list(obj(resultsDoc.metadata).parties).map((p) => [text(p.uuid), text(p.name)]));
    const names = (origins: unknown) => list(origins).flatMap((o) => list(o.actors).map((a) => parties.get(text(a["actor-uuid"])) ?? text(a["actor-uuid"])));
    results = {
      title: text(obj(resultsDoc.metadata).title),
      version: text(obj(resultsDoc.metadata).version),
      importAp: text(obj(resultsDoc["import-ap"]).href),
      results: list(resultsDoc.results).map((r): ReviewResult => {
        const observations = new Map(
          list(r.observations).map((o): [string, ReviewObservation] => [
            text(o.uuid),
            {
              uuid: text(o.uuid),
              title: text(o.title),
              description: text(o.description),
              methods: (Array.isArray(o.methods) ? o.methods : []).map(String),
              collected: text(o.collected),
              origins: names(o.origins),
              evidence: list(o["relevant-evidence"]).map((e) => text(e.href)),
              kind: prop(o.props, "observation-kind") ?? null,
            },
          ]),
        );
        const statements = new Map(list(obj(r["reviewed-controls"])["control-selections"]).flatMap((sel) => list(sel["include-controls"]).flatMap((inc) => (Array.isArray(inc["statement-ids"]) ? inc["statement-ids"] : []).map((sid): [string, string] => [String(sid), text(inc["control-id"])]))));
        const risks = new Map(list(r.risks).map((k): [string, ReviewRisk] => [text(k.uuid), { uuid: text(k.uuid), title: text(k.title), description: text(k.description), state: text(k.status), appStatus: prop(k.props, "risk-status") ?? null, source: prop(k.props, "risk-source") ?? null }]));
        const related = new Set<string>();
        const findings = list(r.findings).map((f): ReviewFinding => {
          const target = obj(f.target);
          const mine = list(f["related-observations"]).flatMap((ref) => observations.get(text(ref["observation-uuid"])) ?? []);
          mine.forEach((o) => related.add(o.uuid));
          const statementId = text(target["target-id"]);
          const controlId = statements.get(statementId);
          return {
            uuid: text(f.uuid),
            title: text(f.title),
            description: text(f.description),
            state: text(obj(target.status).state),
            outcome: prop(f.props, "check-up-outcome") ?? null,
            statementId,
            control: controlId ? controlRef(controlId) : null,
            observations: mine,
            risks: list(f["related-risks"]).map((ref) => text(ref["risk-uuid"])),
            origins: names(f.origins),
          };
        });
        return {
          uuid: text(r.uuid),
          title: text(r.title),
          description: text(r.description),
          start: text(r.start),
          end: text(r.end) || null,
          kind: prop(r.props, "result-kind") ?? null,
          controls: reviewed(r["reviewed-controls"]),
          findings,
          otherObservations: [...observations.values()].filter((o) => !related.has(o.uuid)),
          risks: [...risks.values()],
        };
      }),
    };
  }
  return { plan, results };
}
