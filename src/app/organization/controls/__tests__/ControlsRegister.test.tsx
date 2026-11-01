import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import { parseCsv } from "@/test/csv-parse";
import { ControlsRegister } from "../ControlsRegister";
import type { OrgControlRow, OrgView } from "../controls-types";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/lib/download-csv", () => ({ downloadCsv: vi.fn() }));
// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The page's Ctrl+K registration, captured so a test can pick an item the way the header's palette does.
const registration = vi.hoisted(() => ({
  current: null as null | { items: { label: string; href: string; meta: string }[]; onSelect?: (item: { href: string }) => void },
}));
vi.mock("@/components/PaletteProvider", () => ({
  usePagePalette: (value: NonNullable<typeof registration.current>) => {
    registration.current = value;
  },
}));

const OLIVE = "u-olive";

function row(code: string, over: Partial<OrgControlRow> = {}): OrgControlRow {
  return {
    id: `id-${code}`,
    code,
    title: `Title of ${code}`,
    applicability: "ORGANIZATIONAL",
    category: "A.5 Organizational controls",
    summary: `Summary of ${code}`,
    ownerId: null,
    ownerName: null,
    status: "NOT_STARTED",
    description: null,
    updatedAt: null,
    updatedByName: null,
    canEdit: false,
    systemCount: 0,
    frameworks: ["ISO/IEC 27001:2022"],
    origin: null,
    history: [],
    ...over,
  };
}
const mine = { ownerId: OLIVE, ownerName: "Olive Owner", canEdit: true };
const pat = { ownerId: "u-pat", ownerName: "Pat Peer" };

/**
 * Seven Controls, the user being Olive, a Control Owner (she edits only her own):
 *   A.5.1 Olive, Fulfilled      A.5.2 Olive, In Progress        A.5.3 Both, Pat, Not Started (4 Systems)
 *   A.6.1 Pat, Waived           A.7.1 nobody, Not Applicable    4.1 clause, Olive, Not Started
 *   CCM-1 Supplementary Both, Olive, Fulfilled (CSA CCM tab)
 * Totals: Fulfilled 2, In Progress 1, Not Started 2, Waived 1, N/A 1 (29%); Both 2, 1 Fulfilled.
 */
const ROWS: OrgControlRow[] = [
  row("A.5.1", {
    ...mine,
    status: "FULFILLED",
    description: "Policy approved",
    updatedAt: "2026-10-30T09:00:00.000Z",
    updatedByName: "Olive Owner",
    history: [{ at: "2026-10-30T09:00:00.000Z", by: "Olive Owner", from: "IN_PROGRESS", to: "FULFILLED" }],
  }),
  row("A.5.2", { ...mine, status: "IN_PROGRESS", description: "Scoping started" }),
  row("A.5.3", { ...pat, applicability: "BOTH", systemCount: 4 }),
  row("A.6.1", { ...pat, category: "A.6 People controls", status: "WAIVED", description: "Accepted by the risk committee" }),
  row("A.7.1", { category: "A.7 Physical controls", status: "NOT_APPLICABLE", description: "No datacenter" }),
  row("4.1", { ...mine, category: "4 Context of the organization" }),
  row("CCM-1", { ...mine, applicability: "BOTH", category: "A.8 Technological controls", status: "FULFILLED", systemCount: 3, origin: { key: "fw-ccm", label: "CSA CCM:4.1" } }),
];

function renderRegister(over: Partial<OrgView> = {}, props: { initialMine?: boolean } = {}) {
  const view: OrgView = { userId: OLIVE, userName: "Olive Owner", role: "SYSTEM_OWNER", roleLabel: "System Owner", rows: ROWS, ...over };
  return render(<ControlsRegister view={view} {...props} />);
}

const table = () => screen.getByRole("table", { name: "Organization Controls" });
const codesShown = () =>
  within(table())
    .getAllByRole("row")
    .map((r) => r.getAttribute("aria-label"))
    .filter((label): label is string => !!label)
    .map((label) => label.split(" ")[0]);
const rowOf = (code: string) => within(table()).getByRole("row", { name: new RegExp(`^${code.replace(".", "\\.")} `) });
const cards = () => within(screen.getByRole("region", { name: "Views" }));

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const saved = (code: string, status: string, description: string | null) => ({
  id: `id-${code}`,
  implementation: { status, description, updatedBy: { id: OLIVE, name: "Olive Owner" }, updatedAt: "2026-11-01T08:00:00.000Z" },
});

beforeEach(() => {
  registration.current = null;
  vi.mocked(downloadCsv).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ControlsRegister: hero, cards and tabs (#284)", () => {
  it("states the live figures, draws the ring and links to the Statement of Applicability", () => {
    renderRegister();
    const hero = screen.getByRole("region", { name: "Organization Control Implementations" });
    expect(within(hero).getByText("Organization")).toBeInTheDocument();
    expect(hero).toHaveTextContent("How the Organization implements its 7 Organizational and Both Controls. 29% are Fulfilled.");
    expect(hero).toHaveTextContent("1 of 2 Both Controls are Fulfilled and inherited by the Systems they apply to; 2 Controls have not been started.");
    expect(screen.getByRole("img", { name: "29% of 7 Controls are Fulfilled" })).toBeInTheDocument();
    const legend = within(screen.getByRole("list", { name: "Controls by status" }));
    expect(legend.getByRole("button", { name: /2 Not Started/ })).toBeInTheDocument();
    expect(legend.getByRole("button", { name: /2 Fulfilled/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Statement of Applicability →" })).toHaveAttribute("href", "/statement-of-applicability");
  });

  it("counts every card and filters when one is pressed, toggling back off", async () => {
    const user = userEvent.setup();
    renderRegister();
    for (const [label, count] of [["All Controls", "7"], ["Controls I own", "4"], ["Not Started", "2"], ["Waived or N/A", "2"], ["No Control Owner", "1"]]) {
      expect(cards().getByRole("button", { name: new RegExp(`^${label}`) })).toHaveTextContent(count);
    }
    const notStarted = cards().getByRole("button", { name: /^Not Started/ });
    expect(notStarted).toHaveAttribute("aria-pressed", "false");
    await user.click(notStarted);
    expect(notStarted).toHaveAttribute("aria-pressed", "true");
    expect(codesShown()).toEqual(["A.5.3", "4.1"]);
    await user.click(notStarted);
    expect(codesShown()).toHaveLength(7);

    await user.click(cards().getByRole("button", { name: /^Waived or N\/A/ }));
    expect(codesShown()).toEqual(["A.6.1", "A.7.1"]);
    await user.click(cards().getByRole("button", { name: /^No Control Owner/ }));
    expect(codesShown()).toEqual(["A.7.1"]);
  });

  it("filters from the ring's legend, Waived and Not Applicable sharing one view", async () => {
    const user = userEvent.setup();
    renderRegister();
    const legend = within(screen.getByRole("list", { name: "Controls by status" }));
    await user.click(legend.getByRole("button", { name: /Fulfilled/ }));
    expect(codesShown()).toEqual(["A.5.1", "CCM-1"]);
    await user.click(legend.getByRole("button", { name: /Waived/ }));
    expect(codesShown()).toEqual(["A.6.1", "A.7.1"]);
    expect(legend.getByRole("button", { name: /Not Applicable/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("starts on the Controls the user owns for ?mine=1", () => {
    renderRegister({}, { initialMine: true });
    expect(cards().getByRole("button", { name: /^Controls I own/ })).toHaveAttribute("aria-pressed", "true");
    // In the status groups' order: Not Started, In Progress, Fulfilled
    expect(codesShown()).toEqual(["4.1", "A.5.2", "A.5.1", "CCM-1"]);
  });

  it("shows a tab per theme and origin Framework with counts, and hides the empty ones", async () => {
    const user = userEvent.setup();
    renderRegister();
    const tabs = within(screen.getByRole("tablist", { name: "Themes" }));
    expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "All7",
      "Clauses 4–101",
      "A.5 Organizational3",
      "A.6 People1",
      "A.7 Physical1",
      "CSA CCM:4.11",
    ]);
    expect(tabs.queryByRole("tab", { name: /A\.8/ })).not.toBeInTheDocument();
    await user.click(tabs.getByRole("tab", { name: /A\.5 Organizational/ }));
    expect(tabs.getByRole("tab", { name: /A\.5 Organizational/ })).toHaveAttribute("aria-selected", "true");
    expect(codesShown()).toEqual(["A.5.3", "A.5.2", "A.5.1"]);
    // The Supplementary Control is in its Framework's tab, not in A.8
    await user.click(tabs.getByRole("tab", { name: /CSA CCM/ }));
    expect(codesShown()).toEqual(["CCM-1"]);
  });

  it("counts the tabs over the card, search and Applies to filters", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(cards().getByRole("button", { name: /^Not Started/ }));
    const tabs = within(screen.getByRole("tablist", { name: "Themes" }));
    expect(tabs.getByRole("tab", { name: /^All/ })).toHaveTextContent("2");
    expect(tabs.getByRole("tab", { name: /A\.5 Organizational/ })).toHaveTextContent("1");
    expect(tabs.getByRole("tab", { name: /A\.6 People/ })).toHaveTextContent("0");
  });
});

describe("ControlsRegister: search, Applies to, grouping (#284)", () => {
  it("searches code, title, description and owner, and says how many are shown", async () => {
    const user = userEvent.setup();
    renderRegister();
    expect(screen.getByText("7 of 7 Controls")).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Search Controls" });
    await user.type(search, "pat peer");
    expect(codesShown()).toEqual(["A.5.3", "A.6.1"]);
    expect(screen.getByText("2 of 7 Controls")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "datacenter");
    expect(codesShown()).toEqual(["A.7.1"]);
    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText("No Controls match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(codesShown()).toHaveLength(7);
  });

  it("focuses the search box with /", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search Controls" })).toHaveFocus();
  });

  it("filters by Applies to", async () => {
    const user = userEvent.setup();
    renderRegister();
    const applies = within(screen.getByRole("group", { name: "Applies to" }));
    await user.click(applies.getByRole("button", { name: "Both" }));
    expect(codesShown()).toEqual(["A.5.3", "CCM-1"]);
    await user.click(applies.getByRole("button", { name: "Organizational" }));
    expect(codesShown()).toHaveLength(5);
    await user.click(applies.getByRole("button", { name: "All" }));
    expect(codesShown()).toHaveLength(7);
  });

  it("shows no last-updated date for a row nobody edited, and keeps it for one with history only", async () => {
    const user = userEvent.setup();
    const at = "2026-10-01T00:00:00.000Z";
    renderRegister({
      rows: [
        row("N.1", { ...mine, updatedAt: at }),
        row("N.2", { ...mine, updatedAt: at, history: [{ at, by: "System", from: "FULFILLED", to: "IN_PROGRESS" }] }),
      ],
    });
    expect(within(rowOf("N.1")).queryByText("1 Oct 2026")).not.toBeInTheDocument();
    expect(within(rowOf("N.2")).getByText("1 Oct 2026")).toBeInTheDocument();
    await user.click(rowOf("N.1"));
    expect(screen.queryByText(/^Last updated d/)).not.toBeInTheDocument();
  });

  it("shows the Both Control's reach next to its title", () => {
    renderRegister();
    expect(within(rowOf("A.5.3")).getByText("reaches 4 Systems")).toBeInTheDocument();
    expect(within(rowOf("CCM-1")).getByText("inherited by 3 Systems")).toBeInTheDocument();
    expect(within(rowOf("A.5.1")).queryByText(/Systems/)).not.toBeInTheDocument();
  });

  it("groups by status by default, with the counts", () => {
    renderRegister();
    const groupRows = within(table()).getAllByText(/^\d+ Controls?$/);
    expect(groupRows.map((el) => el.parentElement?.textContent)).toEqual([
      "Not Started2 Controls",
      "In Progress1 Control",
      "Fulfilled2 Controls",
      "Waived1 Control",
      "Not Applicable1 Control",
    ]);
  });

  it("groups by owner with each owner's stacked bar and the count of each status beside it, labelled for screen readers", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "Owner" }));
    const scope = within(table());
    // Olive: A.5.1 Fulfilled, A.5.2 In Progress, 4.1 Not Started, CCM-1 Fulfilled
    expect(scope.getByRole("img", { name: "Statuses: 1 Not Started, 1 In Progress, 2 Fulfilled" })).toBeInTheDocument();
    const olive = scope.getByText("Olive Owner", { selector: ".oc-grp-in span" }).closest(".oc-grp-in") as HTMLElement;
    expect(within(olive).getByRole("img", { name: "1 Not Started" })).toHaveTextContent("1");
    expect(within(olive).getByRole("img", { name: "1 In Progress" })).toBeInTheDocument();
    expect(within(olive).getByRole("img", { name: "2 Fulfilled" })).toHaveTextContent("2");
    expect(within(olive).queryByRole("img", { name: /Waived/ })).not.toBeInTheDocument();
    // Pat: A.5.3 Not Started, A.6.1 Waived; nobody: A.7.1 Not Applicable
    const patGroup = scope.getByText("Pat Peer", { selector: ".oc-grp-in span" }).closest(".oc-grp-in") as HTMLElement;
    expect(within(patGroup).getByRole("img", { name: "1 Waived" })).toBeInTheDocument();
    expect(within(patGroup).getByRole("img", { name: "1 Not Started" })).toBeInTheDocument();
    const nobody = scope.getByText("No Control Owner", { selector: ".oc-grp-in span" }).closest(".oc-grp-in") as HTMLElement;
    expect(within(nobody).getByRole("img", { name: "1 Not Applicable" })).toBeInTheDocument();
    // No owner first
    expect(scope.getAllByText(/^\d+ Controls?$/).map((el) => el.parentElement?.firstChild?.textContent)).toEqual(["No Control Owner", "Olive Owner", "Pat Peer"]);
  });

  it("shows no group rows when not grouped, and no counts beside a status group", async () => {
    const user = userEvent.setup();
    renderRegister();
    expect(within(table()).queryByRole("img", { name: /^\d+ Fulfilled$/ })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "None" }));
    expect(within(table()).queryByText(/^\d+ Controls?$/)).not.toBeInTheDocument();
    expect(codesShown()).toHaveLength(7);
  });
});

describe("ControlsRegister: the editor (#284)", () => {
  it("opens a row on click, Enter and Space, and closes it again", async () => {
    const user = userEvent.setup();
    renderRegister();
    const first = rowOf("A.5.1");
    expect(first).toHaveAttribute("aria-expanded", "false");
    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("form", { name: "Edit A.5.1" })).toBeInTheDocument();
    await user.click(first);
    expect(screen.queryByRole("form", { name: "Edit A.5.1" })).not.toBeInTheDocument();

    rowOf("A.5.2").focus();
    await user.keyboard("{Enter}");
    expect(rowOf("A.5.2")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(rowOf("A.5.2")).toHaveAttribute("aria-expanded", "false");
  });

  it("shows what it does for Systems, the Control, the history and the last update", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(rowOf("A.5.1"));
    expect(screen.getByText("Counts as this status on every System with ISO/IEC 27001:2022 in scope.")).toBeInTheDocument();
    expect(screen.getByText("Summary of A.5.1")).toBeInTheDocument();
    expect(screen.getByText(/30 Oct 2026 · Olive Owner set/)).toHaveTextContent("30 Oct 2026 · Olive Owner set Fulfilled (was In Progress)");
    expect(screen.getByText("Last updated 30 Oct 2026 by Olive Owner")).toBeInTheDocument();
    await user.click(rowOf("A.5.2"));
    expect(screen.getByText("No status change recorded yet.")).toBeInTheDocument();
  });

  it("refuses Waived and Not Applicable without a reason, with the API's text, and offers reason templates", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(rowOf("A.5.2"));
    const form = within(screen.getByRole("form", { name: "Edit A.5.2" }));
    expect(form.queryByRole("button", { name: /Risk accepted/ })).not.toBeInTheDocument();
    await user.click(form.getByRole("radio", { name: "Waived" }));
    await user.clear(form.getByRole("textbox"));
    expect(form.getByText("A description is required to set the status to Waived or Not Applicable")).toBeInTheDocument();
    expect(form.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(form.getByRole("button", { name: /Risk accepted by the risk committee on/ }));
    expect(form.getByRole("textbox")).toHaveValue("Risk accepted by the risk committee on ");
    expect(form.queryByText(/A description is required/)).not.toBeInTheDocument();
    expect(form.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("saves through the route, then updates the row, the hero, the cards and the tabs from the response", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ body: { control: saved("A.5.2", "FULFILLED", "Rolled out") } }));
    renderRegister();
    await user.click(rowOf("A.5.2"));
    const form = within(screen.getByRole("form", { name: "Edit A.5.2" }));
    await user.click(form.getByRole("radio", { name: "Fulfilled" }));
    await user.clear(form.getByRole("textbox"));
    await user.type(form.getByRole("textbox"), "Rolled out");
    await user.click(form.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit A.5.2" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/organization/controls/id-A.5.2");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "FULFILLED", description: "Rolled out" });
    expect(within(rowOf("A.5.2")).getByText("Fulfilled")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("Rolled out")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("1 Nov 2026")).toBeInTheDocument();
    // 3 of 7 are now Fulfilled: 43%
    expect(screen.getByRole("img", { name: "43% of 7 Controls are Fulfilled" })).toBeInTheDocument();
    expect(cards().getByRole("button", { name: /^Not Started/ })).toHaveTextContent("2");
    expect(screen.getByText("A.5.2 saved as Fulfilled")).toBeInTheDocument();
    // The history shows the new change first
    await user.click(rowOf("A.5.2"));
    expect(screen.getByText(/1 Nov 2026 · Olive Owner set/)).toHaveTextContent("set Fulfilled (was In Progress)");
  });

  it("shows the API's error and keeps the editor open when a save fails", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ status: 403, body: { error: "Only the Control's Control Owner, a Compliance Manager or an Admin can edit its Organization Control Implementation" } }));
    renderRegister();
    await user.click(rowOf("A.5.1"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Control's Control Owner");
    expect(screen.getByRole("form", { name: "Edit A.5.1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(within(rowOf("A.5.1")).getByText("Policy approved")).toBeInTheDocument();
  });

  it("shows a saving state while the request is out", async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
    renderRegister();
    await user.click(rowOf("A.5.1"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    release(new Response(JSON.stringify({ control: saved("A.5.1", "FULFILLED", "Policy approved") }), { status: 200 }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Edit A.5.1" })).not.toBeInTheDocument());
  });

  it("Save and next opens the next editable row in view, skipping the ones the user can't edit", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ body: { control: saved("A.5.2", "IN_PROGRESS", "Scoping started") } }));
    renderRegister();
    // Status groups: Not Started (A.5.3 no edit, 4.1), In Progress (A.5.2), Fulfilled (A.5.1, CCM-1), ...
    await user.click(rowOf("A.5.2"));
    await user.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => expect(screen.getByRole("form", { name: "Edit A.5.1" })).toBeInTheDocument());
    expect(rowOf("A.5.1")).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("form", { name: "Edit A.5.2" })).not.toBeInTheDocument();
  });

  it("offers no Save and next on the last editable row", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(rowOf("CCM-1"));
    expect(screen.queryByRole("button", { name: "Save and next" })).not.toBeInTheDocument();
  });

  it("saves with Ctrl+Enter and cancels with Escape and Cancel", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ body: { control: saved("A.5.1", "FULFILLED", "Policy approved") } }));
    renderRegister();
    await user.click(rowOf("A.5.1"));
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("form", { name: "Edit A.5.1" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(rowOf("A.5.1"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit A.5.1" })).not.toBeInTheDocument();

    await user.click(rowOf("A.5.1"));
    await user.click(screen.getByRole("textbox"));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("gives a user who can't edit a read-only note, with no editor and no checkbox", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(rowOf("A.6.1"));
    expect(screen.getByText("You are viewing as Olive Owner, System Owner: you can change the Controls you own. A Compliance Manager or an Admin can change any.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Edit A.6.1" })).not.toBeInTheDocument();
    expect(within(rowOf("A.6.1")).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(rowOf("A.5.1")).getByRole("checkbox", { name: "Select A.5.1" })).toBeInTheDocument();
  });

  it("gives a read-only role no checkboxes at all", () => {
    renderRegister({ rows: ROWS.map((r) => ({ ...r, canEdit: false })), role: "VIEWER", roleLabel: "Viewer" });
    expect(screen.queryAllByRole("checkbox").filter((box) => !box.hasAttribute("disabled"))).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "Select all shown" })).toBeDisabled();
  });
});

describe("ControlsRegister: bulk Set status (#284)", () => {
  async function select(user: ReturnType<typeof userEvent.setup>, codes: string[]) {
    for (const code of codes) await user.click(within(rowOf(code)).getByRole("checkbox", { name: `Select ${code}` }));
  }

  it("offers the bar only with a selection, and select all picks only the editable rows in view", async () => {
    const user = userEvent.setup();
    renderRegister();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Select all shown" }));
    const bar = within(screen.getByRole("region", { name: "Bulk actions" }));
    expect(bar.getByText("4")).toBeInTheDocument();
    expect(bar.getByText(/selected/)).toBeInTheDocument();
    await user.click(bar.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("needs a reason for Waived and Not Applicable, then applies one status to every selected Control", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch((_url, init) => {
      const { controlIds, status } = JSON.parse(init.body as string);
      return { body: { controls: controlIds.map((id: string) => saved(id.replace("id-", ""), status, "Not relevant") ).map((c: { id: string }, i: number) => ({ ...c, id: controlIds[i] })) } };
    });
    renderRegister();
    await select(user, ["A.5.1", "A.5.2"]);
    await user.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Set status…" }));
    const dialog = within(screen.getByRole("dialog", { name: "Set the status of 2 Controls" }));
    await user.selectOptions(dialog.getByRole("combobox"), "NOT_APPLICABLE");
    expect(dialog.getByText("A description is required to set the status to Waived or Not Applicable")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Apply to 2" })).toBeDisabled();
    await user.type(dialog.getByRole("textbox"), "Not relevant");
    await user.click(dialog.getByRole("button", { name: "Apply to 2" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/organization/controls");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ controlIds: ["id-A.5.1", "id-A.5.2"], status: "NOT_APPLICABLE", description: "Not relevant" });
    expect(within(rowOf("A.5.1")).getByText("Not Applicable")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("Not Applicable")).toBeInTheDocument();
    expect(screen.getByText("2 Controls set to Not Applicable")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
    expect(cards().getByRole("button", { name: /^Waived or N\/A/ })).toHaveTextContent("4");
  });

  it("sends no description when it is left empty, so each Control keeps its own", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch((_url, init) => ({ body: { controls: JSON.parse(init.body as string).controlIds.map((id: string) => ({ id, implementation: { status: "FULFILLED", description: "kept", updatedBy: { name: "Olive Owner" }, updatedAt: "2026-11-01T08:00:00.000Z" } })) } }));
    renderRegister();
    await select(user, ["A.5.2", "4.1"]);
    await user.click(screen.getByRole("button", { name: "Set status…" }));
    await user.selectOptions(screen.getByRole("combobox"), "FULFILLED");
    expect(screen.getByText("(kept as is when empty)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply to 2" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ controlIds: ["id-4.1", "id-A.5.2"].sort((a, b) => ["id-A.5.2", "id-4.1"].indexOf(a) - ["id-A.5.2", "id-4.1"].indexOf(b)), status: "FULFILLED" });
  });

  it("shows the API's refusal, naming the Controls, and keeps the selection and the rows as they were", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ status: 403, body: { error: "Only a Control's Control Owner, a Compliance Manager or an Admin can edit its Organization Control Implementation", refusedIds: ["id-A.5.2"] } }));
    renderRegister();
    await select(user, ["A.5.1", "A.5.2"]);
    await user.click(screen.getByRole("button", { name: "Set status…" }));
    await user.click(screen.getByRole("button", { name: "Apply to 2" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only a Control's Control Owner.*: A\.5\.2/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("In Progress")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
  });
});

describe("ControlsRegister: CSV and palette (#284)", () => {
  it("downloads the rows in the current view, in the table's order", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(within(screen.getByRole("tablist", { name: "Themes" })).getByRole("tab", { name: /A\.5 Organizational/ }));
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0];
    expect(filename).toMatch(/^Organization-Controls-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed.slice(1).map((line) => line[0])).toEqual(["A.5.3", "A.5.2", "A.5.1"]);
    expect(parsed[3][5]).toBe("Fulfilled");
  });

  it("downloads nothing to download when no Control is in view", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "zzz");
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  });

  it("lists every Control in the palette and opens the picked one's row, clearing what hid it", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(cards().getByRole("button", { name: /^Not Started/ }));
    expect(registration.current!.items.map((item) => item.label)).toEqual(ROWS.map((r) => `${r.code} Title of ${r.code}`));
    expect(registration.current!.items[0]).toMatchObject({ meta: "Fulfilled", href: "#control-id-A.5.1" });
    expect(screen.queryByRole("row", { name: /^A\.6\.1 / })).not.toBeInTheDocument();
    const { act } = await import("@testing-library/react");
    act(() => registration.current!.onSelect!({ href: "#control-id-A.6.1" }));
    expect(rowOf("A.6.1")).toHaveAttribute("aria-expanded", "true");
    expect(cards().getByRole("button", { name: /^All Controls/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("fires no request on render", () => {
    const fetchMock = mockFetch(() => ({ body: {} }));
    renderRegister();
    fireEvent.keyDown(document, { key: "x" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
