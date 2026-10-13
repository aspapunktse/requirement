import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationRiskList } from "../OrganizationRiskList";
import type { Risk } from "../RiskList";

const risk: Risk = {
  id: "r1",
  title: "A.5.1: Policies (Internal Audit Nonconformity)",
  description: "Found wanting",
  severity: "MEDIUM",
  likelihood: "MEDIUM",
  status: "OPEN",
  mitigationPlan: null,
  ownerId: null,
  owner: null,
  controlAssessment: null,
  checkUp: { id: "c1" },
};
const owners = [{ id: "u1", name: "Rita Risk" }];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrganizationRiskList (#157)", () => {
  it("saves status, mitigation plan and owner to /api/risks/[id] and shows the saved Risk", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ risk: { ...risk, status: "MITIGATED", mitigationPlan: "Rewrite", ownerId: "u1", owner: { id: "u1", name: "Rita Risk" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OrganizationRiskList initialRisks={[risk]} canManage canOpenCheckUp owners={owners} />);

    expect(screen.getByRole("link", { name: "see the finding" })).toHaveAttribute("href", "/check-ups/c1");
    await user.selectOptions(screen.getByLabelText(`Status for ${risk.title}`), "MITIGATED");
    await user.type(screen.getByLabelText(`Mitigation plan for ${risk.title}`), "Rewrite");
    await user.selectOptions(screen.getByLabelText(`Owner for ${risk.title}`), "u1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/risks/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "MITIGATED", mitigationPlan: "Rewrite", ownerId: "u1" });
    expect(await screen.findByText("Owner: Rita Risk")).toBeInTheDocument();
  });

  it("is read-only without canManage, and links the finding only to those who may open it", () => {
    render(<OrganizationRiskList initialRisks={[risk]} canManage={false} canOpenCheckUp={false} owners={owners} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("link", { name: "see the finding" })).toBeNull();
    expect(screen.getByText(/Opened by an Internal Audit Nonconformity/)).toBeInTheDocument();
  });

  it("says so when there are none", () => {
    render(<OrganizationRiskList initialRisks={[]} canManage canOpenCheckUp owners={owners} />);
    expect(screen.getByText(/No Organization Risks/)).toBeInTheDocument();
  });
});
