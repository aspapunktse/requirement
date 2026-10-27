import type { ProviderDependencyRow } from "@/lib/provider-dependency-rules";
import { SOURCE_COLOR } from "./system-page-types";

/**
 * The figures behind the Providers tab (design proposal A, #245), pure so tests can run every case.
 */

/** A Provider dependency as its card shows it: the Offerings that match this System's applicable Controls, counted by type. */
export type ProviderCardModel = {
  providerId: string;
  name: string;
  canSee: boolean;
  onboarded: boolean;
  /** Full Offerings of the Provider on a Control that applies to this System. */
  full: number;
  /** Shared Offerings of the same kind. */
  shared: number;
  /** The Control codes the Provider covers for this System, in code order; each opens the Control drawer. */
  controls: { code: string; title: string; type: "FULL" | "SHARED"; appliesToProvider: boolean }[];
};

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

export function providerCardOf(dependency: ProviderDependencyRow): ProviderCardModel {
  const controls = dependency.offerings
    .map((offering) => ({ code: offering.control.code, title: offering.control.title, type: offering.type, appliesToProvider: offering.appliesToProvider }))
    .sort(byCode);
  return {
    providerId: dependency.providerId,
    name: dependency.name,
    canSee: dependency.canSee,
    onboarded: dependency.onboarded,
    full: controls.filter((control) => control.type === "FULL").length,
    shared: controls.filter((control) => control.type === "SHARED").length,
    controls,
  };
}

/** A source in the "Where the Controls come from" flow. */
export type FlowNode = {
  key: string;
  name: string;
  /** Controls it supplies: the Organization's and this System's from the status sources, a Provider's from its card. */
  count: number;
  color: string;
  /** A Provider that is not Onboarded yet: shown, but its Offerings give no credit until it is. */
  pending?: boolean;
};

/**
 * The flow's sources, top to bottom: the Organization, each Provider dependency by name, This System. The
 * Organization and This System are the Overview's "Where the status comes from" figures
 * (`view.controls.bySource`); a Provider's count is its card's (Full plus Shared). The Organization and This
 * System are left out when they supply nothing; a Provider dependency is always there, whatever it supplies.
 */
export function flowNodesOf(input: { organization: number; system: number; dependencies: ProviderDependencyRow[] }): FlowNode[] {
  const providers = [...input.dependencies]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((dependency): FlowNode => {
      const card = providerCardOf(dependency);
      return { key: `provider-${dependency.providerId}`, name: dependency.name, count: card.full + card.shared, color: dependency.onboarded ? SOURCE_COLOR["provider-full"] : SOURCE_COLOR["provider-shared"], pending: !dependency.onboarded };
    });
  return [
    ...(input.organization > 0 ? [{ key: "organization", name: "Organization", count: input.organization, color: SOURCE_COLOR.organization }] : []),
    ...providers,
    ...(input.system > 0 ? [{ key: "system", name: "This System", count: input.system, color: SOURCE_COLOR.system }] : []),
  ];
}
