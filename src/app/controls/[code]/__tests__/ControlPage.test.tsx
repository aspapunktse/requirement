import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryRow, mapping } from "../../__tests__/fixtures";
import { ControlPage } from "../ControlPage";
import type { ControlPageView, PageSystem } from "../control-page-types";

const system = (id: string, over: Partial<PageSystem> = {}): PageSystem => ({
  id,
  name: `System ${id}`,
  ownerName: "Olive Owner",
  businessUnits: ["Finance"],
  status: "NOT_STARTED",
  sourceLabel: "System-specific",
  sourceDetails: [],
  note: null,
  ...over,
});

const COUNTS = { NOT_STARTED: 1, IN_PROGRESS: 0, FULFILLED: 2, WAIVED: 0, NOT_APPLICABLE: 0 };

function bothView(over: Partial<ControlPageView> = {}): ControlPageView {
  return {
    userId: "u1",
    userName: "Olive Owner",
    canEdit: false,
    control: libraryRow("A.5.3", {
      applicability: "BOTH",
      question: "Do you segregate duties?",
      intent: "Prevent fraud",
      examples: ["Two approvers"],
      ownerId: "o1",
      ownerName: "Pat Peer",
      orgStatus: "FULFILLED",
      systemCount: 3,
      mappings: [mapping("R-1", "FULL"), mapping("R-2", "PARTIAL")],
    }),
    organization: { status: "FULFILLED", description: "Done centrally.", updatedOn: "5 Nov 2026", updatedByName: "Pat Peer" },
    systems: {
      total: 3,
      counts: COUNTS,
      list: [
        system("a", { name: "Alpha", status: "FULFILLED", sourceLabel: "Inherited from Organization" }),
        system("b", { name: "Beta", ownerName: "Quinn", businessUnits: ["Ops"], sourceLabel: "Inherited from Provider Landing Zone: Shared", sourceDetails: ['Provider "Landing Zone" (Shared): Fulfilled'] }),
      ],
    },
    ...over,
  };
}

beforeEach(() => window.history.replaceState(null, "", "/controls/A.5.3"));
afterEach(cleanup);

describe("ControlPage (#314)", () => {
  it("shows the header, the chips and the Control tab first", () => {
    render(<ControlPage view={bothView()} initialTab={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title of A.5.3" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Control Library" })).toHaveAttribute("href", "/controls");
    expect(screen.getAllByText("Both").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "The Control" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Do you segregate duties?")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Examples for A.5.3" })).toBeInTheDocument();
  });

  it("offers Edit only to those who can edit, keeping the tab", async () => {
    const { unmount } = render(<ControlPage view={bothView()} initialTab={null} />);
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
    unmount();
    render(<ControlPage view={bothView({ canEdit: true })} initialTab="systems" />);
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", "/controls/A.5.3/edit?tab=systems");
  });

  it("has a tab per section, only the ones this Control has", () => {
    const { unmount } = render(<ControlPage view={bothView()} initialTab={null} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["The Control", "Satisfies2", "Organization implementation", "Systems3"]);
    unmount();
    const org = bothView({ systems: null, control: libraryRow("A.5.1") });
    render(<ControlPage view={org} initialTab={null} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["The Control", "Satisfies1", "Organization implementation"]);
    cleanup();
    render(<ControlPage view={bothView({ organization: null, control: libraryRow("A.8.1", { applicability: "PER_SYSTEM", orgStatus: null }) })} initialTab={null} />);
    expect(screen.queryByRole("tab", { name: /Organization implementation/ })).not.toBeInTheDocument();
  });

  it("opens the tab ?tab= names, falls back to the first for a tab it lacks, and writes the open tab to the URL", async () => {
    const { unmount } = render(<ControlPage view={bothView()} initialTab="implementation" />);
    expect(screen.getByRole("tab", { name: /Organization implementation/ })).toHaveAttribute("aria-selected", "true");
    unmount();
    render(<ControlPage view={bothView({ systems: null })} initialTab="systems" />);
    expect(screen.getByRole("tab", { name: "The Control" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /Satisfies/ }));
    expect(window.location.search).toBe("?tab=satisfies");
  });

  it("moves between tabs with the arrow keys, Home and End", async () => {
    render(<ControlPage view={bothView()} initialTab={null} />);
    const tabs = screen.getAllByRole("tab");
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1], { key: "End" });
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs[3], { key: "ArrowRight" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(tabs[3]).toHaveAttribute("aria-selected", "true");
    expect(tabs[3]).toHaveAttribute("tabindex", "0");
    expect(tabs[0]).toHaveAttribute("tabindex", "-1");
  });

  it("opens a tab from the rail's counts", async () => {
    render(<ControlPage view={bothView()} initialTab={null} />);
    const rail = within(screen.getByRole("complementary", { name: "Summary of A.5.3" }));
    expect(rail.getByText("Pat Peer")).toBeInTheDocument();
    expect(rail.getByText("1 Framework · 1 Full · 1 Partial")).toBeInTheDocument();
    expect(rail.getByText("You can see 2 of 3")).toBeInTheDocument();
    await userEvent.click(rail.getByRole("button", { name: /Systems/ }));
    expect(screen.getByRole("tab", { name: /Systems/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveFocus();
    await userEvent.click(rail.getByRole("button", { name: /Requirements/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Satisfies" })).toBeInTheDocument();
  });

  it("groups the Requirements by Framework with their Coverage, or says it is not mapped", () => {
    const { unmount } = render(<ControlPage view={bothView()} initialTab="satisfies" />);
    expect(screen.getByRole("list", { name: "Requirements in ISO/IEC 27001:2022" })).toBeInTheDocument();
    expect(screen.getByText("Full")).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
    unmount();
    render(<ControlPage view={bothView({ control: libraryRow("A.5.3", { applicability: "BOTH", mappings: [] }) })} initialTab="satisfies" />);
    expect(screen.getAllByText("Not mapped to any Requirement").length).toBeGreaterThan(0);
  });

  it("marks a Draft Framework, and a Supplementary Control with a hidden origin reads as plain Supplementary", () => {
    const view = bothView({
      control: libraryRow("CCM-2", {
        applicability: "BOTH",
        source: { key: "sup", label: "Supplementary", kind: "supplementary", draft: false },
        mappings: [mapping("D-1", "FULL", { framework: { id: "fw-d", label: "Draft Framework 1" }, draft: true })],
      }),
    });
    render(<ControlPage view={view} initialTab="satisfies" />);
    expect(screen.getByText("Supplementary")).toBeInTheDocument();
    expect(screen.getAllByText("Draft Framework").length).toBeGreaterThan(0);
  });

  it("shows a Both Control's status without a count of inheriting Systems", () => {
    render(<ControlPage view={bothView()} initialTab="implementation" />);
    expect(screen.getByText("Done centrally.")).toBeInTheDocument();
    expect(screen.getByText("5 Nov 2026 by Pat Peer")).toBeInTheDocument();
    expect(screen.getByText(/passes this status on to every System/)).toBeInTheDocument();
    expect(screen.queryByText(/inherit/i)).not.toBeInTheDocument();
  });

  it("lists the visible Systems with status and source, links them to the Control on the System page, and searches", async () => {
    render(<ControlPage view={bothView()} initialTab="systems" />);
    expect(screen.getByRole("note")).toHaveTextContent("You can see 2 of them");
    const list = within(screen.getByRole("list", { name: "Systems" }));
    expect(list.getByRole("link", { name: /Alpha/ })).toHaveAttribute("href", "/systems/a#controls/A.5.3");
    expect(list.getByText("Inherited from Organization")).toBeInTheDocument();
    expect(list.getByText(/Inherited from Provider Landing Zone: Shared/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /All 3 Systems by effective status: 1 Not started, 2 Fulfilled/i })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search the listed Systems" }), "ops");
    expect(screen.getByText("1 of 2 listed Systems")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Alpha/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText("No listed System matches.")).toBeInTheDocument();
  });

  it("says when none of the Systems is visible, and when the Control applies to none", () => {
    const hidden = bothView();
    hidden.systems = { total: 3, counts: COUNTS, list: [] };
    const { unmount } = render(<ControlPage view={hidden} initialTab="systems" />);
    expect(screen.getByText("None of the Systems this Control applies to is visible to you.")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("so none are listed");
    unmount();
    const none = bothView();
    none.systems = { total: 0, counts: { ...COUNTS, NOT_STARTED: 0, FULFILLED: 0 }, list: [] };
    render(<ControlPage view={none} initialTab="systems" />);
    expect(screen.getByText(/applies to none today/)).toBeInTheDocument();
  });
});
