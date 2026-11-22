import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditCommandCenter, type AuditRights } from "../AuditCommandCenter";
import type { AuditCheckUp, InternalAuditPage } from "@/lib/internal-audit-detail";
import type { CheckUpStateKey } from "@/lib/check-up-states";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

const mockFetch = (status: number, body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

function checkUp(id: string, state: CheckUpStateKey, code: string, system: string | null, extra: Partial<AuditCheckUp> = {}): AuditCheckUp {
  const answered = state !== "notAnswered" && state !== "overdue";
  return {
    id,
    control: { id: `c-${code}`, code, title: `Control ${code}` },
    target: system ? { kind: "system", id: `s-${system}`, name: system } : { kind: "organization" },
    recipient: { id: "u1", name: "Ana Owner" },
    state,
    questions: [{ id: `q-${id}`, position: 1, text: `Is ${code} in place?`, answer: answered ? { answer: "YES", description: "" } : null }],
    response: answered ? { respondedAt: "2026-11-02T10:00:00.000Z", respondedByName: "Ana Owner", evidenceLinks: [] } : null,
    evaluation: null,
    withdrawal: null,
    risk: null,
    ...extra,
  };
}

const rows = [
  checkUp("c1", "notAnswered", "A.1", "Payroll"),
  checkUp("c2", "awaiting", "A.2", "Payroll"),
  checkUp("c3", "evaluated", "A.3", "Wiki", {
    evaluation: { outcome: "CONFORMING", comment: "All fine", evaluatedByName: "Ida Auditor", evaluatedAt: "2026-11-03T10:00:00.000Z" },
  }),
  checkUp("c4", "withdrawn", "A.4", null, { withdrawal: { reason: "No longer applies", withdrawnByName: "Ida Auditor", withdrawnAt: "2026-11-03T10:00:00.000Z" } }),
];

function pageOf(checkUps: AuditCheckUp[], status: "LAUNCHED" | "CLOSED" = "LAUNCHED"): InternalAuditPage {
  const counts = { evaluated: 0, withdrawn: 0, awaiting: 0, overdue: 0, notAnswered: 0, total: 0, open: 0 };
  for (const c of checkUps) {
    counts[c.state] += 1;
    counts.total += 1;
    if (c.state !== "evaluated" && c.state !== "withdrawn") counts.open += 1;
  }
  return {
    audit: {
      id: "a1",
      title: "Q4 audit",
      scopeDescription: "Two Systems",
      dueDate: "2026-12-20",
      status,
      includeOrganization: true,
      createdBy: { id: "u9", name: "Ida Auditor" },
      createdAt: "2026-11-01T10:00:00.000Z",
      updatedAt: "2026-11-01T10:00:00.000Z",
      launchedAt: "2026-11-01T11:00:00.000Z",
      launchedBy: { id: "u9", name: "Ida Auditor" },
      closedAt: status === "CLOSED" ? "2026-11-10T11:00:00.000Z" : null,
      closedBy: status === "CLOSED" ? { id: "u9", name: "Ida Auditor" } : null,
      controls: [],
      systems: [],
    },
    daysUntilDue: 30,
    checkUps,
    counts,
    findings: status === "CLOSED" ? { CONFORMING: 3, OBSERVATION: 2, NONCONFORMITY: 1, risksOpened: 1 } : null,
    plan: null,
    auditQuestions: {},
  };
}

/** The row of a Check-up in the By Control tab: its group is named after the Control. */
const row = (code: string) => within(screen.getByRole("group", { name: `${code} Control ${code}` })).getByRole("button");

const all: AuditRights = { canEvaluate: true, canWithdraw: true, canClose: true };
const none: AuditRights = { canEvaluate: false, canWithdraw: false, canClose: false };

describe("AuditCommandCenter (#399)", () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the ring legend and a close banner naming how many are open, with Close disabled", () => {
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    const legend = screen.getByRole("list", { name: "Check-ups by state" });
    expect(legend.textContent).toContain("1 evaluated");
    expect(screen.getByRole("region", { name: "Close this Internal Audit" }).textContent).toContain("2 Check-ups");
    expect((screen.getByRole("button", { name: "Close audit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says Ready to close, with Close enabled, when every Check-up is done", () => {
    render(<AuditCommandCenter page={pageOf([rows[2], rows[3]])} rights={all} />);
    expect(screen.getByText("Ready to close")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Close audit" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("filters with a stat card, shows Clear filter and an empty state, and clears", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    const card = screen.getByRole("button", { name: /^Evaluated/ });
    await user.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(row("A.3")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "A.1 Control A.1" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();
    expect(row("A.1")).toBeTruthy();

    // Overdue has none in this audit.
    await user.click(screen.getByRole("button", { name: /^Overdue/ }));
    expect(screen.getByText("No Check-up matches")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Clear filter" })[0]);
    expect(screen.queryByText("No Check-up matches")).toBeNull();
  });

  it("switches tabs with a group count each, and shows done of total per group", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    expect(screen.getByRole("tab", { name: /By Control/ }).textContent).toContain("4");
    expect(screen.getByRole("tab", { name: /By System/ }).textContent).toContain("3");
    await user.click(screen.getByRole("tab", { name: /By System/ }));
    expect(screen.getByRole("group", { name: "Payroll" }).textContent).toContain("0 of 2 done");
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Payroll", "Wiki", "Organization"]);
    await user.click(screen.getByRole("tab", { name: /By recipient/ }));
    expect(screen.getByRole("group", { name: "Ana Owner" })).toBeTruthy();
  });

  it("opens the panel on the first open Check-up and picks another on click", async () => {
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    const panel = screen.getByRole("complementary", { name: "Check-up" });
    expect(panel.textContent).toContain("Is A.1 in place?");
    await user.click(row("A.4"));
    expect(within(panel).getByText(/No longer applies/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Withdraw…" })).toBeNull();
    await user.click(row("A.3"));
    expect(panel.textContent).toContain("All fine");
    expect(within(panel).getAllByRole("link").some((a) => a.getAttribute("href") === "/check-ups/c3")).toBe(true);
  });

  it("evaluates an awaiting Check-up through the existing route, then refreshes", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    await user.click(row("A.2"));
    await user.click(screen.getByLabelText("Conforming"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[0][0]).toBe("/api/check-ups/c2/evaluation");
    expect(JSON.parse(calls()[0][1].body as string)).toMatchObject({ outcome: "CONFORMING" });
  });

  it("shows a refused evaluation and does not refresh", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: "Already evaluated" }));
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    await user.click(row("A.2"));
    await user.click(screen.getByLabelText("Conforming"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Already evaluated");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("withdraws an open Check-up with a reason through the existing route, then refreshes", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    const user = userEvent.setup({ delay: null });
    render(<AuditCommandCenter page={pageOf(rows)} rights={all} />);
    await user.click(screen.getByRole("button", { name: "Withdraw…" }));
    await user.type(screen.getByLabelText("Reason"), "Not in scope");
    await user.click(screen.getByRole("button", { name: "Withdraw Check-up" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[0][0]).toBe("/api/check-ups/c1/withdrawal");
    expect(JSON.parse(calls()[0][1].body as string)).toEqual({ reason: "Not in scope" });
  });

  it("offers a role without the rights no Close, Withdraw or evaluation", () => {
    render(<AuditCommandCenter page={pageOf(rows)} rights={none} />);
    expect(screen.queryByRole("button", { name: "Close audit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record evaluation" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Check-up" }).textContent).toContain("read only for your role");
  });

  it("can evaluate without being able to withdraw, and the reverse", async () => {
    const user = userEvent.setup({ delay: null });
    const first = render(<AuditCommandCenter page={pageOf(rows)} rights={{ canEvaluate: true, canWithdraw: false, canClose: false }} />);
    await user.click(row("A.2"));
    expect(screen.getByRole("button", { name: "Record evaluation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw…" })).toBeNull();
    first.unmount();
    render(<AuditCommandCenter page={pageOf(rows)} rights={{ canEvaluate: false, canWithdraw: true, canClose: false }} />);
    await user.click(row("A.2"));
    expect(screen.queryByRole("button", { name: "Record evaluation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw…" })).toBeTruthy();
  });

  it("shows a closed audit's findings, no banner, and no action controls even with every right", () => {
    render(<AuditCommandCenter page={pageOf([rows[2], rows[3]], "CLOSED")} rights={all} />);
    const findings = screen.getByRole("region", { name: "Findings" });
    expect(findings.textContent).toContain("Conforming3");
    expect(findings.textContent).toContain("Observation2");
    expect(findings.textContent).toContain("Nonconformity1");
    expect(findings.textContent).toContain("Risks opened1");
    expect(findings.textContent).toContain("2026-11-10");
    expect(screen.queryByRole("region", { name: "Close this Internal Audit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close audit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record evaluation" })).toBeNull();
  });
});
