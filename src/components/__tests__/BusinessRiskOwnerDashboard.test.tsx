import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessRiskOwnerDashboard } from "../BusinessRiskOwnerDashboard";

const iso = { id: "iso", name: "ISO/IEC 27001", version: "2022" };
const nis2 = { id: "nis2", name: "NIS2", version: "2022" };

const complianceFor = (framework: typeof iso, isBase: boolean) => ({
  framework: { ...framework, isBase },
  met: 6,
  applicable: 9,
  percentage: 66.7,
  bySystem: [
    { systemId: "s1", systemName: "Jira", met: 5, applicable: 6, percentage: 83.3 },
    { systemId: "s2", systemName: "CATIA", met: 1, applicable: 3, percentage: 33.3 },
    { systemId: "s3", systemName: "Unily", met: 0, applicable: 0, percentage: null },
  ],
});

const portfolio = [
  { id: "s1", name: "Jira", vendor: null, status: "ONBOARDED", compliancePercentage: 83.3, requirementsMet: 5, requirementsApplicable: 6, openRiskCount: 0 },
  { id: "s3", name: "Unily", vendor: null, status: "DRAFT", compliancePercentage: null, requirementsMet: 0, requirementsApplicable: 0, openRiskCount: 2 },
];

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe("BusinessRiskOwnerDashboard compliance copy (#90)", () => {
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("/compliance")) {
      return json({ compliance: complianceFor(url.includes("frameworkId=nis2") ? nis2 : iso, !url.includes("frameworkId=nis2")) });
    }
    if (url.includes("/portfolio")) return json({ portfolio });
    return json({ risks: [] });
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("with no Framework filter the headline is the base Framework's Requirements met, and says so", async () => {
    render(<BusinessRiskOwnerDashboard businessUnits={[]} frameworks={[iso, nis2]} />);

    expect(await screen.findByText("66.7%")).toBeInTheDocument();
    expect(screen.getByText(/6\/9 applicable Requirements met, pooled across Systems/)).toBeInTheDocument();
    expect(screen.getByText(/ISO\/IEC 27001:2022 \(base Framework: the headline figure when no Framework is selected\)/)).toBeInTheDocument();
    // The old Control-based wording is gone, and the Organizational note is shown.
    expect(screen.queryByText(/mandatory Controls resolved/)).not.toBeInTheDocument();
    expect(screen.getByText(/Organizational Requirements aren't counted yet/)).toBeInTheDocument();
  });

  it("lists each System's own figure with its Met and applicable counts, an em dash when nothing applies", async () => {
    render(<BusinessRiskOwnerDashboard businessUnits={[]} frameworks={[iso, nis2]} />);
    await screen.findByText("66.7%");

    expect(screen.getByText("83.3% (5/6)")).toBeInTheDocument();
    expect(screen.getByText("33.3% (1/3)")).toBeInTheDocument();
    expect(screen.getByText("— (0/0)")).toBeInTheDocument();
  });

  it("names the filtered Framework instead of the base one when a Framework is selected", async () => {
    const user = userEvent.setup();
    render(<BusinessRiskOwnerDashboard businessUnits={[]} frameworks={[iso, nis2]} />);
    await screen.findByText("66.7%");

    await user.selectOptions(screen.getByLabelText("Filter by Framework"), "nis2");
    await waitFor(() => expect(screen.getByText("NIS2:2022", { selector: "p" })).toBeInTheDocument());
    expect(screen.queryByText(/base Framework: the headline figure/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/business-risk-owner/compliance?frameworkId=nis2");
    expect(fetchMock).toHaveBeenCalledWith("/api/business-risk-owner/portfolio?frameworkId=nis2");
  });

  it("puts the Framework's percentage on the portfolio cards", async () => {
    render(<BusinessRiskOwnerDashboard businessUnits={[]} frameworks={[iso, nis2]} />);
    await screen.findByText("66.7%");

    const jira = within(screen.getByRole("link", { name: /Jira/ }));
    expect(jira.getByText(/83\.3% Requirements met/)).toBeInTheDocument();
    const unily = within(screen.getByRole("link", { name: /Unily/ }));
    expect(unily.getByText(/— Requirements met/)).toBeInTheDocument();
    expect(screen.getByText(/Percentages are the share of applicable ISO\/IEC 27001:2022 Requirements met/)).toBeInTheDocument();
  });
});
