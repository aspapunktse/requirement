import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemProfile, type SystemAbout } from "../SystemProfile";

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

const TYPES = [
  { id: "it-pay", name: "Payroll", description: "Salaries and bank details", sensitivityLevel: 4, systemCount: 0 },
  { id: "it-code", name: "Source code", description: "Our own software", sensitivityLevel: 3, systemCount: 0 },
  { id: "it-web", name: "Public web content", description: null, sensitivityLevel: 1, systemCount: 0 },
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
    if (url === "/api/information-types") return respond({ informationTypes: TYPES });
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

const LEVELS = [
  { level: 1, label: "Public", description: "Information anyone may see.", textColor: "#475569", backgroundColor: "#F1F5F9" },
  { level: 2, label: "Internal", description: "Everyday business information.", textColor: "#1D4ED8", backgroundColor: "#EFF6FF" },
  { level: 3, label: "Sensitive", description: "Would cause harm if it leaked.", textColor: "#854D0E", backgroundColor: "#FEF9C3" },
  { level: 4, label: "Highly Sensitive", description: "Would seriously harm people.", textColor: "#9A3412", backgroundColor: "#FFEDD5" },
  { level: 5, label: "Critical Sensitivity", description: "Would threaten the organisation.", textColor: "#991B1B", backgroundColor: "#FEE2E2" },
];

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

const ABOUT: SystemAbout = {
  ...NO_DETAILS,
  name: "ServiceNow",
  vendor: "ServiceNow Inc",
  ownerName: "Marcus Lindqvist",
  createdAt: "2026-09-01T09:00:00.000Z",
  onboardedAt: null,
  description: "IT service management.",
  needsVendorDetails: false,
};

function renderProfile(props: Partial<React.ComponentProps<typeof SystemProfile>> = {}) {
  return render(
    <SystemProfile
      systemId="s1"
      about={ABOUT}
      canChangeClassification
      canManageBusinessUnits
      canManageFrameworkScopes
      deploymentFacetIds={["f1"]}
      impactLevels={{ integrityImpactLevel: null, availabilityImpactLevel: "LOW" }}
      sensitivityLevel={4}
      sensitivityLevels={LEVELS}
      informationTypes={[]}
      belowInformationTypes={false}
      {...props}
    />,
  );
}

describe("About", () => {
  it("shows vendor, owner, created, onboarded and description, with no Edit button without permission", () => {
    renderProfile({ canChangeClassification: false });
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(about.getByText("ServiceNow Inc")).toBeInTheDocument();
    expect(about.getByText("Marcus Lindqvist")).toBeInTheDocument();
    expect(about.getByText("1 Sep 2026")).toBeInTheDocument();
    expect(about.getByText("Not yet")).toBeInTheDocument();
    expect(about.getByText("IT service management.")).toBeInTheDocument();
    expect(about.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so for what is not set", () => {
    renderProfile({ about: { ...ABOUT, vendor: null, ownerName: "Ola", onboardedAt: "2026-10-01T09:00:00.000Z", description: null } });
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(about.getAllByText("Not set").length).toBeGreaterThan(0);
    expect(about.getByText("No description")).toBeInTheDocument();
    expect(about.getByText("1 Oct 2026")).toBeInTheDocument();
  });
});

describe("About, editing (#246)", () => {
  const aboutRegion = () => within(screen.getByRole("region", { name: "About" }));

  it("offers Edit to someone who may change the System, and opens a form with the current values", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    expect(aboutRegion().getByLabelText("Name")).toHaveValue("ServiceNow");
    expect(aboutRegion().getByLabelText("Vendor")).toHaveValue("ServiceNow Inc");
    expect(aboutRegion().getByLabelText("Description")).toHaveValue("IT service management.");
    expect(aboutRegion().queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("saves the trimmed values through PATCH .../details, leaves edit mode and refreshes the page", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    const name = aboutRegion().getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  ServiceNow ITSM ");
    await user.clear(aboutRegion().getByLabelText("Vendor"));
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1/details",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "ServiceNow ITSM", vendor: null, description: "IT service management." }) }),
    );
    expect(aboutRegion().queryByLabelText("Name")).not.toBeInTheDocument();
    expect(aboutRegion().getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("disables the form and shows Saving… while the request is in flight", async () => {
    const user = userEvent.setup();
    let finish: (response: Response) => void = () => {};
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "PATCH" ? new Promise<Response>((resolve) => (finish = resolve)) : respond({}),
    );
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));

    expect(aboutRegion().getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(aboutRegion().getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish(new Response("{}", { status: 200 }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows the server's error inline and stays in the form with the typed values", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) =>
      init?.method === "PATCH" ? respond({ error: "Only the System's owner or an Admin can edit its details" }, 403) : respond({}),
    );
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    const name = aboutRegion().getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));

    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Only the System's owner or an Admin can edit its details");
    expect(aboutRegion().getByLabelText("Name")).toHaveValue("Renamed");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows an error when the request itself fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((_input: string | URL | Request, init?: RequestInit) => (init?.method === "PATCH" ? Promise.reject(new Error("offline")) : respond({})));
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Failed to save the details");
    expect(aboutRegion().getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("rejects an empty name and an over-long description without sending anything", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    await user.clear(aboutRegion().getByLabelText("Name"));
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Name is required");

    await user.type(aboutRegion().getByLabelText("Name"), "ServiceNow");
    fireEvent.change(aboutRegion().getByLabelText("Description"), { target: { value: "d".repeat(2001) } });
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Description can be at most 2000 characters");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/systems/s1/details", expect.anything());
  });

  it("Cancel discards the edits and shows the saved values again", async () => {
    const user = userEvent.setup();
    renderProfile();
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    await user.type(aboutRegion().getByLabelText("Vendor"), " changed");
    await user.click(aboutRegion().getByRole("button", { name: "Cancel" }));
    expect(aboutRegion().getByText("ServiceNow Inc")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/systems/s1/details", expect.anything());

    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    expect(aboutRegion().getByLabelText("Vendor")).toHaveValue("ServiceNow Inc");
  });
});

describe("About, vendor and contract details (#357)", () => {
  const aboutRegion = () => within(screen.getByRole("region", { name: "About" }));
  const FILLED: SystemAbout = {
    ...ABOUT,
    vendorWebsiteUrl: "https://www.acme.example",
    serviceUrl: "https://app.acme.example",
    productPlan: "Premium",
    vendorTrustUrl: "https://trust.acme.example",
    dataLocation: "EU_EEA",
    dataProcessingAgreement: "IN_PROGRESS",
    contractReference: "C-2026-14",
    contractRenewalDate: "2027-03-31",
    noticePeriodMonths: 3,
  };

  it("shows the details, with the addresses as links that open in a new tab", () => {
    renderProfile({ about: FILLED });
    for (const url of ["https://www.acme.example", "https://app.acme.example", "https://trust.acme.example"]) {
      const link = aboutRegion().getByRole("link", { name: url });
      expect(link).toHaveAttribute("href", url);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(aboutRegion().getByText("Premium")).toBeInTheDocument();
    expect(aboutRegion().getByText("C-2026-14")).toBeInTheDocument();
    expect(aboutRegion().getByText(/3 months/)).toBeInTheDocument();
  });

  it("shows an address that is not http or https as plain text, never as a link", () => {
    renderProfile({ about: { ...FILLED, serviceUrl: "javascript:alert(1)" } });
    expect(aboutRegion().queryByRole("link", { name: "javascript:alert(1)" })).not.toBeInTheDocument();
    expect(aboutRegion().getByText("javascript:alert(1)")).toBeInTheDocument();
  });

  it("saves only the details that changed, next to name, vendor and description", async () => {
    const user = userEvent.setup();
    renderProfile({ about: FILLED });
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    await user.selectOptions(aboutRegion().getByLabelText("Data location"), "SWEDEN");
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1/details",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "ServiceNow", vendor: "ServiceNow Inc", description: "IT service management.", dataLocation: "SWEDEN" }),
      }),
    );
  });

  it("refuses an address that is not http or https, and a notice period out of range, without sending", async () => {
    const user = userEvent.setup();
    renderProfile({ about: FILLED });
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    fireEvent.change(aboutRegion().getByLabelText("Vendor website"), { target: { value: "ftp://x.example" } });
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Vendor website must be a web address");

    fireEvent.change(aboutRegion().getByLabelText("Vendor website"), { target: { value: "https://www.acme.example" } });
    fireEvent.change(aboutRegion().getByLabelText("Notice period (months)"), { target: { value: "121" } });
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("Notice period must be a whole number of months");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/systems/s1/details", expect.anything());
  });

  it("marks vendor and service URL required on a System that needs them, and refuses clearing them", async () => {
    const user = userEvent.setup();
    renderProfile({ about: { ...FILLED, needsVendorDetails: true } });
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    expect(aboutRegion().getByLabelText("Vendor (required)")).toBeInTheDocument();
    await user.clear(aboutRegion().getByLabelText("Service URL (required)"));
    await user.click(aboutRegion().getByRole("button", { name: "Save" }));
    expect(await aboutRegion().findByRole("alert")).toHaveTextContent("needs its vendor name and service URL");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/systems/s1/details", expect.anything());
  });

  it("does not mark them required on a System that does not need them", async () => {
    const user = userEvent.setup();
    renderProfile({ about: FILLED });
    await user.click(aboutRegion().getByRole("button", { name: "Edit" }));
    expect(aboutRegion().getByLabelText("Vendor")).toBeInTheDocument();
    expect(aboutRegion().getByLabelText("Service URL")).toBeInTheDocument();
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
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Highly Sensitive" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Sensitivity Level: Public" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Change Sensitivity Level" })).not.toBeInTheDocument();
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

describe("Sensitivity Level", () => {
  const group = () => within(screen.getByRole("radiogroup", { name: "Sensitivity Level" }));

  it("lists the five levels as chips with their description, then Not set, with the current one checked", () => {
    renderProfile();
    expect(group().getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? document.getElementById(radio.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Public",
      "Internal",
      "Sensitive",
      "Highly Sensitive",
      "Critical Sensitivity",
      "Not set",
    ]);
    expect(group().getByRole("radio", { name: "Sensitivity Level: Highly Sensitive" })).toBeChecked();
    expect(group().getByRole("radio", { name: "Sensitivity Level: Highly Sensitive" })).toHaveAccessibleDescription("Would seriously harm people.");
    expect(group().getByRole("radio", { name: "Sensitivity Level: Not set" })).not.toBeChecked();
    expect(screen.getByText(/Would threaten the organisation\./)).toBeInTheDocument();
    // The chip carries the live token colours, so an Admin's rename or recolour shows without a deploy.
    expect(group().getByRole("img", { name: "Sensitivity Level: Public" })).toHaveStyle({ color: "var(--rg-sensitivity-1-fg)" });
  });

  it("saves only when the level changed, sending just the level", async () => {
    const user = userEvent.setup();
    renderProfile();
    const save = screen.getByRole("button", { name: "Change Sensitivity Level" });
    expect(save).toBeDisabled();

    await user.click(group().getByRole("radio", { name: "Sensitivity Level: Critical Sensitivity" }));
    await user.click(save);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ sensitivityLevel: 5 }) }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("can clear the level, and shows the API's refusal", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? respond({ error: "Only the System's owner or an Admin can change this System's classification" }, 403) : respond({ deploymentFacets: [] }),
    );
    renderProfile();
    await user.click(group().getByRole("radio", { name: "Sensitivity Level: Not set" }));
    await user.click(screen.getByRole("button", { name: "Change Sensitivity Level" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1", expect.objectContaining({ body: JSON.stringify({ sensitivityLevel: null }) }));
    expect(await screen.findByText(/Only the System's owner or an Admin/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Information Types (#304)", () => {
  const group = () => within(screen.getByRole("radiogroup", { name: "Sensitivity Level" }));
  const declared = (...ids: string[]) => TYPES.filter((type) => ids.includes(type.id)).map(({ id, name, sensitivityLevel }) => ({ id, name, sensitivityLevel }));

  it("lists the catalogue with the declared types ticked, and no floor while none is", async () => {
    renderProfile({ informationTypes: declared("it-code"), sensitivityLevel: 3 });
    expect(await screen.findByRole("checkbox", { name: "Payroll" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Source code" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Payroll" })).toHaveAccessibleDescription(/Salaries and bank details/);
    // Source code is Sensitive: Public and Internal are below its floor, and say so.
    expect(group().getByRole("radio", { name: "Sensitivity Level: Internal" })).toBeDisabled();
    expect(group().getByRole("radio", { name: "Sensitivity Level: Internal" })).toHaveAccessibleDescription("Below the floor (Source code)");
    expect(group().getByRole("radio", { name: "Sensitivity Level: Sensitive" })).toBeEnabled();
    expect(group().getByRole("radio", { name: "Sensitivity Level: Not set" })).toBeDisabled();
  });

  it("sets the level freely when no type is declared", async () => {
    renderProfile();
    await screen.findByRole("checkbox", { name: "Payroll" });
    expect(screen.getByText("No Information Type is ticked, so you set the level freely.")).toBeInTheDocument();
    expect(group().getByRole("radio", { name: "Sensitivity Level: Public" })).toBeEnabled();
    expect(group().getByRole("radio", { name: "Sensitivity Level: Not set" })).toBeEnabled();
  });

  it("offers to raise the level when a ticked type is above it, and saves the types and the level in one request", async () => {
    const user = userEvent.setup();
    renderProfile({ sensitivityLevel: 3 });
    await user.click(await screen.findByRole("checkbox", { name: "Payroll" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Payroll is Highly Sensitive, above this System's level (Sensitive)");
    expect(screen.getByRole("button", { name: "Change Sensitivity Level" })).toBeDisabled();

    await user.click(within(alert).getByRole("button", { name: "Raise to Highly Sensitive" }));
    expect(group().getByRole("radio", { name: "Sensitivity Level: Highly Sensitive" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Change Sensitivity Level" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/systems/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ informationTypeIds: ["it-pay"], sensitivityLevel: 4 }) }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("leaves the type out instead when asked", async () => {
    const user = userEvent.setup();
    renderProfile({ sensitivityLevel: 3 });
    await user.click(await screen.findByRole("checkbox", { name: "Payroll" }));
    await user.click(screen.getByRole("button", { name: "Don't add Payroll" }));
    expect(screen.getByRole("checkbox", { name: "Payroll" })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change Sensitivity Level" })).toBeDisabled();
  });

  it("saves a removed type without touching the level", async () => {
    const user = userEvent.setup();
    renderProfile({ informationTypes: declared("it-pay", "it-code"), sensitivityLevel: 4 });
    await user.click(await screen.findByRole("checkbox", { name: "Source code" }));
    await user.click(screen.getByRole("button", { name: "Change Sensitivity Level" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1", expect.objectContaining({ body: JSON.stringify({ informationTypeIds: ["it-pay"] }) }));
  });

  it("flags a System below its types, and the owner fixes it with one click that sends just the level", async () => {
    const user = userEvent.setup();
    renderProfile({ informationTypes: declared("it-pay"), sensitivityLevel: 3, belowInformationTypes: true });
    const alert = await screen.findByText("Below its Information Types.");
    expect(alert.closest("[role=alert]")).toHaveTextContent("Payroll is Highly Sensitive");
    await user.click(screen.getByRole("button", { name: "Raise to Highly Sensitive" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ sensitivityLevel: 4 }) }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows someone who can't change it who can fix it, with no button, and no picker to edit the types", () => {
    renderProfile({ canChangeClassification: false, informationTypes: declared("it-pay"), sensitivityLevel: 3, belowInformationTypes: true });
    expect(screen.getByText(/Only Marcus Lindqvist, the System's owner, or an Admin can raise it\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raise to Highly Sensitive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Payroll" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Information Types" })).toHaveTextContent("Payroll · Highly Sensitive");
  });

  it("shows the server's refusal and keeps the choice", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? respond({ error: "The Sensitivity Level can't be lower than the System's Information Types" }, 400)
        : url === "/api/information-types"
          ? respond({ informationTypes: TYPES })
          : respond({ deploymentFacets: [] }),
    );
    renderProfile({ sensitivityLevel: 4 });
    await user.click(await screen.findByRole("checkbox", { name: "Public web content" }));
    await user.click(screen.getByRole("button", { name: "Change Sensitivity Level" }));
    expect(await screen.findByText(/can't be lower than the System's Information Types/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Public web content" })).toBeChecked();
  });
});

describe("Impact Level", () => {
  const axis = (name: string) => within(screen.getByRole("group", { name }));

  it("shows a segmented control per axis with the current level pressed, Not classified included", () => {
    renderProfile();
    expect(screen.queryByRole("group", { name: "Confidentiality" })).not.toBeInTheDocument();
    expect(axis("Integrity").getByRole("button", { name: "Not classified" })).toHaveAttribute("aria-pressed", "true");
    expect(axis("Availability").getByRole("button", { name: "Low" })).toHaveAttribute("aria-pressed", "true");
    expect(axis("Integrity").getAllByRole("button").map((button) => button.textContent)).toEqual(["Not classified", "Low", "Moderate", "High", "Critical"]);
    expect(screen.getAllByText(/Changing it recomputes the applicable Controls/)).toHaveLength(2); // the Sensitivity Level and Impact Level cards
  });

  it("saves only when a level changed, sending both axes", async () => {
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
        body: JSON.stringify({ integrityImpactLevel: "CRITICAL", availabilityImpactLevel: null }),
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
