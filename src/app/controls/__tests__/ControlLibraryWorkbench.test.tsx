import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import { parseCsv } from "@/test/csv-parse";
import { ControlLibraryWorkbench } from "../ControlLibraryWorkbench";
import type { LibraryRow, LibraryView } from "../library-types";
import { OLIVE, PAT, ROWS, libraryRow, libraryView, mapping } from "./fixtures";

vi.setConfig({ testTimeout: 30_000 });
vi.mock("@/lib/download-csv", () => ({ downloadCsv: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
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
  current: null as null | { items: { label: string; href: string; meta: string; group: string }[]; onSelect?: (item: { href: string }) => void },
}));
vi.mock("@/components/PaletteProvider", () => ({
  usePagePalette: (value: NonNullable<typeof registration.current>) => {
    registration.current = value;
  },
}));

function renderLibrary(over: Partial<LibraryView> = {}) {
  return render(<ControlLibraryWorkbench view={libraryView(over)} />);
}
const CURATOR = { role: "COMPLIANCE_MANAGER", roleLabel: "Compliance Manager", canEdit: true, owners: [{ id: PAT, name: "Pat Peer" }, { id: OLIVE, name: "Olive Owner" }] };

const table = () => screen.getByRole("table", { name: "Controls" });
const codesShown = () =>
  within(table())
    .getAllByRole("row")
    .map((r) => r.getAttribute("aria-label"))
    .filter((label): label is string => !!label)
    .map((label) => label.split(" ")[0]);
const rowOf = (code: string) => within(table()).getByRole("row", { name: new RegExp(`^${code.replace(".", "\\.")} `) });
const cards = () => within(screen.getByRole("region", { name: "Views" }));
const rail = () => within(screen.getByRole("complementary", { name: "Filters" }));
const dialog = () => within(screen.getByRole("dialog"));
const optionOf = (facet: RegExp, option: RegExp) => within(rail().getByRole("group", { name: facet })).getByRole("checkbox", { name: option });

function mockFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  registration.current = null;
  window.history.replaceState(null, "", "/controls");
  vi.mocked(downloadCsv).mockClear();
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ControlLibraryWorkbench: hero and stat cards (#313)", () => {
  it("states the live figures and draws the ring over the Organizational and Both Controls", () => {
    renderLibrary();
    const hero = screen.getByRole("region", { name: "Control Library" });
    expect(hero).toHaveTextContent("8 Controls, 6 base and 2 Supplementary. 1 needs an owner and 2 are not mapped to any Requirement.");
    expect(screen.getByRole("img", { name: "29% of 7 Organizational and Both Controls are Fulfilled" })).toBeInTheDocument();
    const legend = within(screen.getByRole("list", { name: "Organizational and Both Controls by Organization status" }));
    expect(legend.getByRole("button", { name: /2 Not Started/ })).toBeInTheDocument();
    expect(legend.getByRole("button", { name: /2 Fulfilled/ })).toBeInTheDocument();
    expect(legend.getByRole("button", { name: /1 Waived/ })).toBeInTheDocument();
  });

  it("counts every card and filters when one is pressed, toggling back off", async () => {
    const user = userEvent.setup();
    renderLibrary();
    for (const [label, count] of [["All Controls", "8"], ["Needs an owner", "1"], ["Not mapped", "2"], ["Not started", "2"], ["Owned by me", "4"]]) {
      expect(cards().getByRole("button", { name: new RegExp(`^${label}`) })).toHaveTextContent(count);
    }
    const unowned = cards().getByRole("button", { name: /^Needs an owner/ });
    expect(unowned).toHaveAttribute("aria-pressed", "false");
    await user.click(unowned);
    expect(unowned).toHaveAttribute("aria-pressed", "true");
    expect(codesShown()).toEqual(["A.5.3"]);
    await user.click(unowned);
    expect(codesShown()).toHaveLength(8);

    await user.click(cards().getByRole("button", { name: /^Not mapped/ }));
    expect(codesShown().sort()).toEqual(["A.5.3", "CCM-1"]);
    await user.click(cards().getByRole("button", { name: /^Not mapped/ }));
    await user.click(cards().getByRole("button", { name: /^Not started/ }));
    expect(codesShown().sort()).toEqual(["4.1", "A.5.3"]);
    await user.click(cards().getByRole("button", { name: /^Not started/ }));
    await user.click(cards().getByRole("button", { name: /^Owned by me/ }));
    expect(codesShown().sort()).toEqual(["4.1", "A.5.1", "A.8.1", "CCM-1"]);
  });

  it("filters by Organization status from the ring's legend", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const legend = within(screen.getByRole("list", { name: "Organizational and Both Controls by Organization status" }));
    await user.click(legend.getByRole("button", { name: /Fulfilled/ }));
    expect(legend.getByRole("button", { name: /Fulfilled/ })).toHaveAttribute("aria-pressed", "true");
    expect(codesShown().sort()).toEqual(["A.5.1", "CCM-1"]);
    expect(optionOf(/^Organization status/, /^Fulfilled/)).toBeChecked();
    await user.click(legend.getByRole("button", { name: /Fulfilled/ }));
    expect(codesShown()).toHaveLength(8);
  });

  it("shows the edit actions to a Compliance Manager or an Admin, with Import disabled and said to come later", () => {
    renderLibrary(CURATOR);
    const hero = within(screen.getByRole("region", { name: "Control Library" }));
    expect(hero.getByRole("link", { name: "+ New Control" })).toHaveAttribute("href", "/admin/controls");
    const importButton = hero.getByRole("button", { name: "Import" });
    expect(importButton).toBeDisabled();
    expect(importButton).toHaveAttribute("title", expect.stringContaining("Coming later"));
    expect(hero.getByText("Import: coming later")).toBeInTheDocument();
    expect(hero.getByRole("button", { name: "Download CSV" })).toBeEnabled();
  });

  it("shows a read-only role no edit action, only the CSV", () => {
    renderLibrary();
    const hero = within(screen.getByRole("region", { name: "Control Library" }));
    expect(hero.queryByRole("link", { name: /New Control/ })).not.toBeInTheDocument();
    expect(hero.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(hero.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
  });
});

describe("ControlLibraryWorkbench: facet rail, search and chips (#313)", () => {
  it("lists each facet with its live counts", () => {
    renderLibrary();
    expect(optionOf(/^Source/, /^Base · ISO\/IEC 27001:2022/)).toHaveAccessibleName(/6$/);
    expect(optionOf(/^Source/, /^Supplementary · CSA CCM:4\.1/)).toHaveAccessibleName(/1$/);
    expect(optionOf(/^Applicability/, /^Organizational/)).toHaveAccessibleName(/5$/);
    expect(optionOf(/^Organization status/, /^Per System only/)).toHaveAccessibleName(/1$/);
    expect(optionOf(/^Control Owner/, /^Unassigned/)).toHaveAccessibleName(/1$/);
    expect(optionOf(/^Deployment Facet/, /^Any/)).toHaveAccessibleName(/6$/);
    expect(optionOf(/^Sensitivity Level/, /^From Sensitive/)).toHaveAccessibleName(/1$/);
    expect(optionOf(/^Sensitivity Level/, /^None/)).toHaveAccessibleName(/7$/);
  });

  it("filters when a box is ticked, and keeps every count honest about the other filters", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(optionOf(/^Source/, /^Supplementary · CSA CCM/));
    expect(codesShown()).toEqual(["CCM-1"]);
    // The Owner facet now counts only inside the ticked Source; its own selection never narrows it
    expect(optionOf(/^Control Owner/, /^Olive Owner/)).toHaveAccessibleName(/1$/);
    expect(optionOf(/^Control Owner/, /^Pat Peer/)).toHaveAccessibleName(/0$/);
    await user.click(optionOf(/^Control Owner/, /^Pat Peer/));
    expect(codesShown()).toEqual([]);
    expect(screen.getByText("No Controls match")).toBeInTheDocument();
    await user.click(optionOf(/^Control Owner/, /^Pat Peer/));
    expect(codesShown()).toEqual(["CCM-1"]);
    // Source's own counts ignore its own selection: Base still counts all six
    expect(optionOf(/^Source/, /^Base ·/)).toHaveAccessibleName(/6$/);
  });

  it("shows a chip per ticked value, removes one and clears all", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(cards().getByRole("button", { name: /^Owned by me/ }));
    await user.click(optionOf(/^Applicability/, /^Both/));
    const chips = within(screen.getByLabelText("Active filters"));
    expect(chips.getByText("View:").parentElement).toHaveTextContent("View: Owned by me");
    expect(chips.getByText("Applicability:").parentElement).toHaveTextContent("Applicability: Both");
    expect(codesShown()).toEqual(["CCM-1"]);
    await user.click(chips.getByRole("button", { name: "Remove View Owned by me" }));
    expect(codesShown().sort()).toEqual(["A.5.3", "CCM-1"]);
    await user.click(chips.getByRole("button", { name: "Clear all" }));
    expect(codesShown()).toHaveLength(8);
    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
  });

  it("clears one facet from its heading", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(optionOf(/^Control Owner/, /^Olive Owner/));
    await user.click(optionOf(/^Control Owner/, /^Pat Peer/));
    expect(codesShown()).toHaveLength(7);
    await user.click(rail().getByRole("button", { name: "Clear Control Owner" }));
    expect(codesShown()).toHaveLength(8);
  });

  it("shows six Categories and 'Show all N' for the rest", async () => {
    const user = userEvent.setup();
    const extra = Array.from({ length: 7 }, (_, index) => libraryRow(`Z-${index}`, { category: `Z Category ${index}` }));
    renderLibrary({ rows: [...ROWS, ...extra] });
    const group = () => within(rail().getByRole("group", { name: /^Category/ }));
    expect(group().getAllByRole("checkbox")).toHaveLength(6);
    await user.click(group().getByRole("button", { name: "Show all 11" }));
    expect(group().getAllByRole("checkbox")).toHaveLength(11);
    await user.click(group().getByRole("button", { name: "Show fewer" }));
    expect(group().getAllByRole("checkbox")).toHaveLength(6);
  });

  it("searches code, title, description, category and owner, and marks the matches", async () => {
    const user = userEvent.setup();
    const { container } = renderLibrary();
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "ccm");
    expect(codesShown()).toEqual(["CCM-1", "CCM-2"]);
    expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toContain("CCM");
    expect(within(rowOf("CCM-1")).getAllByText("CCM").length).toBeGreaterThan(0);
    await user.clear(screen.getByRole("searchbox", { name: "Search Controls" }));
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "pat peer");
    expect(codesShown().sort()).toEqual(["A.5.2", "A.6.1", "CCM-2"]);
    expect(within(rowOf("A.5.2")).getByText("Pat Peer", { selector: "mark" })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search Controls" }));
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "context");
    expect(codesShown()).toEqual(["4.1"]);
    expect(screen.getByRole("status")).toHaveTextContent("1 of 8 Controls");
  });

  it("focuses the search box with /", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search Controls" })).toHaveFocus();
  });

  it("shows the empty state with Clear filters", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.type(screen.getByRole("searchbox", { name: "Search Controls" }), "zzzz");
    expect(screen.getByText("No Controls match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(codesShown()).toHaveLength(8);
    expect(screen.getByRole("searchbox", { name: "Search Controls" })).toHaveValue("");
  });

  it("opens the rail as a panel behind the Filters button and closes it with Escape or the scrim", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const aside = screen.getByRole("complementary", { name: "Filters" });
    expect(aside).not.toHaveClass("open");
    const button = screen.getByRole("button", { name: "Filters", expanded: false });
    await user.click(button);
    expect(aside).toHaveClass("open");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(aside).not.toHaveClass("open");
    await user.click(button);
    await user.click(screen.getByTestId("library-rail-scrim"));
    expect(aside).not.toHaveClass("open");
  });
});

describe("ControlLibraryWorkbench: table, groups and sorting (#313)", () => {
  it("groups by Category with the count and an owned bar, and regroups", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const groupButtons = () => within(table()).getAllByRole("button", { expanded: true }).map((button) => button.textContent);
    expect(groupButtons()).toEqual([
      expect.stringContaining("4 Context of the organization"),
      expect.stringContaining("A.5 Organizational controls"),
      expect.stringContaining("A.6 People controls"),
      expect.stringContaining("A.8 Technological controls"),
    ]);
    expect(within(table()).getByRole("img", { name: "2 of 3 owned" })).toBeInTheDocument();
    const by = within(screen.getByRole("group", { name: "Group by" }));
    expect(by.getByRole("button", { name: "Category" })).toHaveAttribute("aria-pressed", "true");
    await user.click(by.getByRole("button", { name: "Owner" }));
    expect(groupButtons().map((text) => text?.replace(/\d+ Controls?.*$/, ""))).toEqual(["▾Unassigned", "▾Olive Owner", "▾Pat Peer"]);
    await user.click(by.getByRole("button", { name: "Status" }));
    expect(groupButtons()[0]).toContain("Not Started");
    expect(groupButtons().at(-1)).toContain("Per System only");
    await user.click(by.getByRole("button", { name: "Source" }));
    expect(groupButtons()[0]).toContain("Base · ISO/IEC 27001:2022");
    await user.click(by.getByRole("button", { name: "None" }));
    expect(within(table()).queryAllByRole("button", { expanded: true })).toHaveLength(0);
    expect(codesShown()).toHaveLength(8);
  });

  it("collapses and expands a group", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const header = within(table()).getByRole("button", { name: /A\.5 Organizational controls/ });
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(codesShown()).toEqual(["4.1", "A.6.1", "A.8.1", "CCM-1", "CCM-2"]);
    await user.click(header);
    expect(codesShown()).toEqual(["4.1", "A.5.1", "A.5.2", "A.5.3", "A.6.1", "A.8.1", "CCM-1", "CCM-2"]);
  });

  it("writes each row's Applicability, Owner, Maps and Status", () => {
    renderLibrary();
    const org = within(rowOf("A.5.1"));
    expect(org.getByText("Organizational")).toBeInTheDocument();
    expect(org.getByText("Olive Owner")).toBeInTheDocument();
    expect(org.getByText("Fulfilled")).toBeInTheDocument();
    const unowned = within(rowOf("A.5.3"));
    expect(unowned.getByText("Unassigned")).toBeInTheDocument();
    expect(unowned.getByText("Both")).toBeInTheDocument();
    expect(rowOf("A.5.3").querySelector("td.c-maps")).toHaveClass("zero");
    expect(rowOf("A.5.3").querySelector("td.c-maps")).toHaveTextContent("0");
    expect(rowOf("A.5.2").querySelector("td.c-maps")).toHaveTextContent("2 Requirements");
    expect(rowOf("A.5.1").querySelector("td.c-maps")).toHaveTextContent("1 Requirement");
    expect(rowOf("A.5.2").querySelector("td.c-maps")).not.toHaveClass("zero");
    const perSystem = within(rowOf("A.8.1"));
    expect(perSystem.getByText("Per-System")).toBeInTheDocument();
    expect(perSystem.getByText("Per System only")).toBeInTheDocument();
  });

  it("sorts by a column and flips with a second click", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "None" }));
    const head = (name: string) => within(table()).getByRole("columnheader", { name: new RegExp(`^${name}`) });
    expect(head("ID")).toHaveAttribute("aria-sort", "ascending");
    expect(codesShown()).toEqual(["4.1", "A.5.1", "A.5.2", "A.5.3", "A.6.1", "A.8.1", "CCM-1", "CCM-2"]);
    await user.click(within(head("ID")).getByRole("button"));
    expect(head("ID")).toHaveAttribute("aria-sort", "descending");
    expect(codesShown()[0]).toBe("CCM-2");
    await user.click(within(head("Maps")).getByRole("button"));
    expect(head("Maps")).toHaveAttribute("aria-sort", "ascending");
    expect(head("ID")).toHaveAttribute("aria-sort", "none");
    expect(codesShown().slice(0, 2)).toEqual(["A.5.3", "CCM-1"]);
    await user.click(within(head("Owner")).getByRole("button"));
    expect(codesShown().at(-1)).toBe("A.5.3");
    await user.click(within(head("Status")).getByRole("button"));
    expect(codesShown().at(-1)).toBe("A.8.1");
  });

  it("renders the table in batches and adds the next on request", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 200 }, (_, index) => libraryRow(`M-${String(index).padStart(3, "0")}`, { category: "Many" }));
    renderLibrary({ rows: many });
    expect(codesShown()).toHaveLength(80);
    expect(screen.getByText("Showing 80 of 200")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 80 more" }));
    expect(codesShown()).toHaveLength(160);
    await user.click(screen.getByRole("button", { name: "Show 80 more" }));
    expect(codesShown()).toHaveLength(200);
    expect(screen.queryByRole("button", { name: /Show 80 more/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("200 of 200 Controls");
  });
});

describe("ControlLibraryWorkbench: the drawer (#313)", () => {
  it("opens on a click, puts the Control in the URL hash and closes with Escape", async () => {
    const user = userEvent.setup();
    renderLibrary();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(within(rowOf("A.5.1")).getByText("Title of A.5.1"));
    const drawer = screen.getByRole("dialog", { name: "Title of A.5.1" });
    expect(window.location.hash).toBe("#A.5.1");
    expect(drawer).toHaveTextContent("A.5.1 · 2 of 8");
    expect(rowOf("A.5.1")).toHaveAttribute("aria-current", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("");
  });

  it("opens from Enter on a focused row, and not from the row's checkbox", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(within(rowOf("A.5.2")).getByRole("checkbox", { name: "Select A.5.2" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rowOf("A.5.2").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Title of A.5.2" })).toBeInTheDocument();
  });

  it("opens the Control named in the URL hash", () => {
    window.history.replaceState(null, "", "/controls#A.5.2");
    renderLibrary();
    expect(screen.getByRole("dialog", { name: "Title of A.5.2" })).toHaveTextContent("3 of 8");
  });

  it("ignores a hash that names no Control", () => {
    window.history.replaceState(null, "", "/controls#NOPE");
    renderLibrary();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("steps with j, k and the arrow keys through the Controls in view, and stops at the ends", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/controls#A.5.2");
    renderLibrary();
    await user.keyboard("j");
    expect(screen.getByRole("dialog")).toHaveTextContent("A.5.3 · 4 of 8");
    expect(window.location.hash).toBe("#A.5.3");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("dialog", { name: "Title of A.6.1" })).toBeInTheDocument();
    await user.keyboard("k");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("dialog", { name: "Title of A.5.2" })).toBeInTheDocument();
    await user.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("dialog")).toHaveTextContent("4.1 · 1 of 8");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("dialog", { name: "Title of A.5.1" })).toBeInTheDocument();
  });

  it("steps through the Controls as filtered", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(cards().getByRole("button", { name: /^Owned by me/ }));
    await user.click(within(rowOf("A.5.1")).getByText("Title of A.5.1"));
    expect(screen.getByRole("dialog")).toHaveTextContent("A.5.1 · 2 of 4");
    await user.keyboard("j");
    expect(screen.getByRole("dialog", { name: "Title of A.8.1" })).toBeInTheDocument();
  });

  it("closes from the scrim and the close button", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(within(rowOf("A.5.1")).getByText("Title of A.5.1"));
    await user.click(screen.getByTestId("library-drawer-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(within(rowOf("A.5.1")).getByText("Title of A.5.1"));
    await user.click(dialog().getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lists the Requirements a Control satisfies, grouped by Framework, with their coverage", async () => {
    window.history.replaceState(null, "", "/controls#A.5.2");
    renderLibrary();
    const iso = dialog().getByRole("list", { name: "Requirements in ISO/IEC 27001:2022" });
    expect(within(iso).getByText("R-A52-1")).toBeInTheDocument();
    expect(within(iso).getByText("Requirement R-A52-1")).toBeInTheDocument();
    expect(within(iso).getByText("Full")).toBeInTheDocument();
    const ccm = dialog().getByRole("list", { name: "Requirements in CSA CCM:4.1" });
    expect(within(ccm).getByText("R-A52-2")).toBeInTheDocument();
    expect(within(ccm).getByText("Partial")).toBeInTheDocument();
    expect(dialog().queryByText("Not mapped to any Requirement")).not.toBeInTheDocument();
    expect(dialog().queryByText("Draft Framework")).not.toBeInTheDocument();
  });

  it("says when a Control is not mapped, and marks a Draft Framework the server sent", () => {
    window.history.replaceState(null, "", "/controls#A.5.3");
    const { unmount } = renderLibrary();
    expect(dialog().getByText("Not mapped to any Requirement")).toBeInTheDocument();
    unmount();
    cleanup();

    window.history.replaceState(null, "", "/controls#D-1");
    const draftRow = libraryRow("D-1", { mappings: [mapping("R-D1", "FULL", { framework: { id: "fw-draft", label: "Draft FW:9" }, draft: true })] });
    renderLibrary({ ...CURATOR, rows: [...ROWS, draftRow] });
    expect(within(dialog().getByRole("list", { name: "Requirements in Draft FW:9" })).getByText("R-D1")).toBeInTheDocument();
    expect(dialog().getByText("Draft Framework")).toBeInTheDocument();
  });

  it("shows the code, chips, question, ownership and scope of a Both Control", () => {
    window.history.replaceState(null, "", "/controls#A.5.3");
    const row: LibraryRow = {
      ...ROWS[2],
      question: "Can one person change and deploy?",
      intent: "Prevent fraud",
      examples: ["Two-person review"],
      mandatory: false,
      minAvailabilityImpactLevel: "MODERATE",
    };
    renderLibrary({ rows: [row] });
    const drawer = dialog();
    expect(drawer.getByRole("heading", { name: "Title of A.5.3" })).toBeInTheDocument();
    expect(drawer.getByText("Both")).toBeInTheDocument();
    expect(drawer.getByText("Not mandatory")).toBeInTheDocument();
    expect(drawer.getAllByRole("img", { name: "Sensitivity Level: Sensitive" }).length).toBeGreaterThan(0);
    expect(drawer.getByText("Can one person change and deploy?")).toBeInTheDocument();
    expect(drawer.getByText(/Prevent fraud/)).toBeInTheDocument();
    expect(drawer.getByRole("list", { name: "Examples for A.5.3" })).toHaveTextContent("Two-person review");
    const ownership = within(drawer.getByRole("region", { name: "Ownership" }));
    expect(ownership.getByText("Unassigned")).toBeInTheDocument();
    expect(ownership.getByText("Not Started")).toBeInTheDocument();
    expect(ownership.getByText("4 Systems")).toBeInTheDocument();
    const scope = within(drawer.getByRole("region", { name: "Scope" }));
    expect(scope.getByText("A.5 Organizational controls")).toBeInTheDocument();
    expect(scope.getByText("Cloud")).toBeInTheDocument();
    expect(scope.getByText("High")).toBeInTheDocument();
    expect(scope.getByText("Moderate")).toBeInTheDocument();
  });

  it("shows Per System only for a Per-System Control, and no Systems line for an Organizational one", () => {
    window.history.replaceState(null, "", "/controls#A.8.1");
    const { unmount } = renderLibrary();
    const ownership = within(dialog().getByRole("region", { name: "Ownership" }));
    expect(ownership.getByText("Per System only")).toBeInTheDocument();
    expect(ownership.getByText("3 Systems")).toBeInTheDocument();
    unmount();
    cleanup();
    window.history.replaceState(null, "", "/controls#A.5.1");
    renderLibrary();
    expect(within(dialog().getByRole("region", { name: "Ownership" })).queryByText(/Systems?$/)).not.toBeInTheDocument();
    expect(dialog().queryByText("Supplementary", { exact: false })).not.toBeInTheDocument();
  });

  it("labels the Source of a Supplementary Control, with a hidden origin as plain Supplementary", () => {
    window.history.replaceState(null, "", "/controls#CCM-1");
    const { unmount } = renderLibrary();
    expect(dialog().getByText("Supplementary · CSA CCM:4.1")).toBeInTheDocument();
    unmount();
    cleanup();
    window.history.replaceState(null, "", "/controls#CCM-2");
    renderLibrary();
    expect(dialog().getByText("Supplementary")).toBeInTheDocument();
    expect(dialog().queryByText(/CSA CCM/)).not.toBeInTheDocument();
  });

  it("offers Edit to a Compliance Manager or an Admin only, and leaves a place for the full page", () => {
    window.history.replaceState(null, "", "/controls#A.5.1");
    const { unmount } = renderLibrary(CURATOR);
    expect(dialog().getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/admin/controls");
    expect(dialog().queryByRole("link", { name: /Open full page/ })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="open-full-page"]')).toBeInTheDocument();
    unmount();
    cleanup();
    renderLibrary();
    expect(dialog().queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("ControlLibraryWorkbench: Ctrl+K palette (#313)", () => {
  it("registers every Control and opens its drawer when one is picked", () => {
    renderLibrary();
    const items = registration.current!.items;
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({ group: "Controls", label: "A.5.1 Title of A.5.1", href: "#A.5.1" });
    act(() => registration.current!.onSelect!({ href: "#A.8.1" }));
    expect(screen.getByRole("dialog", { name: "Title of A.8.1" })).toBeInTheDocument();
    expect(window.location.hash).toBe("#A.8.1");
  });

  it("adds New Control for a Compliance Manager or an Admin only, which navigates", () => {
    renderLibrary(CURATOR);
    const item = registration.current!.items.find((entry) => entry.label === "New Control");
    expect(item).toMatchObject({ href: "/admin/controls" });
    act(() => registration.current!.onSelect!({ href: "/admin/controls" }));
    expect(push).toHaveBeenCalledWith("/admin/controls");
    cleanup();
    renderLibrary();
    expect(registration.current!.items.some((entry) => entry.label === "New Control")).toBe(false);
  });
});

describe("ControlLibraryWorkbench: CSV (#313)", () => {
  const lastCsv = () => {
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls.at(-1)!;
    return { table: parseCsv(csv.slice(CSV_BOM.length)), filename, raw: csv };
  };

  it("downloads the Controls in view, in the order shown", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(cards().getByRole("button", { name: /^Not mapped/ }));
    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    const { table: rows, filename, raw } = lastCsv();
    expect(raw.startsWith(CSV_BOM)).toBe(true);
    expect(filename).toMatch(/^Control-Library-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(rows.slice(1).map((row) => row[0])).toEqual(["A.5.3", "CCM-1"]);
  });

  it("exports just the selection from the bulk bar, to every role", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.2" }));
    await user.click(screen.getByRole("checkbox", { name: "Select CCM-2" }));
    const bar = within(screen.getByRole("region", { name: "Bulk actions" }));
    expect(bar.getByText("2")).toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Assign owner…" })).not.toBeInTheDocument();
    await user.click(bar.getByRole("button", { name: "Export CSV" }));
    const { table: rows, filename } = lastCsv();
    expect(filename).toMatch(/^Control-Library-selection-/);
    expect(rows.slice(1).map((row) => row[0])).toEqual(["A.5.2", "CCM-2"]);
  });
});

describe("ControlLibraryWorkbench: selection and bulk Assign owner (#313)", () => {
  const assigned = (ids: string[], owner: { id: string; name: string } | null) => ({ controls: ids.map((id) => ({ id, owner })) });

  it("selects the rows shown with the header box, and clears the selection", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(cards().getByRole("button", { name: /^Owned by me/ }));
    await user.click(screen.getByRole("checkbox", { name: "Select all shown" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("4 selected");
    expect(screen.getByRole("checkbox", { name: "Select all shown" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("assigns one Control Owner to the selection through the route, and updates the page in place", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ body: assigned(["id-A.5.3", "id-CCM-1"], { id: PAT, name: "Pat Peer" }) }));
    renderLibrary(CURATOR);
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.3" }));
    await user.click(screen.getByRole("checkbox", { name: "Select CCM-1" }));
    await user.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Assign owner…" }));
    const form = dialog();
    expect(screen.getByRole("dialog", { name: "Assign a Control Owner to 2 Controls" })).toBeInTheDocument();
    expect(form.getByRole("button", { name: "Apply to 2" })).toBeDisabled();
    expect(screen.getByTestId("assign-owner-scrim")).toBeInTheDocument();
    expect(form.getByRole("combobox", { name: "Control Owner" })).toHaveFocus();
    await user.selectOptions(form.getByRole("combobox", { name: "Control Owner" }), PAT);
    await user.click(form.getByRole("button", { name: "Apply to 2" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/controls");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ controlIds: ["id-A.5.3", "id-CCM-1"], ownerId: PAT });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(rowOf("A.5.3")).getByText("Pat Peer")).toBeInTheDocument();
    expect(within(rowOf("CCM-1")).getByText("Pat Peer")).toBeInTheDocument();
    expect(screen.getByText("Pat Peer is now the Control Owner of 2 Controls")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
    // The cards follow: nobody is left without an owner
    expect(cards().getByRole("button", { name: /^Needs an owner/ })).toHaveTextContent("0");
    expect(cards().getByRole("button", { name: /^Owned by me/ })).toHaveTextContent("3");
  });

  it("clears the Control Owner with Unassigned, sending a null ownerId", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(() => ({ body: assigned(["id-A.5.1"], null) }));
    renderLibrary(CURATOR);
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.1" }));
    await user.click(screen.getByRole("button", { name: "Assign owner…" }));
    await user.selectOptions(dialog().getByRole("combobox", { name: "Control Owner" }), screen.getByRole("option", { name: /^Unassigned/ }));
    await user.click(dialog().getByRole("button", { name: "Apply to 1" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ controlIds: ["id-A.5.1"], ownerId: null });
    expect(within(rowOf("A.5.1")).getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Control Owner cleared on 1 Control")).toBeInTheDocument();
  });

  it("shows a refusal in the dialog and changes nothing on the page", async () => {
    const user = userEvent.setup();
    mockFetch(() => ({ status: 404, body: { error: "Control not found", missingIds: ["id-A.5.3"] } }));
    renderLibrary(CURATOR);
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.3" }));
    await user.click(screen.getByRole("button", { name: "Assign owner…" }));
    await user.selectOptions(dialog().getByRole("combobox", { name: "Control Owner" }), PAT);
    await user.click(dialog().getByRole("button", { name: "Apply to 1" }));
    expect(dialog().getByRole("alert")).toHaveTextContent("Control not found: A.5.3");
    expect(within(rowOf("A.5.3")).getByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("1 selected");
    // The dialog can be dismissed with Escape, or by clicking the backdrop
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Assign owner…" }));
    await user.click(screen.getByTestId("assign-owner-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a network failure in the dialog", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    renderLibrary(CURATOR);
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.3" }));
    await user.click(screen.getByRole("button", { name: "Assign owner…" }));
    await user.selectOptions(dialog().getByRole("combobox", { name: "Control Owner" }), PAT);
    await user.click(dialog().getByRole("button", { name: "Apply to 1" }));
    expect(dialog().getByRole("alert")).toHaveTextContent("The Control Owner could not be assigned");
  });

  it("offers no Assign owner to a role that cannot edit, even with Controls selected", async () => {
    const user = userEvent.setup();
    renderLibrary();
    await user.click(screen.getByRole("checkbox", { name: "Select A.5.3" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign owner…" })).not.toBeInTheDocument();
  });
});
