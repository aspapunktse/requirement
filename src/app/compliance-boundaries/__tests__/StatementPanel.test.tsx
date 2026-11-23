import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoundaryStatement, BoundaryStatementRow } from "@/lib/boundary-statement-rules";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { StatementPanel } from "../[id]/StatementPanel";

const row = (over: Partial<BoundaryStatementRow> & { requirementId: string; code: string }): BoundaryStatementRow => ({
  section: "A",
  title: `Title of ${over.code}`,
  included: true,
  organizationStatus: null,
  organizationOnly: false,
  worstStatus: "MET",
  metCount: 2,
  appliesToCount: 2,
  systemStatuses: [[0, "MET"]],
  hiddenSystemCount: 1,
  justification: null,
  justificationMissing: false,
  ...over,
});

const statement = (over: Partial<BoundaryStatement> = {}): BoundaryStatement => ({
  boundary: { id: "b1", name: "ISMS scope", retired: false, ownerName: "Olle" },
  canEdit: true,
  countedSystems: [{ id: "s1", name: "Payroll" }, { id: "s2", name: "Hidden one" }],
  notYetOperating: [{ id: "s3", name: "New CRM" }],
  closed: [{ id: "s4", name: "Old ERP", status: "REJECTED" }],
  systems: [{ id: "s1", name: "Payroll" }],
  sections: [
    {
      framework: { id: "f1", name: "ISO 27001", version: "2022", isBase: true },
      met: 3,
      applicable: 4,
      percentage: 75,
      rows: [
        row({ requirementId: "r1", code: "A.5.1", worstStatus: "NOT_MET", metCount: 1 }),
        row({ requirementId: "r2", code: "A.5.2" }),
        row({ requirementId: "r3", code: "A.5.3", included: false, worstStatus: null, metCount: 0, appliesToCount: 0, systemStatuses: [], hiddenSystemCount: 0, justificationMissing: true }),
        row({ requirementId: "r4", code: "A.5.4", included: false, worstStatus: null, metCount: 0, appliesToCount: 0, systemStatuses: [], hiddenSystemCount: 0, justification: "Out of scope" }),
      ],
    },
  ],
  ...over,
});

describe("StatementPanel (#420)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    refresh.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the counted, not-yet-operating and closed Systems and one row per Requirement", () => {
    render(<StatementPanel statement={statement()} />);
    expect(screen.getByTestId("cb-st-systems")).toHaveTextContent("2 counted Systems");
    expect(screen.getByTestId("cb-st-systems")).toHaveTextContent("1 not yet operating, not counted: New CRM");
    expect(screen.getByTestId("cb-st-systems")).toHaveTextContent("1 closed, not counted: Old ERP");
    expect(screen.getByTestId("cb-st-row-r1")).toHaveTextContent("Not met");
    expect(screen.getByTestId("cb-st-row-r1")).toHaveTextContent("Met on 1 of 2 Systems");
    expect(screen.getByTestId("cb-st-row-r3")).toHaveTextContent("Missing");
    expect(screen.getByTestId("cb-st-row-r4")).toHaveTextContent("Out of scope");
  });

  it("filters with the chips and the search", async () => {
    const user = userEvent.setup();
    render(<StatementPanel statement={statement()} />);
    await user.click(screen.getByRole("button", { name: /^Excluded/ }));
    expect(screen.queryByTestId("cb-st-row-r1")).toBeNull();
    expect(screen.getByTestId("cb-st-row-r3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Missing justification/ }));
    expect(screen.queryByTestId("cb-st-row-r4")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Not met/ }));
    expect(screen.getByTestId("cb-st-row-r1")).toBeInTheDocument();
    expect(screen.queryByTestId("cb-st-row-r2")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^All/ }));
    await user.type(screen.getByLabelText("Search Requirements"), "a.5.2");
    expect(screen.getByTestId("cb-st-row-r2")).toBeInTheDocument();
    expect(screen.queryByTestId("cb-st-row-r1")).toBeNull();
  });

  it("drills down to the visible Systems and says how many are hidden", async () => {
    const user = userEvent.setup();
    render(<StatementPanel statement={statement()} />);
    await user.click(within(screen.getByTestId("cb-st-row-r2")).getByRole("button"));
    expect(screen.getByRole("link", { name: "Payroll" })).toHaveAttribute("href", "/systems/s1");
    expect(screen.getByText(/1 more counted System is not visible to you/)).toBeInTheDocument();
  });

  it("saves a justification for an excluded row through the API and refreshes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ justification: "Because" }), { status: 200 }));
    const user = userEvent.setup();
    render(<StatementPanel statement={statement()} />);
    await user.click(within(screen.getByTestId("cb-st-row-r3")).getByRole("button"));
    await user.type(screen.getByLabelText("Exclusion justification"), "Because");
    await user.click(screen.getByRole("button", { name: "Save justification" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/compliance-boundaries/b1/statement/justifications/r3", expect.objectContaining({ method: "PUT", body: JSON.stringify({ text: "Because" }) }));
  });

  it("shows the API's error and does not refresh when the save is refused", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Retired" }), { status: 409 }));
    const user = userEvent.setup();
    render(<StatementPanel statement={statement()} />);
    await user.click(within(screen.getByTestId("cb-st-row-r3")).getByRole("button"));
    await user.type(screen.getByLabelText("Exclusion justification"), "x");
    await user.click(screen.getByRole("button", { name: "Save justification" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retired");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers no editor to someone who cannot write", async () => {
    const user = userEvent.setup();
    render(<StatementPanel statement={statement({ canEdit: false })} />);
    await user.click(within(screen.getByTestId("cb-st-row-r3")).getByRole("button"));
    expect(screen.queryByLabelText("Exclusion justification")).toBeNull();
    expect(screen.getByText(/Only the Boundary Owner, a Compliance Manager or an Admin/)).toBeInTheDocument();
  });

  it("says a retired Boundary has no statement", () => {
    render(<StatementPanel statement={statement({ boundary: { id: "b1", name: "Old", retired: true, ownerName: null }, sections: [], canEdit: false })} />);
    expect(screen.getByText(/retired Compliance Boundary has no Statement of Applicability/)).toBeInTheDocument();
  });
});
