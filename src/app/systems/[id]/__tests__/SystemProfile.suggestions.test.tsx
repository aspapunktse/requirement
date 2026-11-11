import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";
import { SystemProfile } from "../SystemProfile";

/** The Suggested Frameworks section of the Profile tab (#300, ADR 0013), with a stubbed fetch. */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const SUGGESTED = [
  { frameworkId: "fw3", label: "GDPR:2016", name: "GDPR", types: ["Payroll", "Source code"], state: "open" as const },
  { frameworkId: "fw9", label: "NIS2:1", name: "NIS2", types: ["Payroll"], state: "left-out" as const },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/framework-scopes")) return respond({ frameworkScopes: [] });
    if (url.endsWith("/business-units")) return respond({ businessUnits: [] });
    return respond({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NO_DETAILS = {
  vendorWebsiteUrl: null,
  serviceUrl: null,
  productPlan: null,
  vendorTrustUrl: null,
  dataLocation: null,
  dataProcessingAgreement: null,
  contractReference: null,
  contractRenewalDate: null,
  noticePeriodMonths: null,
};

function renderProfile(props: Partial<React.ComponentProps<typeof SystemProfile>> = {}) {
  return render(
    <SystemProfile
      systemId="s1"
      about={{ ...NO_DETAILS, name: "ServiceNow", vendor: null, ownerName: "Marcus", createdAt: "2026-09-01T09:00:00.000Z", onboardedAt: null, description: null, needsVendorDetails: false }}
      canChangeClassification
      canManageBusinessUnits
      canManageFrameworkScopes
      deploymentFacetIds={[]}
      impactLevels={{ integrityImpactLevel: null, availabilityImpactLevel: null }}
      sensitivityLevel={3}
      sensitivityLevels={[...DEFAULT_SENSITIVITY_LEVELS].map((level) => ({ ...level }))}
      informationTypes={[]}
      belowInformationTypes={false}
      suggestedFrameworks={SUGGESTED}
      {...props}
    />,
  );
}

describe("SystemProfile: Suggested Frameworks (#300)", () => {
  it("lists an open suggestion with its types, and adds it to the scope through the Framework Scope route", async () => {
    renderProfile();
    const group = await screen.findByRole("group", { name: "Suggested Frameworks" });
    expect(group).toHaveTextContent("Payroll and Source code usually fall under GDPR. Put GDPR in this System");
    await userEvent.click(within(group).getByRole("button", { name: "Add GDPR:2016 to scope" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/framework-scopes", expect.objectContaining({ method: "POST", body: JSON.stringify({ frameworkId: "fw3" }) })),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("leaves a suggestion out through the suggestions route", async () => {
    renderProfile();
    await userEvent.click(await screen.findByRole("button", { name: "Leave out GDPR:2016" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/framework-suggestions", expect.objectContaining({ method: "POST", body: JSON.stringify({ frameworkId: "fw3" }) })),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a left-out suggestion as a quiet line with a way to add it anyway", async () => {
    renderProfile();
    const quiet = await screen.findByRole("list", { name: "Left out" });
    expect(quiet).toHaveTextContent("Left out: NIS2:1, suggested by Payroll.");
    await userEvent.click(within(quiet).getByRole("button", { name: "Add NIS2:1 to scope anyway" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/framework-scopes", expect.objectContaining({ body: JSON.stringify({ frameworkId: "fw9" }) })),
    );
  });

  it("offers no action to someone who cannot manage the scope", async () => {
    renderProfile({ canManageFrameworkScopes: false });
    const group = await screen.findByRole("group", { name: "Suggested Frameworks" });
    expect(within(group).queryByRole("button")).toBeNull();
    expect(group).toHaveTextContent("Only the System's owner or an Admin decides.");
  });

  it("shows the server's refusal and does not refresh", async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return respond({ error: "Only the owner can leave out a suggested Framework" }, 403);
      return String(input).endsWith("/business-units") ? respond({ businessUnits: [] }) : respond({ frameworkScopes: [] });
    });
    renderProfile();
    await userEvent.click(await screen.findByRole("button", { name: "Leave out GDPR:2016" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the owner can leave out a suggested Framework");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows nothing when there is nothing to suggest", async () => {
    renderProfile({ suggestedFrameworks: [] });
    await screen.findByText("Business Units and Framework Scope");
    expect(screen.queryByRole("group", { name: "Suggested Frameworks" })).toBeNull();
  });
});
