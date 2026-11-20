import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { countCheckUpStates, emptyCheckUpFindings, sumCheckUpStateCounts, type CheckUpStateCounts } from "@/lib/check-up-states";
import type { InternalAuditList, InternalAuditListItem } from "@/lib/internal-audit-list";
import { AuditsCommandCenter } from "../AuditsCommandCenter";

const base = {
  scopeDescription: "",
  includeOrganization: false,
  controlCount: 2,
  systemCount: 3,
  progress: null,
  plan: null,
  findings: null,
  closedAt: null,
  closedBy: null,
};

function launched(id: string, title: string, progress: CheckUpStateCounts, daysUntilDue: number, scopeDescription = ""): InternalAuditListItem {
  return { ...base, id, title, scopeDescription, status: "LAUNCHED", dueDate: "2026-12-01", daysUntilDue, progress };
}

const accessProgress = countCheckUpStates(["evaluated", "evaluated", "awaiting", "awaiting", "overdue", "notAnswered"]);
const logsProgress = countCheckUpStates(["evaluated", "withdrawn"]);
const audits: InternalAuditListItem[] = [
  launched("a1", "Access control audit", accessProgress, -3, "Identities and privileged access"),
  launched("a2", "Logging audit", logsProgress, 5, "Logs on cloud platforms"),
  { ...base, id: "d1", title: "Draft crypto", status: "DRAFT", dueDate: "2027-01-31", daysUntilDue: 73, includeOrganization: true, plan: { checkUpCount: 7, firstBlocker: null } },
  { ...base, id: "d2", title: "Draft blocked", status: "DRAFT", dueDate: "2027-02-10", daysUntilDue: 83, plan: { checkUpCount: 0, firstBlocker: "Pick at least one Control" } },
  {
    ...base,
    id: "c1",
    title: "Physical security",
    status: "CLOSED",
    dueDate: "2026-09-01",
    daysUntilDue: -79,
    findings: { ...emptyCheckUpFindings(), CONFORMING: 5, OBSERVATION: 2, NONCONFORMITY: 1, risksOpened: 1 },
    closedAt: "2026-09-10",
    closedBy: "Eva Nystrom",
  },
];
const list: InternalAuditList = { audits, totals: sumCheckUpStateCounts([accessProgress, logsProgress]) };

const lane = (name: string) => screen.queryByRole("region", { name });
const cards = (name: string) => within(lane(name)!).getAllByRole("link");

describe("AuditsCommandCenter (#398)", () => {
  it("shows the ring's centre as the open Check-ups and the counts by state", () => {
    render(<AuditsCommandCenter list={list} canWrite />);
    // Open: awaiting 2 + overdue 1 + not answered 1.
    expect(screen.getByRole("img", { name: "4 of 8 Check-ups in launched audits are open" })).toBeInTheDocument();
    const legend = within(screen.getByRole("list", { name: "Check-ups in launched audits by state" }));
    expect(legend.getByText(/awaiting evaluation/).closest("li")).toHaveTextContent("2");
    expect(legend.getByText(/overdue/).closest("li")).toHaveTextContent("1");
    expect(legend.getByText(/withdrawn/).closest("li")).toHaveTextContent("1");
  });

  it("puts the audits in lanes with a count, each card linking to its audit", () => {
    render(<AuditsCommandCenter list={list} canWrite />);
    expect(cards("Launched").map((a) => a.getAttribute("href"))).toEqual(["/internal-audits/a1", "/internal-audits/a2"]);
    expect(within(lane("Launched")!).getByRole("heading", { level: 2 })).toHaveTextContent("Launched 2");
    expect(cards("Drafts")).toHaveLength(2);
    expect(cards("Closed")).toHaveLength(1);
  });

  it("shows a launched card's progress, due line and what is left", () => {
    render(<AuditsCommandCenter list={list} canWrite />);
    const [overdue, soon] = cards("Launched");
    expect(overdue).toHaveTextContent("2 of 6 evaluated");
    expect(overdue).toHaveTextContent("2 awaiting evaluation");
    expect(overdue).toHaveTextContent("1 overdue");
    expect(overdue).toHaveTextContent("3 days overdue");
    expect(overdue).toHaveTextContent("4 open");
    expect(within(overdue).getByText("3 days overdue")).toHaveClass("late");
    expect(soon).toHaveTextContent("Due in 5 days");
    expect(within(soon).getByText("Due in 5 days")).toHaveClass("soon");
    expect(soon).toHaveTextContent("Ready to close");
    expect(soon).not.toHaveTextContent("overdue");
  });

  it("shows a draft's counts, what launching would send and its first blocker or Ready to launch", () => {
    render(<AuditsCommandCenter list={list} canWrite />);
    const [ready, blocked] = cards("Drafts");
    expect(ready).toHaveTextContent("2 Controls");
    expect(ready).toHaveTextContent("3 Systems + Organization");
    expect(ready).toHaveTextContent("would send 7 Check-ups");
    expect(ready).toHaveTextContent("Ready to launch");
    expect(blocked).toHaveTextContent("Pick at least one Control");
    expect(blocked).not.toHaveTextContent("Ready to launch");
  });

  it("shows a closed card's findings, Risks opened, closed date and who closed it", () => {
    render(<AuditsCommandCenter list={list} canWrite />);
    const [closed] = cards("Closed");
    expect(closed).toHaveTextContent("5 Conforming");
    expect(closed).toHaveTextContent("2 Observation");
    expect(closed).toHaveTextContent("1 Nonconformity");
    expect(closed).toHaveTextContent("1 Risk opened");
    expect(closed).toHaveTextContent("Closed 2026-09-10 by Eva Nystrom");
  });

  it("filters with a stat card, clears with a second click and with Clear filter", async () => {
    const user = userEvent.setup();
    render(<AuditsCommandCenter list={list} canWrite />);
    const awaiting = screen.getByRole("button", { name: /Awaiting evaluation/ });
    expect(awaiting).toHaveTextContent("2");
    await user.click(awaiting);
    expect(awaiting).toHaveAttribute("aria-pressed", "true");
    expect(cards("Launched")).toHaveLength(1);
    expect(lane("Drafts")).toBeNull();
    expect(lane("Closed")).toBeNull();

    await user.click(awaiting);
    expect(awaiting).toHaveAttribute("aria-pressed", "false");
    expect(lane("Drafts")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Overdue Check-ups/ }));
    expect(cards("Launched").map((a) => a.getAttribute("href"))).toEqual(["/internal-audits/a1"]);
    await user.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(cards("Launched")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Clear filter" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Drafts/ }));
    expect(lane("Launched")).toBeNull();
    expect(cards("Drafts")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /Closed/ }));
    expect(cards("Closed")).toHaveLength(1);
    expect(lane("Drafts")).toBeNull();
  });

  it("searches by title or scope, and / focuses the search", async () => {
    const user = userEvent.setup();
    render(<AuditsCommandCenter list={list} canWrite />);
    await user.keyboard("/");
    const search = screen.getByRole("searchbox", { name: "Search audits" });
    expect(search).toHaveFocus();
    await user.type(search, "cloud platforms");
    expect(cards("Launched").map((a) => a.getAttribute("href"))).toEqual(["/internal-audits/a2"]);
    expect(lane("Drafts")).toBeNull();
    await user.clear(search);
    await user.type(search, "crypto");
    expect(cards("Drafts").map((a) => a.getAttribute("href"))).toEqual(["/internal-audits/d1"]);
    expect(lane("Launched")).toBeNull();
  });

  it("says nothing matches, with a way out", async () => {
    const user = userEvent.setup();
    render(<AuditsCommandCenter list={list} canWrite />);
    await user.type(screen.getByRole("searchbox", { name: "Search audits" }), "zzz");
    expect(screen.getByRole("heading", { name: "No audit matches" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filter and search" }));
    expect(cards("Launched")).toHaveLength(2);
  });

  it("says there are no Internal Audits yet, offering a new one only to the Internal Auditor", () => {
    const empty: InternalAuditList = { audits: [], totals: sumCheckUpStateCounts([]) };
    const { unmount } = render(<AuditsCommandCenter list={empty} canWrite />);
    expect(screen.getByRole("heading", { name: "There are no Internal Audits yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "+ New Internal Audit" })).toHaveLength(2);
    unmount();
    render(<AuditsCommandCenter list={empty} canWrite={false} />);
    expect(screen.getByRole("heading", { name: "There are no Internal Audits yet" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New Internal Audit/ })).toBeNull();
  });

  it("offers + New Internal Audit to the Internal Auditor only; others get a read-only note", () => {
    const { unmount } = render(<AuditsCommandCenter list={list} canWrite />);
    expect(screen.getByRole("link", { name: "+ New Internal Audit" })).toHaveAttribute("href", "/internal-audits/new");
    unmount();
    render(<AuditsCommandCenter list={list} canWrite={false} />);
    expect(screen.queryByRole("link", { name: /New Internal Audit/ })).toBeNull();
    expect(screen.getByText(/only an Internal Auditor plans and runs them/)).toBeInTheDocument();
  });
});
