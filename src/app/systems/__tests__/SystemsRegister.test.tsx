import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withHeader } from "@/components/__tests__/with-header";
import { CSV_BOM } from "@/lib/csv";
import { pageNumbers, SystemsRegister } from "../SystemsRegister";
import { downloadCsv } from "../systems-download";
import type { SystemRow } from "../systems-types";
import { row, view } from "./fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), usePathname: () => "/systems" }));
vi.mock("../systems-download", () => ({ downloadCsv: vi.fn() }));
// A plain anchor: the real Link prefetches and updates state outside act() once per row.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Rendering 130 rows through user-event takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  window.history.replaceState(null, "", "/systems");
});

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.mocked(downloadCsv).mockClear();
});

const renderRegisterWithHeader = (over: Parameters<typeof view>[0] = {}) => render(withHeader(<SystemsRegister view={view(over)} initialQuery="" />));
const renderRegister = (over: Parameters<typeof view>[0] = {}, query = "") => render(<SystemsRegister view={view(over)} initialQuery={query} />);
const table = () => screen.getByRole("table", { name: "Systems" });
/** The System names in the table body, in order. */
const names = () => [...table().querySelectorAll("tbody tr.sy-row")].map((tr) => tr.querySelector(".name a")?.textContent);
const search = () => window.location.search;
const rowOf = (name: string) => within(table()).getByRole("link", { name }).closest("tr") as HTMLElement;

describe("hero", () => {
  it("names the role, counts the Systems and those that need attention, and shows the role view's count", () => {
    renderRegister();
    expect(screen.getByText("Systems · System Owner")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Systems" })).toBeInTheDocument();
    expect(screen.getByText(/in the register, 3 of them need attention/)).toBeInTheDocument();
    expect(screen.getByText("Owned by me: 1")).toBeInTheDocument();
    expect(screen.getByText("1 in review")).toBeInTheDocument();
    expect(screen.getByText("1 rejected")).toBeInTheDocument();
  });

  it("leaves out the in-review chip for a Reviewer, whose view it is", () => {
    renderRegister({ role: "REVIEWER", roleLabel: "Reviewer", roleView: { label: "Awaiting review", warn: true } });
    expect(screen.queryByText("1 in review")).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting review: 1")).toBeInTheDocument();
  });

  it("shows + New System only to a role that may create a System, in the hero and the palette", async () => {
    const { unmount } = renderRegister();
    expect(screen.getByRole("link", { name: "+ New System" })).toHaveAttribute("href", "/systems/new");
    unmount();
    renderRegisterWithHeader({ canCreate: false });
    expect(screen.queryByRole("link", { name: "+ New System" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(within(screen.getByRole("dialog")).queryByText("New System")).not.toBeInTheDocument();
  });

  it("draws a ring of Systems by Onboarding Status whose legend entries filter by status and toggle", async () => {
    renderRegister();
    expect(screen.getByRole("img", { name: "20% of 5 Systems are onboarded" })).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Systems by Onboarding Status" });
    const draft = within(legend).getByRole("button", { name: /Draft/ });
    expect(draft).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(draft);
    expect(draft).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Legacy CRM"]);
    expect(search()).toBe("?status=DRAFT");
    await userEvent.click(draft);
    expect(draft).toHaveAttribute("aria-pressed", "false");
    expect(names()).toHaveLength(5);
  });

  it("says there is nothing to show yet, with no ring, when the user sees no System", () => {
    renderRegister({ rows: [] });
    expect(screen.getByText("No Systems to show yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Systems are onboarded/ })).not.toBeInTheDocument();
    expect(within(table()).getByText("No Systems to show yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(within(table()).getByRole("link", { name: /New System/ })).toBeInTheDocument();
  });
});

describe("stat cards as saved views", () => {
  const card = (label: RegExp) => screen.getByRole("button", { name: label });

  it("shows the five views with their counts and the role view's own name", () => {
    renderRegister();
    const stats = screen.getByRole("region", { name: "Saved views" });
    expect(within(stats).getAllByRole("button").map((b) => b.querySelector(".k")?.textContent?.replace(/(Filter →|On ✕)$/, ""))).toEqual([
      "All Systems",
      "Owned by me",
      "Needs attention",
      "Not classified",
      "Providers",
    ]);
    expect(within(card(/^Needs attention/)).getByText("3")).toBeInTheDocument();
    expect(within(card(/^Not classified/)).getByText("2")).toBeInTheDocument();
    expect(within(card(/^Providers/)).getByText("1")).toBeInTheDocument();
  });

  it("toggles a view with aria-pressed, filters the table and writes it to the URL", async () => {
    renderRegister();
    const attention = card(/^Needs attention/);
    expect(attention).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(attention);
    expect(attention).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["=HYPERLINK(hub)", "Billing engine", "Legacy CRM"]);
    expect(search()).toBe("?view=attention");
    await userEvent.click(attention);
    expect(attention).toHaveAttribute("aria-pressed", "false");
    expect(names()).toHaveLength(5);
    expect(search()).toBe("");
  });

  it("draws a sparkline only for a view with a trend", () => {
    renderRegister();
    expect(card(/^All Systems/).querySelector("svg polyline")).not.toBeNull();
    expect(card(/^Needs attention/).querySelector("svg polyline")).not.toBeNull();
    expect(card(/^Providers/).querySelector("svg")).toBeNull();
  });
});

describe("status tabs", () => {
  it("count the Systems of the current view, search and filters", async () => {
    renderRegister();
    const tabs = screen.getByRole("tablist", { name: "Onboarding Status" });
    const counts = () => within(tabs).getAllByRole("tab").map((tab) => `${tab.firstChild?.textContent}:${tab.querySelector(".n")?.textContent}`);
    expect(counts()).toEqual(["All:5", "Draft:1", "In Review:1", "Approved:1", "Onboarded:1", "Rejected:1"]);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Systems" }), "elena");
    expect(counts()).toEqual(["All:2", "Draft:1", "In Review:1", "Approved:0", "Onboarded:0", "Rejected:0"]);
  });

  it("selects with a click and with the arrow keys, and the panel follows", async () => {
    renderRegister();
    const all = screen.getByRole("tab", { name: /^All/ });
    expect(all).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /^Approved/ }));
    expect(names()).toEqual(["Okta"]);
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "sy-tab-APPROVED");
    screen.getByRole("tab", { name: /^Approved/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /^Onboarded/ })).toHaveAttribute("aria-selected", "true");
    expect(names()).toEqual(["Jira"]);
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: /^All/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("search and filters", () => {
  it("searches name, vendor and owner, and / focuses the search box", async () => {
    renderRegister();
    await userEvent.keyboard("/");
    expect(screen.getByRole("searchbox", { name: "Search Systems" })).toHaveFocus();
    await userEvent.keyboard("atlassian");
    expect(names()).toEqual(["Jira"]);
    expect(search()).toBe("?q=atlassian");
  });

  it("opens a filter menu with a count per option, applies it, and shows the choice on the button", async () => {
    renderRegister();
    await userEvent.click(screen.getByRole("button", { name: /\+ Owner/ }));
    const menu = screen.getByRole("group", { name: "Owner" });
    expect(within(menu).getByText("Elena Voss").closest("label")).toHaveTextContent("2");
    await userEvent.click(within(menu).getByLabelText(/Elena Voss/));
    expect(names()).toEqual(["Billing engine", "Legacy CRM"]);
    expect(screen.getByRole("button", { name: /Owner: Elena Voss/ })).toBeInTheDocument();
    await userEvent.click(within(menu).getByLabelText(/Priya Shah/));
    expect(screen.getByRole("button", { name: /Owner: 2/ })).toBeInTheDocument();
    expect(search()).toMatch(/owners=u-elena&owners=u-priya/);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("filters by Business Unit, Deployment Facet and highest Impact Level", async () => {
    renderRegister();
    await userEvent.click(screen.getByRole("button", { name: /\+ Business Unit/ }));
    await userEvent.click(within(screen.getByRole("group", { name: "Business Unit" })).getByLabelText(/Engineering/));
    expect(names()).toEqual(["Billing engine"]);
    await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    await userEvent.click(screen.getByRole("button", { name: /\+ Deployment Facet/ }));
    await userEvent.click(within(screen.getByRole("group", { name: "Deployment Facet" })).getByLabelText(/On-Premises/));
    expect(names()).toEqual(["Billing engine"]);
    await userEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    await userEvent.click(screen.getByRole("button", { name: /\+ Highest Impact Level/ }));
    await userEvent.click(within(screen.getByRole("group", { name: "Highest Impact Level" })).getByLabelText(/Not classified/));
    expect(names()).toEqual(["Legacy CRM"]);
  });

  it("closes an open menu on a click elsewhere", async () => {
    renderRegister();
    await userEvent.click(screen.getByRole("button", { name: /\+ Owner/ }));
    expect(screen.getByRole("group", { name: "Owner" })).toBeInTheDocument();
    await userEvent.click(document.body);
    expect(screen.queryByRole("group", { name: "Owner" })).not.toBeInTheDocument();
  });

  it("shows No Systems match with Clear filters, which restores the list and the URL", async () => {
    renderRegister();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Systems" }), "zzzz");
    expect(within(table()).getByText("No Systems match")).toBeInTheDocument();
    await userEvent.click(within(table()).getByRole("button", { name: "Clear filters" }));
    expect(names()).toHaveLength(5);
    expect(screen.getByRole("searchbox", { name: "Search Systems" })).toHaveValue("");
    expect(search()).toBe("");
  });
});

describe("table", () => {
  it("shows the System, Status, Owner, Deployment, C·I·A, Business Unit, Requirements met and Updated", () => {
    renderRegister();
    const jira = rowOf("Jira");
    expect(within(jira).getByRole("link", { name: "Jira" })).toHaveAttribute("href", "/systems/s-jira");
    expect(jira).toHaveTextContent("Atlassian");
    expect(jira).toHaveTextContent("Onboarded");
    expect(jira).toHaveTextContent("Marcus Lindqvist (you)");
    expect(jira).toHaveTextContent("SaaS");
    expect(jira).toHaveTextContent("Finance");
    expect(jira).toHaveTextContent("9/10");
    expect(jira).toHaveTextContent("5 d ago");
    expect(within(jira).getByRole("img", { name: "Confidentiality moderate, Integrity moderate, Availability moderate" })).toBeInTheDocument();

    const billing = rowOf("Billing engine");
    expect(billing).toHaveTextContent("Built in-house");
    expect(within(billing).getByLabelText("3 open questions")).toBeInTheDocument();
    expect(within(billing).getByText("+1")).toBeInTheDocument();
    expect(within(billing).getByText("Cloud IaaS/PaaS")).toBeInTheDocument();
    expect(within(billing).getByText("On-Premises Datacenter")).toBeInTheDocument();
    expect(within(billing).getByRole("img", { name: "Confidentiality high, Integrity critical, Availability not classified" })).toBeInTheDocument();
    expect(within(billing).getByText("Engineering")).toBeInTheDocument();

    expect(within(rowOf("Okta")).getByText("Provider")).toBeInTheDocument();
    expect(rowOf("Legacy CRM")).toHaveTextContent("5 mo ago");
    expect(rowOf("Okta")).toHaveTextContent("1 y ago");
  });

  it("shows a dash where nothing is measured, and the fulfilment is against the base Framework", () => {
    renderRegister();
    const legacy = rowOf("Legacy CRM");
    expect(legacy.querySelector(".c-prog")).toHaveTextContent("—");
    expect(legacy.querySelector(".c-unit")).toHaveTextContent("—");
    const bar = rowOf("Jira").querySelector(".prog");
    expect(bar).toHaveAttribute("title", "9 of 10 Requirements of ISO/IEC 27001:2022 met");
  });

  it("opens the System page when a row is clicked, but not from its checkbox", async () => {
    renderRegister();
    const jira = rowOf("Jira");
    await userEvent.click(within(jira).getByRole("checkbox"));
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(within(jira).getByText("Onboarded"));
    expect(push).toHaveBeenCalledWith("/systems/s-jira");
  });

  it("sorts by a column, flips on a second click, and marks it with aria-sort", async () => {
    renderRegister();
    expect(names()).toEqual(["=HYPERLINK(hub)", "Billing engine", "Jira", "Legacy CRM", "Okta"]);
    const header = (name: string) => within(table()).getByRole("columnheader", { name: new RegExp(name) });
    expect(header("System")).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(header("Requirements met")).getByRole("button"));
    expect(names()).toEqual(["=HYPERLINK(hub)", "Billing engine", "Jira", "Okta", "Legacy CRM"]);
    expect(header("Requirements met")).toHaveAttribute("aria-sort", "ascending");
    expect(header("System")).not.toHaveAttribute("aria-sort");
    expect(search()).toBe("?sort=prog");
    await userEvent.click(within(header("Requirements met")).getByRole("button"));
    expect(names()).toEqual(["Okta", "Jira", "Billing engine", "=HYPERLINK(hub)", "Legacy CRM"]);
    expect(header("Requirements met")).toHaveAttribute("aria-sort", "descending");
    expect(search()).toBe("?sort=prog&dir=desc");
  });

  it("groups by owner, with a lane header and a count per group, and by Business Unit", async () => {
    renderRegister();
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "owner");
    const headers = [...table().querySelectorAll("tr.sy-grp")].map((tr) => tr.textContent);
    expect(headers).toEqual(["Elena Voss2", "Marcus Lindqvist1", "Priya Shah2"]);
    expect(search()).toBe("?group=owner");
    await userEvent.selectOptions(screen.getByLabelText("Group by"), "unit");
    expect([...table().querySelectorAll("tr.sy-grp")].map((tr) => tr.textContent)).toEqual(["Engineering1", "Finance4", "No Business Unit1"]);
  });

  it("toggles compact rows", async () => {
    const { container } = renderRegister();
    const compact = screen.getByRole("button", { name: "Compact" });
    expect(compact).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(compact);
    expect(compact).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector(".sy")).toHaveClass("compact");
  });
});

describe("paging", () => {
  const many: SystemRow[] = Array.from({ length: 130 }, (_, i) => row({ id: `s-${i}`, name: `System ${String(i).padStart(3, "0")}` }));

  it("shows 50 rows a page by default, offers 25, 50 and 100, and moves between pages", async () => {
    renderRegister({ rows: many });
    expect(names()).toHaveLength(50);
    expect(screen.getByText("1–50 of 130")).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Pages" });
    expect(within(pager).getByRole("button", { name: "Previous page" })).toBeDisabled();
    await userEvent.click(within(pager).getByRole("button", { name: "2" }));
    expect(names()[0]).toBe("System 050");
    expect(screen.getByText("51–100 of 130")).toBeInTheDocument();
    expect(search()).toBe("?page=2");
    await userEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(names()).toHaveLength(30);
    expect(within(pager).getByRole("button", { name: "Next page" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Rows"), "25");
    expect(names()).toHaveLength(25);
    expect(screen.getByText("1–25 of 130")).toBeInTheDocument();
    expect(search()).toBe("?per=25");
    expect([...screen.getByLabelText("Rows").querySelectorAll("option")].map((o) => o.textContent)).toEqual(["25", "50", "100"]);
    await userEvent.selectOptions(screen.getByLabelText("Rows"), "100");
    expect(names()).toHaveLength(100);
  });

  it("goes back to the first page when a filter changes", async () => {
    renderRegister({ rows: many }, "page=3&per=25");
    expect(names()[0]).toBe("System 050");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Systems" }), "System 12");
    expect(search()).not.toContain("page=");
    expect(names()).toHaveLength(10);
  });

  it("lists every page number for a few pages and a window with gaps for many", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(1, 1)).toEqual([1]);
    expect(pageNumbers(10, 20)).toEqual([1, 2, "gap", 9, 10, 11, "gap", 19, 20]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, "gap", 19, 20]);
  });

  it("explains the C·I·A bars in the footer", () => {
    renderRegister();
    const legend = screen.getByLabelText("CIA impact legend");
    for (const text of ["not classified", "low", "moderate", "high", "critical"]) expect(legend).toHaveTextContent(text);
  });
});

describe("row selection and the bulk bar", () => {
  const checkbox = (name: string) => screen.getByRole("checkbox", { name });

  it("has no bulk bar until a row is selected, then shows the count, Export CSV and a way to clear", async () => {
    renderRegister();
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
    await userEvent.click(checkbox("Select Jira"));
    await userEvent.click(checkbox("Select Okta"));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("2")).toBeInTheDocument();
    expect(within(bar).getByText(/selected/)).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
    expect(checkbox("Select Jira")).not.toBeChecked();
  });

  it("shows Add to Internal Audit to an Internal Auditor only", async () => {
    const { unmount } = renderRegister({ role: "INTERNAL_AUDITOR", roleLabel: "Internal Auditor" });
    await userEvent.click(checkbox("Select Jira"));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toContain("Add to Internal Audit");
    unmount();

    for (const role of ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "REVIEWER", "VIEWER"] as const) {
      const { unmount: next } = renderRegister({ role });
      await userEvent.click(checkbox("Select Jira"));
      expect(screen.queryByRole("button", { name: "Add to Internal Audit" }), role).not.toBeInTheDocument();
      next();
    }
  });

  it("lists the bar's buttons for a System Owner: no Add to Internal Audit", async () => {
    renderRegister();
    await userEvent.click(checkbox("Select Jira"));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Export CSV", "Change owner", "✕"]);
  });

  it("opens the Add to Internal Audit dialog with the selected Systems and clears the selection when it is done", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>((input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input) === "/api/internal-audits"
              ? { internalAudits: [{ id: "a1", title: "Access review", dueDate: "2026-12-01", status: "DRAFT", systemCount: 0 }] }
              : { added: 2, skipped: 0 },
          ),
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      renderRegister({ role: "INTERNAL_AUDITOR", roleLabel: "Internal Auditor" });
      await userEvent.click(checkbox("Select Jira"));
      await userEvent.click(checkbox("Select Okta"));
      await userEvent.click(screen.getByRole("button", { name: "Add to Internal Audit" }));

      const dialog = screen.getByRole("dialog", { name: "Add to Internal Audit" });
      expect(dialog).toHaveTextContent("Jira, Okta");
      await userEvent.click(await within(dialog).findByRole("radio", { name: /Access review/ }));
      await userEvent.click(within(dialog).getByRole("button", { name: "Add to audit" }));
      await userEvent.click(await within(dialog).findByRole("button", { name: "Done" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
      const post = fetchMock.mock.calls.find(([url]) => url === "/api/internal-audits/a1/systems")!;
      expect(JSON.parse(post[1]!.body as string).systemIds.sort()).toEqual(["s-jira", "s-okta"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("selects and clears every row on the page, with an indeterminate state in between", async () => {
    renderRegister();
    const all = checkbox("Select all on page") as HTMLInputElement;
    await userEvent.click(checkbox("Select Jira"));
    expect(all.indeterminate).toBe(true);
    await userEvent.click(all);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("5");
    await userEvent.click(all);
    expect(screen.queryByRole("region", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("selects only the rows of the current page", async () => {
    const many = Array.from({ length: 60 }, (_, i) => row({ id: `s-${i}`, name: `System ${String(i).padStart(2, "0")}` }));
    renderRegister({ rows: many });
    await userEvent.click(checkbox("Select all on page"));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("50");
  });

  it("exports the selected rows only, built in the browser", async () => {
    renderRegister();
    await userEvent.click(checkbox("Select Jira"));
    await userEvent.click(within(screen.getByRole("region", { name: "Bulk actions" })).getByRole("button", { name: "Export CSV" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0];
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
    expect(csv).toContain('"Jira","Atlassian"');
    expect(csv).not.toContain("Okta");
    expect(filename).toMatch(/^systems-selection-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("the hero's Export CSV holds every row of the current view, not just one page", async () => {
    const many = Array.from({ length: 70 }, (_, i) => row({ id: `s-${i}`, name: `System ${String(i).padStart(2, "0")}`, needsAttention: i < 60 }));
    renderRegister({ rows: many });
    await userEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
    await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0];
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(61);
    expect(filename).toMatch(/^systems-register-/);
  });
});

describe("state in the URL", () => {
  it("starts from the address: Home's ?owner=me selects Owned by me, ?status=ONBOARDED the Onboarded tab", () => {
    const { unmount } = renderRegister({}, "owner=me");
    expect(screen.getByRole("button", { name: /^Owned by me/ })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Jira"]);
    unmount();
    renderRegister({}, "status=ONBOARDED");
    expect(screen.getByRole("tab", { name: /^Onboarded/ })).toHaveAttribute("aria-selected", "true");
    expect(names()).toEqual(["Jira"]);
  });

  it("for another role ?owner=me filters by the user as Owner", () => {
    renderRegister({ role: "ADMIN", roleLabel: "Admin", userId: "u-elena", roleView: { label: "Under 70% met", warn: true } }, "owner=me");
    expect(names()).toEqual(["Billing engine", "Legacy CRM"]);
    expect(screen.getByRole("button", { name: /Owner: Elena Voss/ })).toBeInTheDocument();
  });

  it("adds a history entry per change (typing replaces) and follows Back", async () => {
    const before = window.history.length;
    renderRegister();
    await userEvent.click(screen.getByRole("tab", { name: /^Draft/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Providers/ }));
    expect(window.history.length).toBe(before + 2);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Systems" }), "ab");
    expect(window.history.length).toBe(before + 2);
    expect(search()).toBe("?view=providers&status=DRAFT&q=ab");

    window.history.replaceState(null, "", "/systems?status=DRAFT");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: /^Draft/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /^Providers/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("searchbox", { name: "Search Systems" })).toHaveValue("");
  });
});

describe("Ctrl+K palette", () => {
  it("lists New System and every visible System, narrows as you type and opens one", async () => {
    renderRegisterWithHeader();
    await userEvent.keyboard("{Control>}k{/Control}");
    const dialog = screen.getByRole("dialog", { name: "Jump to" });
    const options = within(dialog).getAllByRole("option");
    expect(options.map((o) => o.querySelector("span")?.textContent)).toEqual(["New System", "=HYPERLINK(hub)", "Billing engine", "Jira", "Legacy CRM", "Okta"]);
    expect(options[3]).toHaveTextContent("Onboarded · Marcus Lindqvist");
    await userEvent.type(within(dialog).getByRole("combobox"), "okt");
    expect(within(dialog).getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/systems/s-okta");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens New System from the palette and closes on Escape", async () => {
    renderRegisterWithHeader();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/systems/new");
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not search on / while the palette is open", async () => {
    renderRegisterWithHeader();
    await userEvent.keyboard("{Control>}k{/Control}");
    // The palette's field has focus, so the keystroke is typing there, not the search shortcut.
    fireEvent.keyDown(within(screen.getByRole("dialog")).getByRole("combobox"), { key: "/" });
    expect(screen.getByRole("searchbox", { name: "Search Systems" })).not.toHaveFocus();
  });
});

describe("bulk Change owner (#233)", () => {
  const select = async (...names: string[]) => {
    for (const name of names) await userEvent.click(within(rowOf(name)).getByRole("checkbox"));
  };
  const bulk = () => screen.queryByRole("region", { name: "Bulk actions" });

  it("is offered when the acting user owns a selected System, and not otherwise", async () => {
    renderRegister();
    await select("Billing engine");
    expect(within(bulk()!).queryByRole("button", { name: "Change owner" })).not.toBeInTheDocument();
    await select("Jira");
    expect(within(bulk()!).getByRole("button", { name: "Change owner" })).toBeInTheDocument();
  });

  it("is offered to an Admin for any selection, and never to a read-only role that owns a row", async () => {
    const { unmount } = renderRegister({ role: "ADMIN", roleLabel: "Admin", userId: "u-admin" });
    await select("Billing engine");
    expect(within(bulk()!).getByRole("button", { name: "Change owner" })).toBeInTheDocument();
    unmount();

    renderRegister({ role: "COMPLIANCE_MANAGER", roleLabel: "Compliance Manager" });
    await select("Jira");
    expect(within(bulk()!).queryByRole("button", { name: "Change owner" })).not.toBeInTheDocument();
  });

  it("opens the picker flagging the Systems the user can't change", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ users: [] }), { status: 200 }))));
    renderRegister();
    await select("Jira", "Billing engine");
    await userEvent.click(within(bulk()!).getByRole("button", { name: "Change owner" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/can't change the owner of Billing engine/);
    vi.unstubAllGlobals();
  });
});
