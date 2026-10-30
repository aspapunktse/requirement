import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHeader } from "@/components/__tests__/with-header";
import { CSV_BOM } from "@/lib/csv";
import { downloadCsv } from "@/lib/download-csv";
import { parseCsv } from "@/test/csv-parse";
import { FrameworksCatalog } from "../FrameworksCatalog";
import type { CatalogRow, CatalogView } from "../frameworks-types";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/frameworks" }));
vi.mock("@/lib/download-csv", () => ({ downloadCsv: vi.fn() }));
// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<CatalogRow> & Pick<CatalogRow, "id" | "name">): CatalogRow => ({
  version: "1",
  description: null,
  isBase: false,
  strict: false,
  status: "PUBLISHED",
  group: "Other Frameworks",
  family: null,
  level: null,
  requirements: 10,
  covered: 10,
  accepted: 0,
  gaps: 0,
  partialOnly: 0,
  systems: 3,
  reviewGroup: null,
  supplementary: 0,
  updatedAt: "2026-10-20T09:00:00.000Z",
  lineage: [],
  ...over,
});

const ROWS: CatalogRow[] = [
  row({ id: "f-nis2", name: "NIS2", description: "EU network and information security directive", systems: 7, reviewGroup: "Network Review", updatedAt: "2026-09-01T09:00:00.000Z" }),
  row({
    id: "f-iso",
    name: "ISO/IEC 27001",
    version: "2022",
    isBase: true,
    group: "Base Framework",
    requirements: 93,
    covered: 93,
    systems: 12,
    updatedAt: "2026-10-28T09:00:00.000Z",
  }),
  row({
    id: "f-c1",
    name: "CMMC Level 1",
    group: "CMMC",
    family: "CMMC",
    level: 1,
    strict: true,
    requirements: 17,
    covered: 10,
    accepted: 2,
    gaps: 5,
    partialOnly: 3,
    systems: 4,
    reviewGroup: "Defence Review",
    updatedAt: "2026-10-10T09:00:00.000Z",
  }),
  row({
    id: "f-c2",
    name: "CMMC Level 2",
    status: "DRAFT",
    group: "CMMC",
    family: "CMMC",
    level: 2,
    requirements: 20,
    covered: 8,
    gaps: 12,
    partialOnly: 4,
    systems: null,
    reviewGroup: "Defence Review",
    supplementary: 2,
    updatedAt: "2026-10-25T09:00:00.000Z",
    lineage: [
      [
        { id: "f-c1", name: "CMMC Level 1", version: "1", status: "PUBLISHED", current: false },
        { id: "f-c2", name: "CMMC Level 2", version: "1", status: "DRAFT", current: true },
      ],
    ],
  }),
  row({ id: "f-draft-empty", name: "Empty Act", status: "DRAFT", requirements: 0, covered: 0, systems: null, updatedAt: "2026-10-01T09:00:00.000Z" }),
  row({ id: "f-dora", name: "DORA", requirements: 0, covered: 0, systems: 0, updatedAt: "2026-08-01T09:00:00.000Z" }),
];

const view = (over: Partial<CatalogView> = {}): CatalogView => ({
  userId: "u-cm",
  role: "COMPLIANCE_MANAGER",
  roleLabel: "Compliance Manager",
  canCurate: true,
  rows: ROWS,
  ...over,
});
/** What a role that cannot see Drafts is given. */
const published = (): CatalogView => view({ role: "VIEWER", roleLabel: "Viewer", canCurate: false, rows: ROWS.filter((r) => r.status === "PUBLISHED") });

const renderCatalog = (over: Partial<CatalogView> = {}) => render(<FrameworksCatalog view={view(over)} />);
const table = () => screen.getByRole("table", { name: "Frameworks" });
/** The Framework names in the table body, in order. */
const names = () => [...table().querySelectorAll("tbody tr.fc-row")].map((tr) => tr.querySelector(".fwn b")?.textContent);
const groupNames = () => [...table().querySelectorAll("tbody tr.sy-grp")].map((tr) => tr.textContent);
const rowOf = (id: string) => table().querySelector(`tr[data-id="${id}"]`) as HTMLElement;
const stat = (name: RegExp) => screen.getByRole("button", { name });
const lede = () => document.querySelector(".hc-lede") as HTMLElement;
const groupBy = (label: string) => userEvent.click(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: label }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  push.mockClear();
  refresh.mockClear();
  vi.mocked(downloadCsv).mockClear();
  vi.unstubAllGlobals();
});

describe("hero", () => {
  it("counts the Frameworks, Requirements and open Coverage Gaps, and the Drafts for a curator", () => {
    renderCatalog();
    expect(screen.getByRole("heading", { level: 1, name: "Frameworks" })).toBeInTheDocument();
    expect(screen.getByText("Requirement database · Compliance Manager")).toBeInTheDocument();
    expect(screen.getByText("6 Frameworks")).toBeInTheDocument();
    expect(screen.getByText("140", { selector: ".num" })).toBeInTheDocument();
    expect(lede()).toHaveTextContent("6 Frameworks with 140 Requirements mapped onto one Control Library. 17 Coverage Gaps are open across 2 Drafts.");
  });

  it("does not mention Drafts to a role that cannot see them", () => {
    render(<FrameworksCatalog view={published()} />);
    expect(lede()).toHaveTextContent("4 Frameworks with 120 Requirements mapped onto one Control Library. 5 Coverage Gaps are open.");
    expect(lede()).not.toHaveTextContent("Draft");
  });

  it("draws a ring of the library-wide resolved share with its legend", () => {
    renderCatalog();
    // (covered 10+8+93+10 = 121, accepted 2) of 140 Requirements
    expect(screen.getByRole("img", { name: "88% of 140 Requirements are covered or accepted" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Requirements by coverage" });
    expect(legend).toHaveTextContent("121 covered");
    expect(legend).toHaveTextContent("2 accepted gaps");
    expect(legend).toHaveTextContent("7 gaps, Partial only");
    expect(legend).toHaveTextContent("10 gaps, no mapping");
  });

  it("shows + New Framework only to a curator, linking to the create page", () => {
    const { unmount } = renderCatalog();
    expect(screen.getByRole("link", { name: "+ New Framework" })).toHaveAttribute("href", "/frameworks/new");
    unmount();
    render(<FrameworksCatalog view={published()} />);
    expect(screen.queryByRole("link", { name: "+ New Framework" })).not.toBeInTheDocument();
  });
});

describe("stat cards are filters", () => {
  it("counts each view and toggles it with aria-pressed", async () => {
    renderCatalog();
    expect(stat(/^All Frameworks/)).toHaveTextContent("6");
    expect(stat(/^Drafts/)).toHaveTextContent("2");
    expect(stat(/^With open gaps/)).toHaveTextContent("2");
    expect(stat(/^Fully resolved/)).toHaveTextContent("2");
    expect(stat(/^No Requirements/)).toHaveTextContent("2");

    await userEvent.click(stat(/^With open gaps/));
    expect(stat(/^With open gaps/)).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["CMMC Level 1", "CMMC Level 2"]);
    await userEvent.click(stat(/^With open gaps/));
    expect(stat(/^With open gaps/)).toHaveAttribute("aria-pressed", "false");
    expect(names()).toHaveLength(6);
  });

  it("Fully resolved needs Requirements and no open gap; No Requirements lists the empty ones; Drafts the Drafts", async () => {
    renderCatalog();
    await userEvent.click(stat(/^Fully resolved/));
    expect(names()).toEqual(["ISO/IEC 27001", "NIS2"]);
    await userEvent.click(stat(/^No Requirements/));
    expect(names()).toEqual(["DORA", "Empty Act"]);
    await userEvent.click(stat(/^Drafts/));
    expect(names()).toEqual(["CMMC Level 2", "Empty Act"]);
  });

  it("has no Drafts card for a role that cannot see Drafts", () => {
    render(<FrameworksCatalog view={published()} />);
    expect(screen.queryByRole("button", { name: /^Drafts/ })).not.toBeInTheDocument();
    expect(stat(/^All Frameworks/)).toHaveTextContent("4");
  });
});

describe("search", () => {
  it("matches the label, the description and the Review Group", async () => {
    renderCatalog();
    const search = screen.getByRole("searchbox", { name: "Search Frameworks" });
    await userEvent.type(search, "iso/iec 27001:2022");
    expect(names()).toEqual(["ISO/IEC 27001"]);
    await userEvent.clear(search);
    await userEvent.type(search, "directive");
    expect(names()).toEqual(["NIS2"]);
    await userEvent.clear(search);
    await userEvent.type(search, "defence review");
    expect(names()).toEqual(["CMMC Level 1", "CMMC Level 2"]);
  });

  it("is focused by / and narrows within the chosen view", async () => {
    renderCatalog();
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search Frameworks" })).toHaveFocus();
    await userEvent.click(stat(/^With open gaps/));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Frameworks" }), "Level 2");
    expect(names()).toEqual(["CMMC Level 2"]);
    expect(screen.getByText("1 of 6 Frameworks")).toBeInTheDocument();
  });

  it("says No Frameworks match, and Clear filters brings everything back", async () => {
    renderCatalog();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Frameworks" }), "zzz");
    expect(screen.getByRole("heading", { name: "No Frameworks match" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toHaveLength(6);
    expect(screen.getByRole("searchbox", { name: "Search Frameworks" })).toHaveValue("");
  });

  it("says there are no Frameworks yet when there are none", () => {
    renderCatalog({ rows: [] });
    expect(screen.getByRole("heading", { name: "No Frameworks yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /New Framework/ })).not.toHaveLength(0);
  });
});

describe("group", () => {
  it("groups by family by default: the base Framework, each family, then the rest, with counts and open gaps", () => {
    renderCatalog();
    expect(groupNames()).toEqual(["Base Framework1 Framework · 0 gaps", "CMMC2 Frameworks · 17 gaps", "Other Frameworks3 Frameworks · 0 gaps"]);
    // The default order within the table: base first, then by name, a family by level.
    expect(names()).toEqual(["ISO/IEC 27001", "CMMC Level 1", "CMMC Level 2", "DORA", "Empty Act", "NIS2"]);
  });

  it("groups by status, and not at all", async () => {
    renderCatalog();
    await groupBy("Status");
    expect(groupNames()).toEqual(["Published4 Frameworks · 5 gaps", "Draft2 Frameworks · 12 gaps"]);
    expect(within(screen.getByRole("group", { name: "Group by" })).getByRole("button", { name: "Status" })).toHaveAttribute("aria-pressed", "true");
    await groupBy("None");
    expect(groupNames()).toEqual([]);
    expect(names()).toHaveLength(6);
  });
});

describe("sort", () => {
  const headerButton = (name: string) => within(table()).getByRole("button", { name: new RegExp(`^${name}`) });

  it("sorts by name, then reverses; the sorted column carries aria-sort", async () => {
    renderCatalog();
    await groupBy("None");
    await userEvent.click(headerButton("Framework"));
    expect(names()).toEqual(["CMMC Level 1", "CMMC Level 2", "DORA", "Empty Act", "ISO/IEC 27001", "NIS2"]);
    expect(headerButton("Framework").closest("th")).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(headerButton("Framework"));
    expect(names()[0]).toBe("NIS2");
    expect(headerButton("Framework").closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts by gaps, most first", async () => {
    renderCatalog();
    await groupBy("None");
    await userEvent.click(headerButton("Gaps"));
    expect(names().slice(0, 2)).toEqual(["CMMC Level 2", "CMMC Level 1"]);
  });

  it("sorts by resolved share (a Framework with no Requirements last when most first), Systems and Updated", async () => {
    renderCatalog();
    await groupBy("None");
    await userEvent.click(headerButton("Coverage"));
    expect(names()).toEqual(["ISO/IEC 27001", "NIS2", "CMMC Level 1", "CMMC Level 2", "DORA", "Empty Act"]);
    await userEvent.click(headerButton("Systems"));
    expect(names()).toEqual(["ISO/IEC 27001", "NIS2", "CMMC Level 1", "DORA", "CMMC Level 2", "Empty Act"]);
    await userEvent.click(headerButton("Updated"));
    expect(names()).toEqual(["ISO/IEC 27001", "CMMC Level 2", "CMMC Level 1", "Empty Act", "NIS2", "DORA"]);
  });
});

describe("rows", () => {
  it("shows the Framework with its version, tags, description and version lineage", () => {
    renderCatalog();
    const iso = rowOf("f-iso");
    expect(within(iso).getByText("2022")).toBeInTheDocument();
    expect(within(iso).getByText("Base Framework")).toBeInTheDocument();
    expect(within(rowOf("f-c1")).getByText("Strict")).toBeInTheDocument();
    expect(within(rowOf("f-nis2")).getByText("EU network and information security directive")).toBeInTheDocument();
    expect(rowOf("f-c2")).toHaveTextContent("Version lineage: CMMC Level 1:1 → CMMC Level 2:1 (Draft)");
    expect(within(rowOf("f-nis2")).queryByText(/Version lineage/)).not.toBeInTheDocument();
  });

  it("shows the coverage bar and share, the split gaps, accepted, Systems, Review Group and the date", () => {
    renderCatalog();
    const c1 = rowOf("f-c1");
    expect(within(c1).getByRole("img", { name: "10 covered, 2 accepted, 5 open gaps of 17 Requirements" })).toBeInTheDocument();
    expect(c1).toHaveTextContent("71% resolved · 10/17 covered");
    expect(c1).toHaveTextContent("5");
    expect(c1).toHaveTextContent("3 Partial · 2 none");
    expect(c1.querySelector("td.c-acc")).toHaveTextContent("2");
    expect(c1.querySelector("td.c-sys")).toHaveTextContent("4");
    expect(c1.querySelector("td.c-rg")).toHaveTextContent("Defence Review");
    expect(c1.querySelector("td.c-upd")).toHaveTextContent("10 Oct 2026");
  });

  it("shows 0 gaps for a resolved Framework, a dash for Systems of a Draft, and Base Review Step for the base", () => {
    renderCatalog();
    expect(rowOf("f-nis2").querySelector("td.c-gaps")).toHaveTextContent("0");
    expect(rowOf("f-c2").querySelector("td.c-sys")).toHaveTextContent("—");
    expect(rowOf("f-iso").querySelector("td.c-rg")).toHaveTextContent("Base Review Step");
    expect(rowOf("f-nis2").querySelector("td.c-rg")).toHaveTextContent("Network Review");
    expect(rowOf("f-dora").querySelector("td.c-rg")).toHaveTextContent("—");
  });

  it("warns about a Framework with no Requirements, and tells a Published one from a Draft", () => {
    renderCatalog();
    expect(rowOf("f-dora")).toHaveTextContent("Published with no Requirements");
    expect(rowOf("f-draft-empty")).toHaveTextContent("No Requirements yet");
    expect(within(rowOf("f-dora")).getByRole("img", { name: "No Requirements yet" })).toBeInTheDocument();
    expect(rowOf("f-dora").querySelector("td.c-gaps")).toHaveTextContent("—");
  });

  it("opens the coverage page from the row, from the name and from Coverage →", async () => {
    renderCatalog();
    await userEvent.click(rowOf("f-nis2").querySelector("td.c-rg")!);
    expect(push).toHaveBeenCalledWith("/frameworks/f-nis2/coverage");
    push.mockClear();
    expect(within(rowOf("f-nis2")).getByRole("link", { name: "Coverage of NIS2:1" })).toHaveAttribute("href", "/frameworks/f-nis2/coverage");
    expect(within(rowOf("f-nis2")).getByRole("link", { name: /^NIS2/ })).toHaveAttribute("href", "/frameworks/f-nis2/coverage");
  });

  it("ends with the count and the colour legend", () => {
    renderCatalog();
    expect(screen.getByText("6 of 6 Frameworks")).toBeInTheDocument();
    expect(screen.getByLabelText("Coverage colours")).toHaveTextContent("Gap, Partial mappings only");
  });
});

describe("Publish from the row", () => {
  it("offers Publish on a Draft, for a curator only", () => {
    const { unmount } = renderCatalog();
    expect(screen.getAllByRole("button", { name: /^Publish / })).toHaveLength(2);
    expect(within(rowOf("f-nis2")).queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
    unmount();
    // Defence in depth: even given a Draft row, a role that cannot curate gets no button.
    render(<FrameworksCatalog view={view({ role: "VIEWER", roleLabel: "Viewer", canCurate: false })} />);
    expect(screen.queryByRole("button", { name: /^Publish / })).not.toBeInTheDocument();
  });

  it("asks first, saying what publishing does, and Cancel sends nothing", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Publish CMMC Level 2:1" }));
    const dialog = screen.getByRole("dialog", { name: "Publish CMMC Level 2:1?" });
    expect(dialog).toHaveTextContent("count on every System that declares it in its Framework Scope");
    expect(dialog).toHaveTextContent("12 Coverage Gaps are still open (4 with Partial mappings only, 8 with none)");
    expect(dialog).toHaveTextContent("2 Supplementary Controls authored for it reach Systems now.");
    expect(dialog).toHaveTextContent("Defence Review gets a Review Step on Systems in review.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says when every Requirement is covered and no Supplementary Control or Review Group is involved", async () => {
    renderCatalog({ rows: [row({ id: "f-ok", name: "Ready", status: "DRAFT", systems: null })] });
    await userEvent.click(screen.getByRole("button", { name: "Publish Ready:1" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Every Requirement is covered or accepted.");
    expect(dialog).not.toHaveTextContent("Supplementary");
    expect(dialog).not.toHaveTextContent("Review Step");
  });

  it("posts to the publish route, then refreshes the page data, closes and says so", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ framework: {} }), { status: 200 }));
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Publish CMMC Level 2:1" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith("/api/frameworks/f-c2/publish", { method: "POST" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("CMMC Level 2:1 published")).toBeInTheDocument();
  });

  it("keeps the dialog open with the reason when the route refuses (403) or fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Publish CMMC Level 2:1" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();

    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Failed to publish the Framework"));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Download CSV", () => {
  it("holds the rows of the current view in the table's order, built in the browser", async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0];
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(filename).toMatch(/^frameworks-\d{4}-\d{2}-\d{2}\.csv$/);
    const table_ = parseCsv(csv.slice(CSV_BOM.length));
    expect(table_[0][0]).toBe("Framework");
    expect(table_.slice(1).map((r) => r[0])).toEqual(["ISO/IEC 27001", "CMMC Level 1", "CMMC Level 2", "DORA", "Empty Act", "NIS2"]);
    const c1 = table_.find((r) => r[0] === "CMMC Level 1")!;
    const col = (name: string) => table_[0].indexOf(name);
    expect(c1[col("Family")]).toBe("CMMC");
    expect(c1[col("Status")]).toBe("Published");
    expect(c1[col("Strict")]).toBe("Yes");
    expect(c1[col("Requirements")]).toBe("17");
    expect(c1[col("Open gaps")]).toBe("5");
    expect(c1[col("Gaps, Partial mappings only")]).toBe("3");
    expect(c1[col("Gaps, no mapping")]).toBe("2");
    expect(c1[col("Resolved %")]).toBe("71");
    expect(c1[col("Review Group")]).toBe("Defence Review");
    expect(c1[col("Updated")]).toBe("2026-10-10");
    const draft = table_.find((r) => r[0] === "CMMC Level 2")!;
    expect(draft[col("Systems")]).toBe("");
    expect(table_.find((r) => r[0] === "ISO/IEC 27001")![col("Review Group")]).toBe("Base Review Step");
    expect(table_.find((r) => r[0] === "DORA")![col("Resolved %")]).toBe("");
  });

  it("never holds more than the view: a filter and a search narrow it", async () => {
    renderCatalog();
    await userEvent.click(stat(/^With open gaps/));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Frameworks" }), "level 1");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    const rows = parseCsv(vi.mocked(downloadCsv).mock.calls[0][0].slice(CSV_BOM.length));
    expect(rows.slice(1).map((r) => r[0])).toEqual(["CMMC Level 1"]);
  });
});

describe("Ctrl+K palette", () => {
  it("lists New Framework (when allowed) and every Framework, and opens one's coverage page", async () => {
    render(withHeader(<FrameworksCatalog view={view()} />));
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Jump to" });
    const options = within(dialog).getAllByRole("option");
    expect(options.slice(0, 7).map((o) => o.querySelector("span")?.textContent)).toEqual([
      "New Framework",
      "ISO/IEC 27001:2022",
      "CMMC Level 1:1",
      "CMMC Level 2:1",
      "DORA:1",
      "Empty Act:1",
      "NIS2:1",
    ]);
    expect(options[3]).toHaveTextContent("12 open gaps");
    await userEvent.type(within(dialog).getByRole("combobox"), "level 2");
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/frameworks/f-c2/coverage");
  });

  it("opens New Framework from the palette", async () => {
    render(withHeader(<FrameworksCatalog view={view()} />));
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/frameworks/new");
  });

  it("leaves out New Framework, and Drafts, for a role that cannot create or see them", async () => {
    render(withHeader(<FrameworksCatalog view={published()} />));
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Jump to" });
    expect(within(dialog).queryByText("New Framework")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("CMMC Level 2:1")).not.toBeInTheDocument();
    expect(within(dialog).getByText("CMMC Level 1:1")).toBeInTheDocument();
  });
});
