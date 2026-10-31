import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { CSV_BOM } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import { parseCsv } from "@/test/csv-parse";
import { StatementLedger } from "../StatementLedger";
import type { SoaLedgerRow, SoaView } from "../soa-types";

// Typing and walking through a table of Controls is slow on a loaded machine.
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

const counts = (over: Partial<Record<ControlAssessmentStatus, number>> = {}) => ({ NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0, ...over });
const ISO = "ISO/IEC 27001:2022";
const CCM = "CSA CCM:4.1.1";

function row(code: string, over: Partial<SoaLedgerRow> = {}): SoaLedgerRow {
  return {
    controlId: `id-${code}`,
    code,
    title: `Title of ${code}`,
    applicability: "ORGANIZATIONAL",
    included: true,
    appliesToOrganization: true,
    appliesToSystemCount: 0,
    inclusionJustification: "",
    exclusionJustification: null,
    justificationMissing: false,
    organizationStatus: "NOT_STARTED",
    systemRollup: null,
    description: `Description of ${code}`,
    category: "A.5 Organizational",
    sourceKey: "base",
    sourceLabel: "Base Control Library",
    ownerName: null,
    requirements: [{ framework: ISO, codes: [code] }],
    systemStatuses: [],
    hiddenSystemCount: 0,
    ...over,
  };
}

const excluded = (code: string, over: Partial<SoaLedgerRow> = {}) =>
  row(code, { included: false, appliesToOrganization: false, organizationStatus: null, requirements: [], justificationMissing: true, category: "Datacenter", ...over });

/**
 * Seven Controls. Included: A.5.1 (Org Fulfilled, owner Olive), A.5.2 (Org Not Started), A.8.1 (Per-System, 3 Systems of which the
 * user may name 2), CCM-1 (Both, Supplementary). Excluded: DCS-01 and DCS-02 (missing), GRC-01 (justified).
 * Totals: 4 of 7 included; 2 missing of 3 excluded; Organization 1 of 3 fulfilled; Systems 3 of 5 done.
 */
const ROWS: SoaLedgerRow[] = [
  row("A.5.1", { organizationStatus: "FULFILLED", ownerName: "Olive Owner" }),
  row("A.5.2"),
  row("A.8.1", {
    applicability: "PER_SYSTEM",
    appliesToOrganization: false,
    organizationStatus: null,
    appliesToSystemCount: 3,
    systemRollup: { total: 3, counts: counts({ FULFILLED: 1, IN_PROGRESS: 1, NOT_STARTED: 1 }) },
    category: "A.8 Technological",
    requirements: [{ framework: CCM, codes: ["CCC-01"] }, { framework: ISO, codes: ["A.8.1", "A.8.2"] }],
    systemStatuses: [[0, "FULFILLED"], [1, "IN_PROGRESS"]],
    hiddenSystemCount: 1,
  }),
  row("CCM-1", {
    applicability: "BOTH",
    organizationStatus: "IN_PROGRESS",
    appliesToSystemCount: 2,
    systemRollup: { total: 2, counts: counts({ FULFILLED: 2 }) },
    category: "Governance",
    sourceKey: "fw-ccm",
    sourceLabel: "Supplementary · CSA CCM:4.1.1",
    requirements: [{ framework: CCM, codes: ["GRC-02"] }],
    systemStatuses: [[0, "FULFILLED"]],
    hiddenSystemCount: 1,
  }),
  excluded("DCS-01"),
  excluded("DCS-02"),
  excluded("GRC-01", { justificationMissing: false, exclusionJustification: "We run no datacenter of our own", category: "Governance" }),
];

const SYSTEMS = [{ id: "s1", name: "Payroll" }, { id: "s2", name: "Customer Portal" }];

const viewOf = (over: Partial<SoaView> = {}): SoaView => ({ userId: "u1", role: "COMPLIANCE_MANAGER", roleLabel: "Compliance Manager", canEdit: true, rows: ROWS, systems: SYSTEMS, ...over });

function renderLedger(over: Partial<SoaView> = {}) {
  return render(<StatementLedger view={viewOf(over)} />);
}

/** The codes of the table's Control rows, top to bottom. */
const shown = () => [...document.querySelectorAll("tr.sl-row .sl-open")].map((el) => el.textContent);
const dialog = () => screen.getByRole("dialog");

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  registration.current = null;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(downloadCsv).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the hero", () => {
  it("carries the eyebrow, the title, the ring and the two downloads, and no audit export", () => {
    renderLedger();
    expect(screen.getByText("ISO/IEC 27001:2022 · Clause 6.1.3 d")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Statement of Applicability" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "4 of 7 Controls included" }).length).toBeGreaterThan(0);
    const legend = screen.getByRole("list", { name: "Controls by inclusion" });
    expect(within(legend).getByText("included")).toBeInTheDocument();
    expect(within(legend).getByText("excluded")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download full Statement" })).toHaveAttribute("href", "/api/statement-of-applicability/export");
    expect(screen.getByRole("button", { name: "Download view" })).toBeEnabled();
    expect(screen.queryByText(/Export for audit/i)).not.toBeInTheDocument();
  });
});

describe("the cards", () => {
  it("show the figures over all Controls", () => {
    renderLedger();
    const cards = screen.getByRole("region", { name: "Filters" });
    const applicability = within(cards).getByRole("button", { name: /Applicability/ });
    expect(applicability).toHaveTextContent("4");
    expect(applicability).toHaveTextContent("/ 7");
    expect(applicability).toHaveTextContent("3 excluded");
    const missing = within(cards).getByRole("button", { name: /Exclusion justifications/ });
    expect(missing).toHaveTextContent("2 missing of 3");
    expect(missing).toHaveTextContent("Write the missing ones");
    expect(missing.querySelectorAll(".sl-pips i")).toHaveLength(3);
    expect(missing.querySelectorAll(".sl-pips i.miss")).toHaveLength(2);
    const org = within(cards).getByRole("button", { name: /Organization implementation/ });
    expect(org).toHaveTextContent("33%");
    expect(org).toHaveTextContent("of 3 fulfilled");
    const systems = within(cards).getByRole("button", { name: /Systems · effective statuses/ });
    expect(systems).toHaveTextContent("60%");
    expect(systems).toHaveTextContent("of 5 Assessments done");
    expect(systems).toHaveTextContent("3 Fulfilled");
    expect(systems).toHaveTextContent("1 In Progress");
  });

  it("toggle: Applicability shows the Excluded view and a second click clears it", async () => {
    const user = userEvent.setup();
    renderLedger();
    const button = screen.getByRole("button", { name: /^Applicability/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("tab", { name: /^Excluded/ })).toHaveAttribute("aria-selected", "true");
    expect(shown()).toEqual(["DCS-01", "DCS-02", "GRC-01"]);
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
    expect(shown()).toHaveLength(7);
  });

  it("the Exclusion justifications card shows the missing ones and, for a writer, opens the first", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: /Exclusion justifications/ }));
    expect(shown()).toEqual(["DCS-01", "DCS-02"]);
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent("DCS-01");
    expect(within(dialog()).getByLabelText("Exclusion justification of DCS-01")).toBeInTheDocument();
  });

  it("the Exclusion justifications card does not open the drawer for a reader", async () => {
    const user = userEvent.setup();
    renderLedger({ canEdit: false });
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("Show the missing ones");
    await user.click(screen.getByRole("button", { name: /Exclusion justifications/ }));
    expect(shown()).toEqual(["DCS-01", "DCS-02"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the Organization card shows what has not started anywhere", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: /Organization implementation/ }));
    expect(screen.getByRole("tab", { name: /^Not started anywhere/ })).toHaveAttribute("aria-selected", "true");
    expect(shown()).toEqual(["A.5.2"]);
  });

  it("the Systems card shows the included Controls that apply to Systems only, and leaves that filter when the view changes", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: /Systems · effective statuses/ }));
    expect(shown()).toEqual(["A.8.1"]);
    expect(screen.getByRole("combobox", { name: "Applies to" })).toHaveValue("sys");
    await user.click(screen.getByRole("tab", { name: /^All/ }));
    expect(screen.getByRole("combobox", { name: "Applies to" })).toHaveValue("");
    expect(shown()).toHaveLength(7);
    expect(screen.getByRole("button", { name: /Systems · effective statuses/ })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("the views", () => {
  it("count the Controls, the missing count in red, and narrow the table", async () => {
    const user = userEvent.setup();
    renderLedger();
    const counted = (name: RegExp) => within(screen.getByRole("tab", { name })).getByText(/^\d+$/);
    expect(counted(/^All/)).toHaveTextContent("7");
    expect(counted(/^Included/)).toHaveTextContent("4");
    expect(counted(/^Excluded/)).toHaveTextContent("3");
    expect(counted(/^Missing justification/)).toHaveTextContent("2");
    expect(counted(/^Missing justification/)).toHaveClass("bad");
    expect(counted(/^Not started anywhere/)).toHaveTextContent("1");

    await user.click(screen.getByRole("tab", { name: /^Included/ }));
    expect(shown()).toEqual(["A.5.1", "A.5.2", "A.8.1", "CCM-1"]);
    await user.click(screen.getByRole("tab", { name: /^Missing justification/ }));
    expect(shown()).toEqual(["DCS-01", "DCS-02"]);
    expect(screen.getByText("2 of 7 Controls")).toBeInTheDocument();
  });
});

describe("search and filters", () => {
  it("searches code, title, domain, justification and Requirement codes, and says how many match", async () => {
    const user = userEvent.setup();
    renderLedger();
    const search = screen.getByRole("searchbox", { name: "Search the Statement" });
    await user.type(search, "a.8.2");
    expect(shown()).toEqual(["A.8.1"]);
    expect(screen.getByText(/1 of 7 Controls matching/)).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "technological");
    expect(shown()).toEqual(["A.8.1"]);
    await user.clear(search);
    await user.type(search, "no datacenter");
    expect(shown()).toEqual(["GRC-01"]);
    await user.clear(search);
    await user.type(search, "title of dcs");
    expect(shown()).toEqual(["DCS-01", "DCS-02"]);
    await user.clear(search);
    expect(shown()).toHaveLength(7);
  });

  it("focuses the search on /", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search the Statement" })).toHaveFocus();
  });

  it("filters by Published Framework, from the Frameworks the Controls map to", async () => {
    const user = userEvent.setup();
    renderLedger();
    const select = screen.getByRole("combobox", { name: "Framework" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Frameworks", CCM, ISO]);
    await user.selectOptions(select, CCM);
    expect(shown()).toEqual(["A.8.1", "CCM-1"]);
    await user.selectOptions(select, ISO);
    expect(shown()).toEqual(["A.5.1", "A.5.2", "A.8.1"]);
  });

  it("filters by what the Control applies to", async () => {
    const user = userEvent.setup();
    renderLedger();
    const select = screen.getByRole("combobox", { name: "Applies to" });
    await user.selectOptions(select, "org");
    expect(shown()).toEqual(["A.5.1", "A.5.2"]);
    await user.selectOptions(select, "sys");
    expect(shown()).toEqual(["A.8.1"]);
    await user.selectOptions(select, "both");
    expect(shown()).toEqual(["CCM-1"]);
  });

  it("offers to clear the filters when nothing matches", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.type(screen.getByRole("searchbox", { name: "Search the Statement" }), "zzz-nothing");
    expect(screen.getByText("No Controls match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shown()).toHaveLength(7);
    expect(screen.getByRole("searchbox", { name: "Search the Statement" })).toHaveValue("");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("grouping and density", () => {
  const groupNames = () => [...document.querySelectorAll("tr.sl-grp .gn")].map((el) => el.firstChild?.textContent);

  it("groups by domain with the counts and the average progress", () => {
    renderLedger();
    expect(groupNames()).toEqual(["A.5 Organizational", "A.8 Technological", "Governance", "Datacenter"]);
    const header = screen.getByRole("button", { name: /A\.5 Organizational/ });
    expect(header).toHaveTextContent("2 included");
    // Org Fulfilled (1) and Not Started (0): 50%.
    expect(header).toHaveTextContent("50%");
    const governance = screen.getByRole("button", { name: /^Governance/ });
    expect(governance).toHaveTextContent("1 included");
    expect(governance).toHaveTextContent("1 excluded");
    expect(screen.getByRole("button", { name: /Datacenter/ })).toHaveTextContent("2 missing");
  });

  it("groups by source: the base Control Library, then each Supplementary Framework", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "source");
    expect(groupNames()).toEqual(["Base Control Library", "Supplementary · CSA CCM:4.1.1"]);
  });

  it("groups by implementation, and not at all", async () => {
    const user = userEvent.setup();
    renderLedger();
    const select = screen.getByRole("combobox", { name: "Group by" });
    await user.selectOptions(select, "impl");
    expect(groupNames()).toEqual(["Excluded", "Not started", "Under way", "Mostly done", "Done"]);
    await user.selectOptions(select, "");
    expect(groupNames()).toEqual([]);
    expect(shown()).toHaveLength(7);
  });

  it("collapses and expands a group, and all of them", async () => {
    const user = userEvent.setup();
    renderLedger();
    const header = screen.getByRole("button", { name: /A\.5 Organizational/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(shown()).toEqual(["A.8.1", "CCM-1", "GRC-01", "DCS-01", "DCS-02"]);
    expect(shown()).not.toContain("A.5.1");
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(shown()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(shown()).toHaveLength(7);
  });

  it("keeps every group header when the expanded groups use up the batch", async () => {
    const user = userEvent.setup();
    const rowsIn = [
      ...Array.from({ length: 90 }, (_, i) => row(`D1.${String(i).padStart(3, "0")}`, { category: "Domain One" })),
      ...Array.from({ length: 5 }, (_, i) => row(`D2.${i}`, { category: "Domain Two" })),
    ];
    renderLedger({ rows: rowsIn });
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    await user.click(screen.getByRole("button", { name: /Domain One/ }));
    expect(shown()).toHaveLength(90);
    expect(screen.getByRole("button", { name: /Domain Two/ })).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("button", { name: /Domain Two/ }));
    expect(screen.getByRole("button", { name: /Domain Two/ })).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(shown()).toHaveLength(95);
  });

  it("switches the density", async () => {
    const user = userEvent.setup();
    const { container } = renderLedger();
    expect(container.firstElementChild).not.toHaveClass("compact");
    await user.click(screen.getByRole("button", { name: "Compact" }));
    expect(container.firstElementChild).toHaveClass("compact");
    expect(screen.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Comfortable" }));
    expect(container.firstElementChild).not.toHaveClass("compact");
  });
});

describe("rows", () => {
  it("shows the Requirement chips of an included Control, the written text of an excluded one and 'No justification' with Write for a missing one", () => {
    renderLedger();
    const included = document.querySelector('tr[data-id="id-A.8.1"]') as HTMLElement;
    expect(within(included).getByText(ISO)).toBeInTheDocument();
    expect(within(included).getByText("A.8.1, A.8.2")).toBeInTheDocument();
    expect(within(included).getByText("1/3")).toBeInTheDocument();
    expect(within(included).getByText("3 Systems")).toBeInTheDocument();
    const justified = document.querySelector('tr[data-id="id-GRC-01"]') as HTMLElement;
    expect(within(justified).getByText("We run no datacenter of our own")).toBeInTheDocument();
    const missing = document.querySelector('tr[data-id="id-DCS-01"]') as HTMLElement;
    expect(within(missing).getByText("No justification")).toBeInTheDocument();
    expect(within(missing).getByRole("button", { name: "Write the justification for DCS-01" })).toBeInTheDocument();
  });

  it("offers no Write button to a role that can't write", () => {
    renderLedger({ canEdit: false });
    expect(screen.queryByRole("button", { name: /Write the justification/ })).not.toBeInTheDocument();
    const missing = document.querySelector('tr[data-id="id-DCS-01"]') as HTMLElement;
    expect(within(missing).getByText("No justification")).toBeInTheDocument();
  });

  it("draws the Controls in batches", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 200 }, (_, index) => row(`B.${String(index).padStart(3, "0")}`, { category: "Many" }));
    renderLedger({ rows: many });
    expect(shown()).toHaveLength(90);
    expect(screen.getByText("Showing 90 of 200")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(shown()).toHaveLength(180);
    await user.click(screen.getByRole("button", { name: "Show more" }));
    expect(shown()).toHaveLength(200);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("draws the next batch when the end of the table scrolls into view", async () => {
    let notify: (entries: { isIntersecting: boolean }[]) => void = () => {};
    class FakeObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const many = Array.from({ length: 200 }, (_, index) => row(`B.${String(index).padStart(3, "0")}`, { category: "Many" }));
    renderLedger({ rows: many });
    expect(shown()).toHaveLength(90);
    act(() => notify([{ isIntersecting: true }]));
    await waitFor(() => expect(shown()).toHaveLength(180));
  });
});

describe("the drawer", () => {
  it("opens from a row and says why a Control is included, with its justification, implementation, owner and Systems", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByText("Title of A.8.1"));
    const drawer = dialog();
    expect(within(drawer).getByRole("heading", { level: 2 })).toHaveTextContent("A.8.1 Title of A.8.1");
    expect(within(drawer).getByText(/3 of 7/)).toBeInTheDocument();
    expect(within(drawer).getByText("Description of A.8.1")).toBeInTheDocument();
    expect(within(drawer).getByText(/because it applies to 3 Systems/)).toBeInTheDocument();
    expect(within(drawer).getByText(CCM)).toBeInTheDocument();
    expect(within(drawer).getByText("CCC-01")).toBeInTheDocument();
    expect(within(drawer).getByText("1 Fulfilled, 1 In Progress, 1 Not Started")).toBeInTheDocument();
    expect(within(drawer).getByText("Unassigned")).toBeInTheDocument();
    const list = within(drawer).getByRole("list", { name: "Systems" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["PayrollFulfilled", "Customer PortalIn Progress", "1 more not visible to you"]);
    expect(within(drawer).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Open Control →" })).toHaveAttribute("href", "/controls");
  });

  it("shows the Control Owner and the Organization's status", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByText("Title of A.5.1"));
    const drawer = dialog();
    expect(within(drawer).getByText("Olive Owner")).toBeInTheDocument();
    expect(within(drawer).getByText("Fulfilled")).toBeInTheDocument();
    expect(within(drawer).getByText(/because it applies to the Organization\./)).toBeInTheDocument();
  });

  it("names no System when the user can name none, only how many are hidden", async () => {
    const user = userEvent.setup();
    const hidden = row("A.9.1", {
      applicability: "PER_SYSTEM",
      appliesToOrganization: false,
      organizationStatus: null,
      appliesToSystemCount: 2,
      systemRollup: { total: 2, counts: counts({ NOT_STARTED: 2 }) },
      hiddenSystemCount: 2,
    });
    renderLedger({ rows: [hidden], systems: [] });
    await user.click(screen.getByText("Title of A.9.1"));
    expect(within(within(dialog()).getByRole("list", { name: "Systems" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["2 more not visible to you"]);
  });

  it("closes on Escape, on the close button and on the scrim, and gives focus back to the row", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open A.5.1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open A.5.1" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Open A.5.1" }));
    await user.click(within(dialog()).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open A.5.1" }));
    await user.click(screen.getByTestId("soa-drawer-scrim"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("walks the Controls in view with Previous, Next, j and k, and stops at the ends", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("tab", { name: /^Included/ }));
    await user.click(screen.getByRole("button", { name: "Open A.5.1" }));
    const title = () => within(dialog()).getByRole("heading", { level: 2 }).textContent;
    expect(title()).toContain("A.5.1");
    await user.click(within(dialog()).getByRole("button", { name: /Next/ }));
    expect(title()).toContain("A.5.2");
    await user.keyboard("j");
    expect(title()).toContain("A.8.1");
    await user.keyboard("k");
    expect(title()).toContain("A.5.2");
    await user.click(within(dialog()).getByRole("button", { name: /Previous/ }));
    expect(title()).toContain("A.5.1");
    await user.keyboard("k");
    expect(title()).toContain("A.5.1");
    await user.keyboard("jjj");
    expect(title()).toContain("CCM-1");
    await user.keyboard("j");
    expect(title()).toContain("CCM-1");
    expect(within(dialog()).getByText(/4 of 4/)).toBeInTheDocument();
  });

  it("does not step while the editor has focus", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    const text = within(dialog()).getByLabelText("Exclusion justification of DCS-01");
    expect(text).toHaveFocus();
    await user.keyboard("jk");
    expect(text).toHaveValue("jk");
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent("DCS-01");
  });

  it("opens from the Ctrl+K palette: every Control is an item", () => {
    renderLedger();
    const labels = registration.current!.items.map((item) => item.label);
    expect(labels).toHaveLength(7);
    expect(labels).toContain("A.8.1 Title of A.8.1");
    expect(registration.current!.items.find((item) => item.label.startsWith("DCS-01"))!.meta).toBe("Excluded · no justification");
    const item = registration.current!.items.find((candidate) => candidate.label.startsWith("GRC-01"))!;
    act(() => registration.current!.onSelect!(item));
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent("GRC-01");
  });
});

describe("the exclusion justification editor", () => {
  const saved = (controlId: string, text: string | null) => respond({ controlId, exclusionJustification: text, justificationMissing: text === null });

  it("saves with PUT, updates the row, the cards and the tabs, and says a Change Event is recorded", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(saved("id-DCS-01", "Not in our scope."));
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    const drawer = dialog();
    expect(within(drawer).getByText("Saving records a Change Event")).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
    await user.type(within(drawer).getByLabelText("Exclusion justification of DCS-01"), "  Not in our scope.  ");
    await user.click(within(drawer).getByRole("button", { name: "Save justification" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/statement-of-applicability/id-DCS-01/exclusion-justification");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ justification: "Not in our scope." });
    expect(await screen.findByText("Saved · 1 still missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("1 missing of 3");
    expect(within(screen.getByRole("tab", { name: /^Missing justification/ })).getByText("1")).toBeInTheDocument();
    const row = document.querySelector('tr[data-id="id-DCS-01"]') as HTMLElement;
    expect(within(row).getByText("Not in our scope.")).toBeInTheDocument();
    // The drawer now offers Clear.
    expect(within(dialog()).getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("fills the text from a template", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.click(within(dialog()).getByRole("button", { name: "+ Covered by a provider" }));
    expect(within(dialog()).getByLabelText("Exclusion justification of DCS-01")).toHaveValue("Implemented by our cloud provider; we rely on their attestation, reviewed under A.5.22.");
    expect(within(dialog()).getAllByRole("group", { name: "Templates" })[0].querySelectorAll("button")).toHaveLength(4);
  });

  it("refuses to save an empty text without asking the server", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Write a justification first");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and changes nothing", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(respond({ error: "Provide justification as text of at most 2000 characters, or null to clear it" }, 400));
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-01"), "Some reason");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Provide justification as text of at most 2000 characters");
    const row = document.querySelector('tr[data-id="id-DCS-01"]') as HTMLElement;
    expect(within(row).getByText("No justification")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("2 missing of 3");
    expect(within(dialog()).getByLabelText("Exclusion justification of DCS-01")).toHaveValue("Some reason");
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it("keeps the row when the request fails outright", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("offline"));
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-01"), "Some reason");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("The justification could not be saved");
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("2 missing of 3");
  });

  it("edits a written justification and clears it with PUT null", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open GRC-01" }));
    const field = within(dialog()).getByLabelText("Exclusion justification of GRC-01");
    expect(field).toHaveValue("We run no datacenter of our own");

    fetchMock.mockResolvedValueOnce(saved("id-GRC-01", "Reworded."));
    await user.clear(field);
    await user.type(field, "Reworded.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ justification: "Reworded." });
    await screen.findByText("Saved · 2 still missing");

    fetchMock.mockResolvedValueOnce(saved("id-GRC-01", null));
    await user.click(within(dialog()).getByRole("button", { name: "Clear" }));
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ justification: null });
    await screen.findByText("Justification cleared · 3 missing");
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("3 missing of 3");
    expect(within(dialog()).getByLabelText("Exclusion justification of GRC-01")).toHaveValue("");
    expect(within(dialog()).queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("moves to the next missing Control after a save in the Missing justification view", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(saved("id-DCS-01", "Not in our scope."));
    renderLedger();
    await user.click(screen.getByRole("tab", { name: /^Missing justification/ }));
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-01"), "Not in our scope.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    await waitFor(() => expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent("DCS-02"));
    expect(shown()).toEqual(["DCS-02"]);
    await waitFor(() => expect(within(dialog()).getByLabelText("Exclusion justification of DCS-02")).toHaveFocus());
  });

  it("keeps both updates when two saves overlap and the first response arrives late", async () => {
    const user = userEvent.setup();
    let resolveFirst: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveFirst = resolve)));
    fetchMock.mockResolvedValueOnce(saved("id-DCS-02", "Second."));
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-01"), "First.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    await user.click(within(dialog()).getByRole("button", { name: /Next/ }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-02"), "Second.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    await screen.findByText("Saved · 1 still missing");
    await act(async () => resolveFirst(saved("id-DCS-01", "First.")));
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("0 missing of 3");
    const first = document.querySelector('tr[data-id="id-DCS-01"]') as HTMLElement;
    const second = document.querySelector('tr[data-id="id-DCS-02"]') as HTMLElement;
    expect(within(first).getByText("First.")).toBeInTheDocument();
    expect(within(second).getByText("Second.")).toBeInTheDocument();
  });

  it("stays on the Control after a save outside the Missing justification view", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(saved("id-DCS-01", "Not in our scope."));
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-01"), "Not in our scope.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    await screen.findByText("Saved · 1 still missing");
    expect(within(dialog()).getByRole("heading", { level: 2 })).toHaveTextContent("DCS-01");
  });

  it("says every exclusion is justified when the last one is written", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(saved("id-DCS-02", "Done."));
    renderLedger({ rows: [excluded("DCS-02")] });
    await user.click(screen.getByRole("button", { name: "Open DCS-02" }));
    await user.type(within(dialog()).getByLabelText("Exclusion justification of DCS-02"), "Done.");
    await user.click(within(dialog()).getByRole("button", { name: "Save justification" }));
    await screen.findByText("Saved · every exclusion is justified");
    expect(screen.getByRole("button", { name: /Exclusion justifications/ })).toHaveTextContent("Every exclusion is justified");
  });

  it("is read-only text for a role that can't write, with no editor, Save or Clear", async () => {
    const user = userEvent.setup();
    renderLedger({ canEdit: false });
    await user.click(screen.getByRole("button", { name: "Open GRC-01" }));
    const drawer = dialog();
    expect(within(drawer).getByText("We run no datacenter of our own")).toBeInTheDocument();
    expect(within(drawer).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /Save justification|Clear/ })).not.toBeInTheDocument();
    expect(within(drawer).getByText("Only a Compliance Manager or an Admin writes exclusion justifications.")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Open DCS-01" }));
    expect(within(dialog()).getByText("No justification")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("has no editor for an included Control", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("button", { name: "Open A.5.1" }));
    expect(within(dialog()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog()).getByText("Inclusion justification · generated")).toBeInTheDocument();
  });
});

describe("Download view", () => {
  it("builds the CSV in the browser from the rows in view, with the server export's columns", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.click(screen.getByRole("tab", { name: /^Excluded/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search the Statement" }), "dcs");
    await user.click(screen.getByRole("button", { name: "Download view" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0];
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = parseCsv(csv.slice(1));
    expect(lines[0].slice(0, 4)).toEqual(["Control code", "Control title", "Applicability", "Included"]);
    expect(lines.slice(1).map((line) => [line[0], line[3], line[6]])).toEqual([["DCS-01", "Excluded", "Yes"], ["DCS-02", "Excluded", "Yes"]]);
    expect(filename).toMatch(/^Statement-of-Applicability-view-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is off when the view is empty", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.type(screen.getByRole("searchbox", { name: "Search the Statement" }), "zzz-nothing");
    expect(screen.getByRole("button", { name: "Download view" })).toBeDisabled();
  });

  it("downloads rows in the order the table shows them", async () => {
    const user = userEvent.setup();
    renderLedger();
    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "source");
    fireEvent.click(screen.getByRole("button", { name: "Download view" }));
    const lines = parseCsv(vi.mocked(downloadCsv).mock.calls[0][0].slice(1));
    expect(lines.slice(1).map((line) => line[0])).toEqual(["A.5.1", "A.5.2", "A.8.1", "DCS-01", "DCS-02", "GRC-01", "CCM-1"]);
  });
});
