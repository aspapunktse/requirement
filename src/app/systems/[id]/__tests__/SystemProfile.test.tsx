import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemProfile } from "../SystemProfile";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

const FACETS = [
  { id: "f1", name: "SaaS" },
  { id: "f2", name: "Cloud IaaS/PaaS" },
];
const FRAMEWORKS = [
  { id: "fw1", name: "ISO/IEC 27001", version: "2022", description: null, status: "PUBLISHED" },
  { id: "fw2", name: "NIS2", version: "1", description: null, status: "DRAFT" },
  { id: "fw3", name: "GDPR", version: "2016", description: null, status: "PUBLISHED" },
];
const SCOPES = [
  { id: "fw1", name: "ISO/IEC 27001", version: "2022", description: null, status: "PUBLISHED", isBase: true },
  { id: "fw3", name: "GDPR", version: "2016", description: null, status: "PUBLISHED", isBase: false },
];

let fetchMock: ReturnType<typeof vi.fn>;
let scopes = SCOPES;

beforeEach(() => {
  refresh.mockClear();
  scopes = SCOPES;
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/deployment-facets") return respond({ deploymentFacets: FACETS });
    if (url === "/api/frameworks") return respond({ frameworks: FRAMEWORKS });
    if (url === "/api/business-units") return respond({ businessUnits: [{ id: "b1", name: "Finance" }, { id: "b2", name: "HR" }] });
    if (url.endsWith("/business-units")) return respond({ businessUnits: [{ id: "b1", name: "Finance", description: null }] });
    if (url.endsWith("/framework-scopes")) return respond({ frameworkScopes: scopes });
    if (init?.method === "PATCH") return respond({ added: 2, removed: 1 });
    return respond({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderProfile(props: Partial<React.ComponentProps<typeof SystemProfile>> = {}) {
  return render(
    <SystemProfile
      systemId="s1"
      about={{ vendor: "ServiceNow Inc", ownerName: "Marcus Lindqvist", createdAt: "2026-09-01T09:00:00.000Z", onboardedAt: null, description: "IT service management." }}
      canChangeClassification
      canManageBusinessUnits
      canManageFrameworkScopes
      deploymentFacetIds={["f1"]}
      impactLevels={{ confidentialityImpactLevel: "HIGH", integrityImpactLevel: null, availabilityImpactLevel: "LOW" }}
      {...props}
    />,
  );
}

describe("About", () => {
  it("is read-only: vendor, owner, created, onboarded and description, with no Edit button yet", () => {
    renderProfile();
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(about.getByText("ServiceNow Inc")).toBeInTheDocument();
    expect(about.getByText("Marcus Lindqvist")).toBeInTheDocument();
    expect(about.getByText("1 Sep 2026")).toBeInTheDocument();
    expect(about.getByText("Not yet")).toBeInTheDocument();
    expect(about.getByText("IT service management.")).toBeInTheDocument();
    expect(about.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so for what is not set", () => {
    renderProfile({ about: { vendor: null, ownerName: "Ola", createdAt: "2026-09-01T09:00:00.000Z", onboardedAt: "2026-10-01T09:00:00.000Z", description: null } });
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(about.getByText("Not set")).toBeInTheDocument();
    expect(about.getByText("No description")).toBeInTheDocument();
    expect(about.getByText("1 Oct 2026")).toBeInTheDocument();
  });
});

describe("Deployment Facets", () => {
  it("shows the Facets as checkboxes with the current ones ticked, and the Hybrid note", async () => {
    renderProfile();
    expect(await screen.findByRole("checkbox", { name: "SaaS" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Cloud IaaS/PaaS" })).not.toBeChecked();
    expect(screen.getByText("More than one means Hybrid")).toBeInTheDocument();
  });

  it("saves a changed selection through the same PATCH, reports what changed and refreshes the page", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(await screen.findByRole("checkbox", { name: "Cloud IaaS/PaaS" }));
    await user.click(screen.getByRole("button", { name: "Change Deployment Facets" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ deploymentFacetIds: ["f1", "f2"] }) }));
    expect(await screen.findByText("Deployment Facets changed: 2 Control(s) added, 1 untouched Control(s) removed.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps Save off while nothing changed or none is ticked", async () => {
    const user = userEvent.setup();
    renderProfile();
    const save = screen.getByRole("button", { name: "Change Deployment Facets" });
    expect(save).toBeDisabled();
    await user.click(await screen.findByRole("checkbox", { name: "SaaS" }));
    expect(save).toBeDisabled();
  });

  it("shows the server's refusal", async () => {
    const user = userEvent.setup();
    renderProfile();
    fetchMock.mockImplementation(() => respond({ error: "Only the System's owner or an Admin can change its classification" }, 403));
    await user.click(await screen.findByRole("checkbox", { name: "Cloud IaaS/PaaS" }));
    await user.click(screen.getByRole("button", { name: "Change Deployment Facets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the System's owner or an Admin can change its classification");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is read-only for someone who may not change the classification", async () => {
    renderProfile({ canChangeClassification: false });
    expect(await screen.findByRole("checkbox", { name: "SaaS" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Change Deployment Facets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change Impact Levels" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High" , pressed: true })).toBeDisabled();
  });

  it("says when the Facets can't be loaded, and loads them again on request", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => respond({ error: "x" }, 500));
    renderProfile();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the Deployment Facets.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("checkbox", { name: "SaaS" })).toBeInTheDocument();
  });
});

describe("Impact Level", () => {
  const axis = (name: string) => within(screen.getByRole("group", { name }));

  it("shows a segmented control per axis with the current level pressed, Not classified included", () => {
    renderProfile();
    expect(axis("Confidentiality").getByRole("button", { name: "High" })).toHaveAttribute("aria-pressed", "true");
    expect(axis("Integrity").getByRole("button", { name: "Not classified" })).toHaveAttribute("aria-pressed", "true");
    expect(axis("Availability").getByRole("button", { name: "Low" })).toHaveAttribute("aria-pressed", "true");
    expect(axis("Integrity").getAllByRole("button").map((button) => button.textContent)).toEqual(["Not classified", "Low", "Moderate", "High", "Critical"]);
    expect(screen.getByText(/Changing it recomputes the applicable Controls/)).toBeInTheDocument();
  });

  it("saves only when a level changed, sending all three axes", async () => {
    const user = userEvent.setup();
    renderProfile();
    const save = screen.getByRole("button", { name: "Change Impact Levels" });
    expect(save).toBeDisabled();

    await user.click(axis("Integrity").getByRole("button", { name: "Critical" }));
    await user.click(axis("Availability").getByRole("button", { name: "Not classified" }));
    await user.click(save);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ confidentialityImpactLevel: "HIGH", integrityImpactLevel: "CRITICAL", availabilityImpactLevel: null }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("Business Units and Framework Scope", () => {
  it("shows the declared ones as tags, the base Framework as always in scope with no remove", async () => {
    renderProfile();
    const units = within(await screen.findByRole("list", { name: "Business Units" }));
    expect(units.getByText("Finance")).toBeInTheDocument();
    expect(units.getByRole("button", { name: "Remove Finance" })).toBeInTheDocument();

    const scope = within(await screen.findByRole("list", { name: "Frameworks" }));
    expect(scope.getByText(/ISO\/IEC 27001:2022/)).toHaveTextContent("always");
    expect(scope.queryByRole("button", { name: "Remove ISO/IEC 27001:2022" })).not.toBeInTheDocument();
    expect(scope.getByRole("button", { name: "Remove GDPR:2016" })).toBeInTheDocument();
  });

  it("labels a Draft Framework in scope as inert but still removable", async () => {
    scopes = [...SCOPES, { id: "fw2", name: "NIS2", version: "1", description: null, status: "DRAFT", isBase: false }];
    renderProfile();
    const draft = (await screen.findByText(/NIS2:1/)).closest("li")!;
    expect(within(draft).getByText(/Draft, no effect until published/)).toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: "Remove NIS2:1" })).toBeInTheDocument();
  });

  it("does not offer a Draft Framework or one already declared to add", async () => {
    const user = userEvent.setup();
    scopes = [SCOPES[0]];
    renderProfile();
    await screen.findByRole("list", { name: "Frameworks" });
    const adds = screen.getAllByRole("button", { name: "+ Add" });
    await user.click(adds[1]);
    const picker = screen.getByLabelText("Declare a Framework");
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Select a Framework…", "GDPR:2016"]);
  });

  it("refreshes the page after a change, so the Overview and the timeline follow", async () => {
    const user = userEvent.setup();
    renderProfile();
    await screen.findByRole("list", { name: "Business Units" });
    fetchMock.mockImplementation(() => respond({ businessUnits: [] }));
    await user.click(screen.getByRole("button", { name: "Remove Finance" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("declares a Business Unit through the same POST and shows it", async () => {
    const user = userEvent.setup();
    renderProfile();
    await screen.findByRole("list", { name: "Business Units" });
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "POST" ? respond({ businessUnits: [{ id: "b1", name: "Finance" }, { id: "b2", name: "HR" }] }) : respond({}),
    );

    await user.click(screen.getAllByRole("button", { name: "+ Add" })[0]);
    await user.selectOptions(screen.getByLabelText("Declare a Business Unit"), "b2");
    await user.click(screen.getByRole("button", { name: "Declare" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/business-units", expect.objectContaining({ method: "POST", body: JSON.stringify({ businessUnitId: "b2" }) }));
    expect(await within(screen.getByRole("list", { name: "Business Units" })).findByText("HR")).toBeInTheDocument();
  });

  it("removes one through DELETE and shows the refusal when the server refuses", async () => {
    const user = userEvent.setup();
    renderProfile();
    await screen.findByRole("list", { name: "Business Units" });
    fetchMock.mockImplementation(() => respond({ error: "Not allowed" }, 403));

    await user.click(screen.getByRole("button", { name: "Remove Finance" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/business-units/b1", expect.objectContaining({ method: "DELETE" }));
    expect(await screen.findByText("Not allowed")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("offers no add or remove to someone who may not manage them, and fetches no catalog", async () => {
    renderProfile({ canManageBusinessUnits: false, canManageFrameworkScopes: false });
    await screen.findByRole("list", { name: "Frameworks" });
    expect(screen.queryByRole("button", { name: "+ Add" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain("/api/frameworks");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain("/api/business-units");
  });
});
