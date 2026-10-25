import type { UserRole } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./systems-config";
import {
  HIGHEST_IMPACT_ORDER,
  isStatus,
  VIEW_KEYS,
  type GroupKey,
  type HighestImpact,
  type RegisterState,
  type SortKey,
  type ViewKey,
} from "./systems-types";

/**
 * The list's state in the URL (search params), so a filtered list can be shared and Back works. Only
 * what differs from the default is written. Parsing never trusts the URL: an unknown value falls back to
 * the default. The two deep links Home uses stay valid:
 * - `?status=<OnboardingStatus>` selects that tab;
 * - `?owner=me` selects the "Owned by me" view for a System Owner, whose own view it is, and the Owner
 *   filter set to the user for every other role.
 */

const SORT_KEYS: SortKey[] = ["name", "status", "owner", "cia", "unit", "prog", "upd"];
const GROUP_KEYS: GroupKey[] = ["", "owner", "unit", "facet"];

export const DEFAULT_STATE: RegisterState = {
  view: "all",
  status: "",
  q: "",
  owners: [],
  units: [],
  facets: [],
  impact: [],
  sort: "name",
  dir: 1,
  group: "",
  page: 1,
  per: DEFAULT_PAGE_SIZE,
};

type Params = { get(name: string): string | null; getAll(name: string): string[] };

const uniq = (values: string[]) => [...new Set(values.filter((value) => value !== ""))];

export function parseRegisterState(params: Params, user: { id: string; role: UserRole }): RegisterState {
  const view = params.get("view");
  const status = params.get("status") ?? "";
  const sort = params.get("sort");
  const group = params.get("group") ?? "";
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const per = Number.parseInt(params.get("per") ?? "", 10);
  const state: RegisterState = {
    view: VIEW_KEYS.includes(view as ViewKey) ? (view as ViewKey) : "all",
    status: isStatus(status) ? status : "",
    q: params.get("q") ?? "",
    owners: uniq(params.getAll("owners")),
    units: uniq(params.getAll("units")),
    facets: uniq(params.getAll("facets")),
    impact: uniq(params.getAll("impact")).filter((value): value is HighestImpact => HIGHEST_IMPACT_ORDER.includes(value as HighestImpact)),
    sort: SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : "name",
    dir: params.get("dir") === "desc" ? -1 : 1,
    group: GROUP_KEYS.includes(group as GroupKey) ? (group as GroupKey) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    per: (PAGE_SIZES as readonly number[]).includes(per) ? per : DEFAULT_PAGE_SIZE,
  };
  if (params.get("owner") === "me") {
    if (user.role === "SYSTEM_OWNER") state.view = "mine";
    else if (!state.owners.includes(user.id)) state.owners = [...state.owners, user.id];
  }
  return state;
}

/** The query string (without "?") for a state: empty when it is the default. */
export function serializeRegisterState(state: RegisterState): string {
  const params = new URLSearchParams();
  if (state.view !== "all") params.set("view", state.view);
  if (state.status) params.set("status", state.status);
  if (state.q) params.set("q", state.q);
  for (const key of ["owners", "units", "facets", "impact"] as const) for (const value of state[key]) params.append(key, value);
  if (state.sort !== "name") params.set("sort", state.sort);
  if (state.dir === -1) params.set("dir", "desc");
  if (state.group) params.set("group", state.group);
  if (state.page > 1) params.set("page", String(state.page));
  if (state.per !== DEFAULT_PAGE_SIZE) params.set("per", String(state.per));
  return params.toString();
}
