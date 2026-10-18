import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "../ApprovalPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

function stubApprovals(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));
}

const approval = (id: string, decision: "APPROVED" | "REJECTED", comment: string, stepName = "Base review") => ({
  id,
  decision,
  comment,
  decidedAt: "2026-03-02T09:30:00.000Z",
  reviewGroupId: null,
  stepName,
  approver: { id: "u1", name: "Rita Reviewer" },
});

describe("ApprovalPanel (#198)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the current round's steps with their state, and the history grouped by round, newest first", async () => {
    stubApprovals({
      steps: [
        { reviewGroupId: null, name: "Base review", status: "APPROVED" },
        { reviewGroupId: "g1", name: "GDPR Review Group", status: "OPEN" },
        { reviewGroupId: "g2", name: "NIS2 Review Group", status: "REJECTED" },
      ],
      rounds: [
        { id: "r2", submittedAt: "2026-03-01T08:00:00.000Z", current: true, approvals: [approval("a2", "APPROVED", "Second pass")] },
        { id: "r1", submittedAt: "2026-01-10T08:00:00.000Z", current: false, approvals: [approval("a1", "REJECTED", "First pass")] },
      ],
    });
    render(<ApprovalPanel systemId="s1" canDecide={false} />);

    const steps = within(await screen.findByRole("region", { name: "Review Steps" }));
    const rows = steps.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["Base reviewApproved", "GDPR Review GroupOpen", "NIS2 Review GroupRejected"]);

    const rounds = screen.getAllByRole("region", { name: /^Review Round submitted/ });
    expect(rounds).toHaveLength(2);
    expect(within(rounds[0]).getByText(/\(current round\)/)).toBeTruthy();
    expect(within(rounds[0]).getByText("Second pass")).toBeTruthy();
    expect(within(rounds[0]).queryByText("First pass")).toBeNull();
    expect(within(rounds[1]).getByText("First pass")).toBeTruthy();
    expect(within(rounds[1]).getByText("by Rita Reviewer")).toBeTruthy();
    expect(within(rounds[1]).queryByText(/current round/)).toBeNull();
  });

  it("shows no steps section when the System isn't In Review, and says so when nothing was ever decided", async () => {
    stubApprovals({ steps: [], rounds: [] });
    render(<ApprovalPanel systemId="s1" canDecide={false} />);

    expect(await screen.findByText("No Approval decisions recorded yet.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Review Steps" })).toBeNull();
  });

  it("shows an open round with no decisions yet", async () => {
    stubApprovals({
      steps: [{ reviewGroupId: null, name: "Base review", status: "OPEN" }],
      rounds: [{ id: "r1", submittedAt: "2026-03-01T08:00:00.000Z", current: true, approvals: [] }],
    });
    render(<ApprovalPanel systemId="s1" canDecide={false} />);

    expect(await screen.findByText("No decisions yet.")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });
});
