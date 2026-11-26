import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizationRiskList } from "../OrganizationRiskList";
import type { Risk } from "../RiskList";

const risk: Risk = {
  id: "r1",
  title: "Unpatched server",
  description: "Found wanting",
  severity: "MEDIUM",
  likelihood: "MEDIUM",
  status: "OPEN",
  source: "AD_HOC",
  mitigationPlan: null,
  ownerId: null,
  owner: null,
  controlAssessment: null,
  checkUp: { id: "c1" },
  deadline: "2027-03-31",
  milestones: [
    { id: "m1", title: "Order the patch", plannedDate: "2027-01-15", completedDate: null },
    { id: "m2", title: "Test the patch", plannedDate: "2027-02-15", completedDate: "2027-02-10" },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Risk deadline and remediation milestones (#456)", () => {
  it("shows the deadline and the milestones to someone who may only read", () => {
    render(<OrganizationRiskList initialRisks={[risk]} canManage={false} canOpenCheckUp owners={[]} />);
    expect(screen.getByText("Deadline: 2027-03-31")).toBeInTheDocument();
    expect(screen.getByText("Order the patch")).toBeInTheDocument();
    expect(screen.getByText("completed 2027-02-10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete milestone/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`New milestone for ${risk.title}`)).not.toBeInTheDocument();
  });

  it("adds a milestone, marks one completed on the chosen date, and can delete only one that is not completed", async () => {
    const after = { ...risk, milestones: [...risk.milestones!, { id: "m3", title: "Restart", plannedDate: "2027-04-01", completedDate: null }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ risk: after }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OrganizationRiskList initialRisks={[risk]} canManage canOpenCheckUp owners={[]} />);

    expect(screen.queryByRole("button", { name: "Delete milestone Test the patch" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(`New milestone for ${risk.title}`), "Restart");
    fireEvent.change(screen.getByLabelText(`Planned date of the new milestone for ${risk.title}`), { target: { value: "2027-04-01" } });
    await user.click(screen.getByRole("button", { name: "Add milestone" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/risks/r1/milestones");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Restart", plannedDate: "2027-04-01" });
    expect(await screen.findByText("Restart")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(`Completion date for ${risk.title}`), { target: { value: "2026-11-20" } });
    await user.click(screen.getByRole("button", { name: "Mark Order the patch completed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [doneUrl, doneInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(doneUrl).toBe("/api/risks/r1/milestones/m1");
    expect(doneInit.method).toBe("PATCH");
    expect(JSON.parse(doneInit.body as string)).toEqual({ completedDate: "2026-11-20" });

    await user.click(screen.getByRole("button", { name: "Delete milestone Order the patch" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("sends the deadline with the status form only when it changed, and clears it with null", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ risk: { ...risk, deadline: null } }) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OrganizationRiskList initialRisks={[risk]} canManage canOpenCheckUp owners={[]} />);
    fireEvent.change(screen.getByLabelText(`Deadline for ${risk.title}`), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)).toEqual({ status: "OPEN", mitigationPlan: null, deadline: null });
  });

  it("shows the server's refusal and keeps the milestones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "A completed milestone can't be deleted" }) }));
    const user = userEvent.setup();
    render(<OrganizationRiskList initialRisks={[risk]} canManage canOpenCheckUp owners={[]} />);
    await user.click(screen.getByRole("button", { name: "Delete milestone Order the patch" }));
    expect(await screen.findByText("A completed milestone can't be deleted")).toBeInTheDocument();
    expect(screen.getByText("Order the patch")).toBeInTheDocument();
  });
});
