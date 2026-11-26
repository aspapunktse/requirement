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
  };
}
