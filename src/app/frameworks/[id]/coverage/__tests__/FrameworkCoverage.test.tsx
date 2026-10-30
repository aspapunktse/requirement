import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import { parseCsv } from "@/test/csv-parse";
import { FrameworkCoverage } from "../FrameworkCoverage";
import type { CoverageRow, CoverageView, LibraryControl, MappedControl } from "../coverage-types";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/frameworks/f1/coverage" }));
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
const registration = vi.hoisted(() => ({ current: null as null | { items: { label: string; href: string; meta: string }[]; onSelect?: (item: { href: string }) => void } }));
vi.mock("@/components/PaletteProvider", () => ({
  usePagePalette: (value: NonNullable<typeof registration.current>) => {
    registration.current = value;
  },
}));

const mapping = (code: string, coverage: "FULL" | "PARTIAL" = "FULL", over: Partial<MappedControl> = {}): MappedControl => ({
  id: `m-${code}`,
  controlId: `c-${code}`,
  code,
  title: `Title of ${code}`,
  coverage,
  rationale: null,
  supplementary: false,
  ...over,
});

const req = (code: string, section: string, over: Partial<CoverageRow> = {}): CoverageRow => ({
  id: `r-${code}`,
  code,
  section,
  title: `Requirement ${code}`,
  text: `Text of ${code}`,
  state: "GAP",
  justification: null,
  acceptedBy: null,
  acceptedAt: null,
  mappings: [],
  ...over,
});

/**
 * A.5: covered (SEC-1 Full), Partial-only gap (SEC-2), no-mapping gap.  A.9: covered (SEC-3 Supplementary), no-mapping gap.
 * A.10: accepted gap.   Open gaps: A.5.2 (Partial), A.5.1, A.9.2 (no mapping).
 */
const ROWS: CoverageRow[] = [
  req("A.5.10", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-1")] }),
  req("A.5.2", "A.5 Organizational", { mappings: [mapping("SEC-2", "PARTIAL")] }),
  req("A.5.1", "A.5 Organizational", { title: "Use of cryptography and password handling" }),
  req("A.9.1", "A.9 Access", { state: "COVERED", mappings: [mapping("SEC-3", "FULL", { supplementary: true })] }),
  req("A.9.2", "A.9 Access"),
  req("A.10.1", "A.10 People", { state: "ACCEPTED_GAP", justification: "Out of scope here", acceptedBy: "Cora", acceptedAt: "2026-10-01T10:00:00.000Z" }),
];

const LIBRARY: LibraryControl[] = [
  { id: "c-SEC-1", code: "SEC-1", title: "Title of SEC-1", supplementary: false },
  { id: "c-SEC-2", code: "SEC-2", title: "Title of SEC-2", supplementary: false },
  { id: "c-SEC-3", code: "SEC-3", title: "Title of SEC-3", supplementary: false },
  { id: "c-SEC-5", code: "SEC-5", title: "Cryptography keys", supplementary: false },
  { id: "c-SEC-6", code: "SEC-6", title: "Physical security", supplementary: false },
];

const view = (over: Partial<CoverageView> = {}): CoverageView => ({
  userId: "u-cm",
  role: "COMPLIANCE_MANAGER",
  roleLabel: "Compliance Manager",
  canCurate: true,
  framework: { id: "f1", name: "Test Act", version: "2022", status: "PUBLISHED", isBase: false, strict: true, reviewGroup: "Network Review", systems: 3 },
  frameworks: [
    { id: "f1", label: "Test Act:2022", status: "PUBLISHED" },
    { id: "f2", label: "Other Act:1", status: "DRAFT" },
  ],
  requirements: ROWS,
  controls: LIBRARY,
  initialSection: null,
  ...over,
});
const readOnlyView = (over: Partial<CoverageView> = {}) => view({ role: "VIEWER", roleLabel: "Viewer", canCurate: false, controls: [], ...over });

const renderLedger = (over: Partial<CoverageView> = {}) => render(<FrameworkCoverage view={view(over)} />);
const table = () => screen.getByRole("table", { name: /Requirements of Test Act:2022/ });
/** The Requirement codes in the table body, in order. */
const codes = () => [...table().querySelectorAll("tbody tr.cv-row")].map((tr) => tr.querySelector("td.code")?.textContent);
const groupNames = () => [...table().querySelectorAll("tbody tr.sy-grp")].map((tr) => tr.textContent);
const rowOf = (code: string) => table().querySelector(`tr[data-id="r-${code}"]`) as HTMLElement;
const stat = (name: RegExp) => within(screen.getByRole("region", { name: "Filters" })).getByRole("button", { name });
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const drawer = () => screen.getByRole("dialog");
const openDrawerOf = async (code: string) => userEvent.click(within(rowOf(code)).getByRole("button", { name: `Open ${code}` }));
/** The toast after a write (the footer count is a status too). */
const notice = () => document.querySelector(".fc-notice");
const shown = () => screen.getByText(/^\d+ of \d+ Requirements?$/).textContent;

type FetchCall = { url: string; method: string; body: unknown };
const calls = (): FetchCall[] =>
  vi.mocked(fetch).mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined }));
const respond = (status = 200, body: unknown = {}) => vi.mocked(fetch).mockResolvedValueOnce(status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  vi.mocked(downloadCsv).mockClear();
  vi.unstubAllGlobals();
  registration.current = null;
});

describe("hero", () => {
  it("shows the name with the version, the chips, the lede, the back link and a ring of what is resolved", () => {
    renderLedger();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Act2022");
    expect(screen.getByText("2022", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByText("Framework coverage")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Frameworks" })).toHaveAttribute("href", "/frameworks");
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Strict")).toBeInTheDocument();
    expect(screen.getByText("Network Review")).toBeInTheDocument();
    expect(screen.queryByText("Base Framework")).not.toBeInTheDocument();
    expect(screen.getByText(/An accepted gap counts as resolved\./)).toBeInTheDocument();
    // 3 of 6 are covered or accepted
    expect(screen.getByRole("img", { name: "50% of 6 Requirements are covered or accepted" })).toBeInTheDocument();
  });

  it("marks the base Framework and a Draft", () => {
    renderLedger({ framework: { ...view().framework, isBase: true, status: "DRAFT", strict: false, reviewGroup: null, systems: null } });
    expect(screen.getByText("Base Framework")).toBeInTheDocument();
    expect(screen.getByText("Base Review Step")).toBeInTheDocument();
    expect(screen.getByText("Draft", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Strict")).not.toBeInTheDocument();
  });

  it("offers the visible Frameworks in a switcher and opens the one picked", async () => {
    renderLedger();
    const select = screen.getByRole("combobox", { name: "Framework" });
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Test Act:2022", "Other Act:1 (Draft)"]);
    expect(select).toHaveValue("f1");
    await userEvent.selectOptions(select, "f2");
    expect(push).toHaveBeenCalledWith("/frameworks/f2/coverage");
  });

  it("curators get no read-only note; other roles do", () => {
    renderLedger();
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
    cleanup();
    render(<FrameworkCoverage view={readOnlyView()} />);
    expect(screen.getByText("Read-only: a Compliance Manager curates mappings and gaps.")).toBeInTheDocument();
  });
});

describe("stat cards and the ring legend are filters", () => {
  it("counts each kind, with a sub-line, and none of them is pressed at first", () => {
    renderLedger();
    const value = (name: RegExp) => stat(name).querySelector(".v")?.textContent;
    expect(value(/^Requirements/)).toBe("6");
    expect(value(/^Covered/)).toBe("2");
    expect(value(/^Open gaps/)).toBe("3");
    expect(value(/^Partial only/)).toBe("1");
    expect(value(/^No mapping/)).toBe("2");
    expect(value(/^Accepted/)).toBe("1");
    expect(stat(/^Open gaps/)).toHaveTextContent("not covered, not accepted");
    // "Requirements" (no filter) is the one that is on.
    expect(stat(/^Requirements/)).toHaveAttribute("aria-pressed", "true");
    for (const name of [/^Covered/, /^Open gaps/, /^Partial only/, /^No mapping/, /^Accepted/]) expect(stat(name)).toHaveAttribute("aria-pressed", "false");
  });

  it("filters the table when pressed and clears when pressed again", async () => {
    renderLedger();
    expect(codes()).toHaveLength(6);
    await userEvent.click(stat(/^Open gaps/));
    expect(stat(/^Open gaps/)).toHaveAttribute("aria-pressed", "true");
    expect(codes()).toEqual(["A.5.1", "A.5.2", "A.9.2"]);
    expect(shown()).toBe("3 of 6 Requirements");
    await userEvent.click(stat(/^Open gaps/));
    expect(codes()).toHaveLength(6);

    await userEvent.click(stat(/^Partial only/));
    expect(codes()).toEqual(["A.5.2"]);
    await userEvent.click(stat(/^No mapping/));
    expect(codes()).toEqual(["A.5.1", "A.9.2"]);
    await userEvent.click(stat(/^Accepted/));
    expect(codes()).toEqual(["A.10.1"]);
    await userEvent.click(stat(/^Covered/));
    expect(codes()).toEqual(["A.5.10", "A.9.1"]);
  });

  it("filters the same way from the ring's legend", async () => {
    renderLedger();
    const legend = screen.getByRole("list", { name: "Requirements by coverage" });
    expect(within(legend).getAllByRole("button").map((b) => b.textContent)).toEqual(["2 covered", "1 accepted", "1 Partial only", "2 no mapping"]);
    await userEvent.click(within(legend).getByRole("button", { name: /Partial only/ }));
    expect(codes()).toEqual(["A.5.2"]);
    expect(within(legend).getByRole("button", { name: /Partial only/ })).toHaveAttribute("aria-pressed", "true");
    expect(stat(/^Partial only/)).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(legend).getByRole("button", { name: /Partial only/ }));
    expect(codes()).toHaveLength(6);
  });
});

describe("tabs, search and order", () => {
  it("has a tab per section plus All, with counts that follow the filter", async () => {
    renderLedger();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All6", "A.53", "A.92", "A.101"]);
    expect(tab(/^A\.5/)).toHaveAttribute("title", "A.5 Organizational");
    await userEvent.click(stat(/^Open gaps/));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All3", "A.52", "A.91", "A.100"]);
  });

  it("shows one section when its tab is picked, and the group rows say covered, gaps and carry a bar", async () => {
    renderLedger();
    expect(groupNames()).toEqual(["A.5 Organizational1/3 covered · 2 gaps", "A.9 Access1/2 covered · 1 gap", "A.10 People0/1 covered"]);
    expect(table().querySelectorAll("tr.sy-grp .fc-bar")).toHaveLength(3);
    await userEvent.click(tab(/^A\.9/));
    expect(tab(/^A\.9/)).toHaveAttribute("aria-selected", "true");
    expect(codes()).toEqual(["A.9.1", "A.9.2"]);
    expect(shown()).toBe("2 of 6 Requirements");
    await userEvent.click(tab(/^All/));
    expect(codes()).toHaveLength(6);
  });

  it("preselects the section ?section= asked for, and ignores one that does not exist", () => {
    renderLedger({ initialSection: "A.9 Access" });
    expect(tab(/^A\.9/)).toHaveAttribute("aria-selected", "true");
    expect(codes()).toEqual(["A.9.1", "A.9.2"]);
    cleanup();
    renderLedger({ initialSection: "Nope" });
    expect(tab(/^All/)).toHaveAttribute("aria-selected", "true");
  });

  it("orders sections and codes numerically", () => {
    renderLedger();
    expect(codes()).toEqual(["A.5.1", "A.5.2", "A.5.10", "A.9.1", "A.9.2", "A.10.1"]);
  });

  it("searches the code, the Requirement and the mapped Controls' code and title", async () => {
    renderLedger();
    const search = screen.getByRole("searchbox", { name: "Search Requirements" });
    await userEvent.click(search);
    await userEvent.paste("cryptography");
    expect(codes()).toEqual(["A.5.1"]);
    await userEvent.clear(search);
    await userEvent.click(search);
    await userEvent.paste("sec-3");
    expect(codes()).toEqual(["A.9.1"]);
    await userEvent.clear(search);
    await userEvent.click(search);
    await userEvent.paste("a.10");
    expect(codes()).toEqual(["A.10.1"]);
    expect(shown()).toBe("1 of 6 Requirements");
  });

  it("focuses the search box on '/'", async () => {
    renderLedger();
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search Requirements" })).toHaveFocus();
  });

  it("puts open gaps first in each section when asked, then accepted, then covered", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Gaps first in each section" }));
    expect(codes()).toEqual(["A.5.1", "A.5.2", "A.5.10", "A.9.2", "A.9.1", "A.10.1"]);
  });

  it("says Nothing to show with the reason, and Clear filters brings everything back", async () => {
    renderLedger();
    await userEvent.click(stat(/^Open gaps/));
    await userEvent.click(tab(/^A\.10/));
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
    expect(screen.getByText("Every Requirement here is covered or accepted.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(codes()).toHaveLength(6);
  });

  it("says so for a Framework with no Requirements", () => {
    renderLedger({ requirements: [] });
    expect(screen.getByText("This Framework has no Requirements yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    expect(screen.getByRole("img", { name: /0 Requirements are covered or accepted/ })).toBeInTheDocument();
  });
});

describe("rows", () => {
  it("shows the code, the Requirement, the mapped Controls with Full or Partial and Supplementary marked, and the state", () => {
    renderLedger();
    const covered = rowOf("A.9.1");
    expect(within(covered).getByText("SEC-3")).toBeInTheDocument();
    expect(within(covered).getByText("Full")).toBeInTheDocument();
    expect(within(covered).getByText("Supplementary")).toBeInTheDocument();
    expect(within(covered).getByText("Covered")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("Partial")).toBeInTheDocument();
    expect(within(rowOf("A.5.2")).getByText("Coverage Gap")).toBeInTheDocument();
    expect(within(rowOf("A.5.1")).getByText("No Control mapped")).toBeInTheDocument();
  });

  it("shows an accepted gap's justification under the Requirement", () => {
    renderLedger();
    expect(within(rowOf("A.10.1")).getByText("“Out of scope here”")).toBeInTheDocument();
    expect(within(rowOf("A.10.1")).getByText("Accepted gap")).toBeInTheDocument();
  });

  it("offers curators the row actions that fit each state", () => {
    renderLedger();
    const names = (code: string) => within(rowOf(code)).queryAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent).filter((n) => !n?.startsWith("Open"));
    expect(names("A.5.1")).toEqual(["Create Supplementary Control for A.5.1", "Accept gap A.5.1"]);
    expect(names("A.10.1")).toEqual(["Edit justification for A.10.1"]);
    expect(names("A.5.10")).toEqual(["Mappings of A.5.10"]);
  });

  it("offers no action, no checkbox and no bulk selection to a role that cannot curate", () => {
    render(<FrameworkCoverage view={readOnlyView()} />);
    expect(screen.queryAllByRole("checkbox", { name: /^Select/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Accept gap|Create Supplementary|Edit justification|Mappings of/ })).not.toBeInTheDocument();
    expect(codes()).toHaveLength(6);
  });
});

describe("Download CSV", () => {
  const download = () => {
    const [text, filename] = vi.mocked(downloadCsv).mock.calls[0];
    return { rows: parseCsv(text.replace(CSV_BOM, "")), filename };
  };

  it("holds the rows in the current view: filter, section and search", async () => {
    renderLedger();
    await userEvent.click(stat(/^Open gaps/));
    await userEvent.click(tab(/^A\.5/));
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    const { rows, filename } = download();
    expect(filename).toMatch(/^Test-Act-2022-coverage-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows[0][1]).toBe("Requirement code");
    expect(rows.slice(1).map((r) => [r[0], r[1], r[3], r[5], r[7]])).toEqual([
      ["A.5 Organizational", "A.5.1", "", "", "Coverage Gap"],
      ["A.5 Organizational", "A.5.2", "SEC-2", "Partial", "Coverage Gap"],
    ]);
  });

  it("holds every Requirement when nothing is filtered, with an accepted gap's justification", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    const { rows } = download();
    expect(rows.slice(1).map((r) => r[1])).toEqual(["A.5.1", "A.5.2", "A.5.10", "A.9.1", "A.9.2", "A.10.1"]);
    expect(rows.find((r) => r[1] === "A.10.1")?.[8]).toBe("Out of scope here");
  });

  it("follows the order of Gaps first", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Gaps first in each section" }));
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(download().rows.slice(1).map((r) => r[1])).toEqual(["A.5.1", "A.5.2", "A.5.10", "A.9.2", "A.9.1", "A.10.1"]);
  });
});

describe("the Requirement drawer", () => {
  it("opens from a row, shows the section, code, title, state and why, and closes with Escape, the button or the scrim", async () => {
    renderLedger();
    await userEvent.click(within(rowOf("A.5.2")).getByText("Requirement A.5.2"));
    const dialog = drawer();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("heading", { name: "A.5.2 Requirement A.5.2" })).toBeInTheDocument();
    expect(within(dialog).getByText("A.5 Organizational")).toBeInTheDocument();
    expect(within(dialog).getByText("Coverage Gap")).toBeInTheDocument();
    expect(within(dialog).getByText(/its mappings are all Partial/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openDrawerOf("A.5.2");
    await userEvent.click(within(drawer()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openDrawerOf("A.5.2");
    await userEvent.click(screen.getByTestId("coverage-drawer-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("walks the visible rows with Previous and Next, wrapping around", async () => {
    renderLedger();
    await userEvent.click(stat(/^Open gaps/));
    await openDrawerOf("A.5.1");
    const title = () => within(drawer()).getByRole("heading", { level: 2 }).textContent;
    await userEvent.click(within(drawer()).getByRole("button", { name: /Next/ }));
    expect(title()).toBe("A.5.2 Requirement A.5.2");
    await userEvent.click(within(drawer()).getByRole("button", { name: /Next/ }));
    expect(title()).toBe("A.9.2 Requirement A.9.2");
    await userEvent.click(within(drawer()).getByRole("button", { name: /Next/ }));
    expect(title()).toBe("A.5.1 Use of cryptography and password handling");
    await userEvent.click(within(drawer()).getByRole("button", { name: /Previous/ }));
    expect(title()).toBe("A.9.2 Requirement A.9.2");
  });

  it("opens a Requirement from the Ctrl+K palette's registration", () => {
    renderLedger();
    const items = registration.current!.items;
    expect(items).toHaveLength(6);
    expect(items.find((i) => i.label === "A.5.2 Requirement A.5.2")?.meta).toBe("Coverage Gap");
    act(() => registration.current!.onSelect!(items.find((i) => i.label.startsWith("A.9.1"))!));
    expect(within(drawer()).getByRole("heading", { level: 2 })).toHaveTextContent("A.9.1");
  });

  it("focuses the field a row action asks for", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("button", { name: "Accept gap A.5.1" }));
    expect(within(drawer()).getByRole("textbox", { name: "Justification" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Create Supplementary Control for A.5.2" }));
    expect(within(drawer()).getByRole("textbox", { name: "Title" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Mappings of A.5.10" }));
    expect(within(drawer()).getByRole("combobox", { name: "Control to map" })).toHaveFocus();
  });

  it("says what a Published Framework does to Systems, and that a Draft reaches none", async () => {
    renderLedger();
    await openDrawerOf("A.5.1");
    expect(within(drawer()).getByText(/Derived live on the 3 Systems you can see that have Test Act:2022 in scope/)).toBeInTheDocument();
    cleanup();
    renderLedger({ framework: { ...view().framework, status: "DRAFT", systems: null } });
    await openDrawerOf("A.5.1");
    expect(within(drawer()).getByText("Test Act:2022 is a Draft, so this Requirement reaches no System until it is published.")).toBeInTheDocument();
  });

  it("shows a read-only role the mappings and no way to change them", async () => {
    render(<FrameworkCoverage view={readOnlyView()} />);
    await openDrawerOf("A.5.2");
    const dialog = drawer();
    expect(within(dialog).getByText("SEC-2")).toBeInTheDocument();
    expect(within(dialog).getByText("Only a Compliance Manager or an Admin changes mappings and gaps.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Control to map" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: /Coverage of/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Remove mapping/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Close the gap")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Suggested")).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await openDrawerOf("A.10.1");
    expect(within(drawer()).getByText("Out of scope here")).toBeInTheDocument();
    expect(within(drawer()).queryByRole("button", { name: "Un-accept" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("drawer writes", () => {
  const base = "/api/frameworks/f1/requirements";

  it("maps a Control by code with the chosen coverage, then refreshes the page", async () => {
    renderLedger();
    await openDrawerOf("A.5.1");
    const dialog = drawer();
    const input = within(dialog).getByRole("combobox", { name: "Control to map" });
    await userEvent.click(input);
    await userEvent.paste("sec-6");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Coverage" }), "PARTIAL");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([{ url: `${base}/r-A.5.1/mappings`, method: "POST", body: { controlId: "c-SEC-6", coverage: "PARTIAL" } }]);
    expect(notice()).toHaveTextContent("SEC-6 mapped to A.5.1");
    expect(input).toHaveValue("");
  });

  it("maps by title too, and refuses a value that names no Control, or one already mapped, without calling the server", async () => {
    renderLedger();
    await openDrawerOf("A.5.2");
    const dialog = drawer();
    const input = within(dialog).getByRole("combobox", { name: "Control to map" });
    await userEvent.click(input);
    await userEvent.paste("no such control");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Pick a Control from the list");
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("title of sec-2");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("SEC-2 is already mapped to A.5.2");
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste("Cryptography keys");
    await userEvent.click(within(dialog).getByRole("button", { name: "Map" }));
    await waitFor(() => expect(calls()).toHaveLength(1));
    expect(calls()[0].body).toEqual({ controlId: "c-SEC-5", coverage: "FULL" });
  });

  it("lists the Control Library in the picker", async () => {
    renderLedger();
    await openDrawerOf("A.5.1");
    const options = [...document.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["SEC-1", "SEC-2", "SEC-3", "SEC-5", "SEC-6"]);
  });

  it("switches a mapping between Full and Partial", async () => {
    renderLedger();
    await openDrawerOf("A.5.2");
    const group = within(drawer()).getByRole("group", { name: "Coverage of SEC-2" });
    expect(within(group).getByRole("button", { name: "Partial" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(group).getByRole("button", { name: "Partial" }));
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(within(group).getByRole("button", { name: "Full" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([{ url: `${base}/r-A.5.2/mappings/m-SEC-2`, method: "PATCH", body: { coverage: "FULL" } }]);
    expect(notice()).toHaveTextContent("SEC-2 is now Full for A.5.2");
  });

  it("removes a mapping after a confirmation, and not when declined", async () => {
    renderLedger();
    await openDrawerOf("A.5.2");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await userEvent.click(within(drawer()).getByRole("button", { name: "Remove mapping to SEC-2" }));
    expect(fetch).not.toHaveBeenCalled();
    respond(204);
    await userEvent.click(within(drawer()).getByRole("button", { name: "Remove mapping to SEC-2" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("Systems that have this Framework in scope are recomputed"));
    expect(calls()).toEqual([{ url: `${base}/r-A.5.2/mappings/m-SEC-2`, method: "DELETE", body: undefined }]);
  });

  it("creates a Supplementary Control with a suggested code and the Requirement's title", async () => {
    renderLedger();
    await openDrawerOf("A.5.2");
    const dialog = drawer();
    expect(within(dialog).getByRole("textbox", { name: "Code" })).toHaveValue("TESTAC-A.5.2");
    expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue("Requirement A.5.2");
    const code = within(dialog).getByRole("textbox", { name: "Code" });
    await userEvent.clear(code);
    await userEvent.click(code);
    await userEvent.paste("TA-1");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and map" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([
      {
        url: `${base}/r-A.5.2/supplementary-control`,
        method: "POST",
        body: { code: "TA-1", title: "Requirement A.5.2", description: "Text of A.5.2", category: "Supplementary", applicability: "ORGANIZATIONAL" },
      },
    ]);
    expect(notice()).toHaveTextContent("Supplementary Control TA-1 created and mapped to A.5.2");
  });

  it("needs a code and a title for the Supplementary Control", async () => {
    renderLedger();
    await openDrawerOf("A.5.2");
    const dialog = drawer();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Title" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create and map" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A code and a title are needed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a gap with a justification, from a template, and needs one", async () => {
    renderLedger();
    await openDrawerOf("A.9.2");
    const dialog = drawer();
    await userEvent.click(within(dialog).getByRole("button", { name: "Accept gap" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A justification is required");
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: /^Compensated by/ }));
    const box = within(dialog).getByRole("textbox", { name: "Justification" });
    expect(box).toHaveValue("Compensated by ");
    await userEvent.click(box);
    await userEvent.paste("the SOC");
    await userEvent.click(within(dialog).getByRole("button", { name: "Accept gap" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([{ url: `${base}/r-A.9.2/gap-acceptance`, method: "PUT", body: { justification: "Compensated by the SOC" } }]);
    expect(notice()).toHaveTextContent("A.9.2 accepted");
  });

  it("shows an accepted gap's box, saves an edited justification, and un-accepts", async () => {
    renderLedger();
    await openDrawerOf("A.10.1");
    const dialog = drawer();
    expect(within(dialog).getByText(/Accepted by Cora on 1 Oct 2026\./)).toBeInTheDocument();
    const box = within(dialog).getByRole("textbox", { name: "Justification" });
    expect(box).toHaveValue("Out of scope here");
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste("Moved to a Supplier");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save justification" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls()[0]).toEqual({ url: `${base}/r-A.10.1/gap-acceptance`, method: "PUT", body: { justification: "Moved to a Supplier" } });

    respond(204);
    // The buttons are disabled while the first write settles.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Un-accept" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("button", { name: "Un-accept" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(calls()[1]).toEqual({ url: `${base}/r-A.10.1/gap-acceptance`, method: "DELETE", body: undefined });
    expect(notice()).toHaveTextContent("A.10.1 is a Coverage Gap again");
  });

  it("suggests Controls mapped elsewhere in the section and with shared title words, and maps one as Full", async () => {
    renderLedger();
    await openDrawerOf("A.5.1");
    const suggestions = within(drawer()).getByLabelText("Suggested Controls");
    // SEC-1 is mapped to A.5.10 in the same section; SEC-5 shares "cryptography" with the title. SEC-2 is also mapped in A.5 (Partial, to A.5.2).
    expect(within(suggestions).getAllByRole("button").map((b) => b.querySelector("b")?.textContent)).toEqual(["SEC-5", "SEC-1", "SEC-2"]);
    await userEvent.click(within(suggestions).getByRole("button", { name: /SEC-5/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([{ url: `${base}/r-A.5.1/mappings`, method: "POST", body: { controlId: "c-SEC-5", coverage: "FULL" } }]);
  });

  it("offers no suggestion for a covered Requirement", async () => {
    renderLedger();
    await openDrawerOf("A.5.10");
    expect(within(drawer()).queryByLabelText("Suggested Controls")).not.toBeInTheDocument();
  });

  it("shows the server's refusal in the drawer and does not refresh", async () => {
    renderLedger();
    await openDrawerOf("A.9.2");
    respond(409, { error: "This Requirement is already mapped to that Control" });
    const input = within(drawer()).getByRole("combobox", { name: "Control to map" });
    await userEvent.click(input);
    await userEvent.paste("SEC-5");
    await userEvent.click(within(drawer()).getByRole("button", { name: "Map" }));
    expect(await within(drawer()).findByRole("alert")).toHaveTextContent("This Requirement is already mapped to that Control");
    expect(refresh).not.toHaveBeenCalled();
    expect(notice()).toBeNull();
  });

  it("follows the page's new data: an accepted gap's justification replaces what was typed, and a covered Requirement drops the gap sections", async () => {
    const { rerender } = renderLedger();
    await openDrawerOf("A.9.2");
    expect(within(drawer()).getByText("Close the gap")).toBeInTheDocument();
    const next = ROWS.map((r) => (r.code === "A.9.2" ? { ...r, state: "COVERED" as const, mappings: [mapping("SEC-5")] } : r));
    rerender(<FrameworkCoverage view={view({ requirements: next })} />);
    expect(within(drawer()).queryByText("Close the gap")).not.toBeInTheDocument();
    expect(within(drawer()).getByText("Covered")).toBeInTheDocument();
    expect(within(drawer()).getByText("SEC-5")).toBeInTheDocument();
  });
});

describe("bulk accept", () => {
  const gapBoxes = () => within(table()).getAllByRole("checkbox", { name: /^Select A/ });

  it("has a checkbox on open gaps only, and a select-all for the visible gaps", () => {
    renderLedger();
    expect(gapBoxes().map((b) => b.getAttribute("aria-label"))).toEqual(["Select A.5.1", "Select A.5.2", "Select A.9.2"]);
    expect(screen.getByRole("checkbox", { name: "Select all visible gaps" })).not.toBeChecked();
  });

  it("shows the bar with the count when gaps are ticked, and Clear empties it", async () => {
    renderLedger();
    expect(screen.queryByRole("group", { name: "Accept the selected gaps" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    const bar = screen.getByRole("group", { name: "Accept the selected gaps" });
    expect(within(bar).getByText("1 gap selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.9.2" }));
    expect(within(bar).getByText("2 gaps selected")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Accept 2" })).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("group", { name: "Accept the selected gaps" })).not.toBeInTheDocument();
    expect(gapBoxes().every((b) => !(b as HTMLInputElement).checked)).toBe(true);
  });

  it("selects every visible gap with the header checkbox, only those in view", async () => {
    renderLedger();
    await userEvent.click(tab(/^A\.5/));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible gaps" }));
    expect(screen.getByText("2 gaps selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select all visible gaps" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible gaps" }));
    expect(screen.queryByText(/gaps? selected/)).not.toBeInTheDocument();
  });

  it("counts and accepts only the ticked gaps that are in view", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.9.2" }));
    await userEvent.click(tab(/^A\.9/));
    expect(screen.getByText("1 gap selected")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Justification for the selected gaps" });
    await userEvent.click(box);
    await userEvent.paste("Not applicable");
    await userEvent.click(screen.getByRole("button", { name: "Accept 1" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()).toEqual([{ url: "/api/frameworks/f1/gap-acceptances", method: "PUT", body: { requirementIds: ["r-A.9.2"], justification: "Not applicable" } }]);
  });

  it("accepts the ticked gaps with one request and one justification, then clears the bar and refreshes", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all visible gaps" }));
    const box = screen.getByRole("textbox", { name: "Justification for the selected gaps" });
    await userEvent.click(box);
    await userEvent.paste("Out of scope");
    await userEvent.click(screen.getByRole("button", { name: "Accept 3" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toHaveLength(1);
    const body = calls()[0].body as { requirementIds: string[]; justification: string };
    expect(calls()[0]).toMatchObject({ url: "/api/frameworks/f1/gap-acceptances", method: "PUT" });
    expect([...body.requirementIds].sort()).toEqual(["r-A.5.1", "r-A.5.2", "r-A.9.2"]);
    expect(body.justification).toBe("Out of scope");
    expect(notice()).toHaveTextContent("3 gaps accepted");
    expect(screen.queryByRole("group", { name: "Accept the selected gaps" })).not.toBeInTheDocument();
  });

  it("needs a justification", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    await userEvent.click(screen.getByRole("button", { name: "Accept 1" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A justification is required");
    expect(screen.getByRole("textbox", { name: "Justification for the selected gaps" })).toHaveFocus();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the selection and shows the refusal when the server says no (all or nothing)", async () => {
    renderLedger();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    await userEvent.click(screen.getByRole("textbox", { name: "Justification for the selected gaps" }));
    await userEvent.paste("x");
    respond(409, { error: "Only an open Coverage Gap can be accepted: one of these Requirements is covered or already accepted" });
    await userEvent.click(screen.getByRole("button", { name: "Accept 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Only an open Coverage Gap can be accepted/);
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByText("1 gap selected")).toBeInTheDocument();
  });

  it("drops a ticked gap once the page's new data says it is no longer open", () => {
    const { rerender } = renderLedger();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select A.9.2" }));
    expect(screen.getByText("2 gaps selected")).toBeInTheDocument();
    rerender(<FrameworkCoverage view={view({ requirements: ROWS.map((r) => (r.code === "A.9.2" ? { ...r, state: "ACCEPTED_GAP" as const, justification: "x" } : r)) })} />);
    expect(screen.getByText("1 gap selected")).toBeInTheDocument();
  });
});

describe("the page follows its data", () => {
  it("updates the cards, the ring, the tabs and the groups when the server sends new data", () => {
    const { rerender } = renderLedger();
    expect(stat(/^Open gaps/).querySelector(".v")).toHaveTextContent("3");
    const next = ROWS.map((r) => (r.code === "A.5.1" ? { ...r, state: "COVERED" as const, mappings: [mapping("SEC-5")] } : r));
    rerender(<FrameworkCoverage view={view({ requirements: next })} />);
    expect(stat(/^Open gaps/).querySelector(".v")).toHaveTextContent("2");
    expect(stat(/^Covered/).querySelector(".v")).toHaveTextContent("3");
    expect(screen.getByRole("img", { name: "67% of 6 Requirements are covered or accepted" })).toBeInTheDocument();
    expect(tab(/^A\.5/)).toHaveTextContent("3");
    expect(groupNames()[0]).toBe("A.5 Organizational2/3 covered · 1 gap");
  });
});
