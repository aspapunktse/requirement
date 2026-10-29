import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingInterview } from "../OnboardingInterview";
import type { OnboardingCatalog, OnboardingControl } from "@/lib/onboarding-interview";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const control = (code: string, patch: Partial<OnboardingControl> = {}): OnboardingControl => ({
  id: `id-${code}`,
  code,
  title: `Title of ${code}`,
  applicability: "PER_SYSTEM",
  deploymentFacetIds: [],
  minConfidentialityImpactLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
  frameworkIds: ["base"],
  organizationFulfilled: false,
  offerings: [],
  ...patch,
});

const catalog: OnboardingCatalog = {
  deploymentFacets: [
    { id: "f-saas", name: "Software as a service", description: "We subscribe to it and log in" },
    { id: "f-prem", name: "On-premises", description: "We run it in our own data centre" },
  ],
  frameworks: [
    { id: "base", name: "ISO/IEC 27001", version: "2022", description: null, isBase: true, onboardingQuestion: null, onboardingHint: null },
    { id: "gdpr", name: "GDPR", version: "2016", description: null, isBase: false, onboardingQuestion: "Does it hold personal data about people?", onboardingHint: "Customers, employees, patients." },
    { id: "ccm", name: "CSA CCM", version: "4", description: "Cloud controls matrix", isBase: false, onboardingQuestion: null, onboardingHint: null },
  ],
  providers: [
    { id: "p1", name: "Landing Zone", onboarded: true },
    { id: "p2", name: "Backup Service", onboarded: false },
  ],
  controls: [
    control("C-1"),
    control("C-2", { deploymentFacetIds: ["f-prem"] }),
    control("C-3", { frameworkIds: ["gdpr"] }),
    control("C-4", { minConfidentialityImpactLevel: "HIGH" }),
    control("C-5", { offerings: [{ providerId: "p1", type: "FULL", customerResponsibility: null, fulfilled: true }] }),
    control("C-6", { offerings: [{ providerId: "p1", type: "SHARED", customerResponsibility: "Review the access list", fulfilled: false }] }),
    control("C-7", { frameworkIds: ["ccm"] }),
  ],
};

function mockFetch(overrides: { onPost?: () => Response; catalogResponse?: () => Response } = {}) {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/system-onboarding") && method === "GET") {
      return Promise.resolve(overrides.catalogResponse?.() ?? new Response(JSON.stringify(catalog), { status: 200 }));
    }
    if (url.endsWith("/api/systems") && method === "POST") {
      return Promise.resolve(overrides.onPost?.() ?? new Response(JSON.stringify({ system: { id: "sys1" } }), { status: 201 }));
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

const postedBody = () => {
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "POST");
  return call ? JSON.parse(call[1].body) : null;
};

/** The question card's title (the live list has its own level-2 heading). */
const questionTitle = () => document.getElementById("ob-q-title")!;

async function setup() {
  const user = userEvent.setup();
  render(<OnboardingInterview />);
  await screen.findByRole("heading", { name: "How do you get the system?" });
  return user;
}

const next = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Next" }));

describe("OnboardingInterview", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the hero, the seven steps, the first question and the live list", async () => {
    await setup();

    expect(screen.getByRole("heading", { level: 1, name: "Onboard a new System" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toHaveTextContent("Systems / New System");
    const steps = within(screen.getByRole("list", { name: "Steps" })).getAllByRole("button");
    expect(steps.map((b) => b.textContent)).toEqual(["1Delivery", "2Sensitivity", "3Integrity", "4Downtime", "5Laws and standards", "6Relies on", "7Review"]);
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();
    expect(screen.getByText("Pick every option that fits. A system that is partly bought as a service and partly run by you takes both.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Software as a service" })).toHaveAccessibleDescription(/We subscribe to it and log in/);
    // Before any answer: the Controls with no scoping apply, of all seven in the library.
    expect(screen.getByRole("heading", { name: /3 Controls apply, of 7 in the library/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /You do this . 3/ })).toBeInTheDocument();
  });

  it("keeps Next disabled until a Deployment Facet is picked, and the later steps with it", async () => {
    const user = await setup();

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sensitivity" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("steps forward and back, and jumps through the stepper", async () => {
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));

    await next(user);
    expect(questionTitle()).toHaveTextContent("What is the most sensitive information in it?");
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sensitivity" })).toHaveAttribute("aria-current", "step");
    await next(user);
    expect(questionTitle()).toHaveTextContent("What happens if its data is wrong or tampered with?");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(questionTitle()).toHaveTextContent("What is the most sensitive information in it?");

    await user.click(screen.getByRole("button", { name: "Relies on" }));
    expect(questionTitle()).toHaveTextContent("What company services does it rely on?");
    await user.click(screen.getByRole("button", { name: "Delivery" }));
    expect(questionTitle()).toHaveTextContent("How do you get the system?");
    // The answer is still there.
    expect(screen.getByRole("checkbox", { name: "Software as a service" })).toBeChecked();
  });

  it("shows what each answer would do to the list, and updates the list, counts and the change note on every answer", async () => {
    const user = await setup();

    // Picking On-premises would add C-2; Software as a service changes nothing.
    expect(screen.getByRole("checkbox", { name: "On-premises" })).toHaveAccessibleDescription(/\+1/);
    expect(screen.getByRole("checkbox", { name: "Software as a service" })).toHaveAccessibleDescription(/No change/);

    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    expect(screen.getByRole("heading", { name: /4 Controls apply, of 7 in the library/ })).toBeInTheDocument();
    expect(screen.getByText("C-2")).toBeInTheDocument();
    const note = document.querySelector(".ob-note")!;
    expect(note).toHaveAttribute("aria-live", "polite");
    expect(note).toHaveTextContent("+1 now apply");
    // Unticking it again would remove it.
    expect(screen.getByRole("checkbox", { name: "On-premises" })).toHaveAccessibleDescription(/−1/);
    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    expect(screen.queryByText("C-2")).not.toBeInTheDocument();
    expect(document.querySelector(".ob-note")).toHaveTextContent("−1 no longer apply");

    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    await next(user);
    // Sensitivity: High adds C-4. The radio that is selected says so.
    expect(screen.getByRole("radio", { name: "Confidential" })).toHaveAccessibleDescription(/\+1/);
    expect(screen.getByRole("radio", { name: "Public or internal only" })).toHaveAccessibleDescription(/No change/);
    await user.click(screen.getByRole("radio", { name: "Confidential" }));
    expect(screen.getByRole("radio", { name: "Confidential" })).toHaveAccessibleDescription(/Selected/);
    expect(screen.getByRole("radio", { name: "Public or internal only" })).toHaveAccessibleDescription(/−1/);
    expect(screen.getByRole("heading", { name: /4 Controls apply/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear my answer" }));
    expect(screen.getByRole("heading", { name: /3 Controls apply/ })).toBeInTheDocument();
  });

  it("asks the Framework questions as Yes/No, lists the other Frameworks as cards and shows the base as always included", async () => {
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    await user.click(screen.getByRole("button", { name: "Laws and standards" }));

    expect(screen.getByText("Does it hold personal data about people?")).toBeInTheDocument();
    expect(screen.getByText("Customers, employees, patients.")).toBeInTheDocument();
    expect(screen.getByText("Always included")).toBeInTheDocument();
    expect(screen.getByText(/ISO\/IEC 27001 2022 is the base Framework/)).toBeInTheDocument();

    const yes = screen.getByRole("radio", { name: "Yes" });
    expect(yes).toHaveAccessibleDescription(/\+1/);
    await user.click(yes);
    expect(screen.getByText("C-3")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByText("C-3")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "CSA CCM 4" }));
    expect(screen.getByText("C-7")).toBeInTheDocument();
  });

  it("changes the groups when a Provider is picked, and says a Provider that is not Onboarded counts once it is", async () => {
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    await user.click(screen.getByRole("button", { name: "Relies on" }));

    expect(screen.getByRole("checkbox", { name: "Landing Zone" })).toHaveAccessibleDescription(/Offers 2 of the 3 applicable Controls/);
    expect(screen.getByRole("checkbox", { name: "Landing Zone" })).toHaveAccessibleDescription(/2 change owner/);
    expect(screen.getByRole("checkbox", { name: "Backup Service" })).toHaveAccessibleDescription(/Its Offerings count once it is/);
    expect(screen.getByRole("heading", { name: /Covered for you . 0/ })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Landing Zone" }));
    expect(screen.getByRole("heading", { name: /You do this . 1/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Shared . 1/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Covered for you . 1/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Shared" })).toHaveTextContent("Shared with Landing Zone. Your part: Review the access list");
    expect(screen.getByRole("region", { name: "Covered for you" })).toHaveTextContent("Covered by Landing Zone");
    expect(screen.getByText("Title of C-5").closest("section")).toHaveAttribute("aria-label", "Covered for you");
    // The total does not change: Providers change who does the work.
    expect(screen.getByRole("heading", { name: /3 Controls apply, of 7/ })).toBeInTheDocument();
  });

  it("summarises the answers on the last step, with Edit links back, and creates the System with one request", async () => {
    const user = await setup();
    await user.type(screen.getByLabelText("System name"), "  Payroll  ");
    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    await user.click(screen.getByRole("button", { name: "Sensitivity" }));
    await user.click(screen.getByRole("radio", { name: "Confidential" }));
    await user.click(screen.getByRole("button", { name: "Laws and standards" }));
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Relies on" }));
    await user.click(screen.getByRole("checkbox", { name: "Landing Zone" }));
    await next(user);

    expect(questionTitle()).toHaveTextContent("Review and create");
    expect(screen.getByText("Step 7 of 7")).toBeInTheDocument();
    const rows = screen.getByText("Your answers").closest(".ob-sum") as HTMLElement;
    expect(within(rows).getByText("Delivery").nextElementSibling).toHaveTextContent("On-premises");
    expect(within(rows).getByText("Sensitivity").nextElementSibling).toHaveTextContent("Confidential (High)");
    expect(within(rows).getByText("Integrity").nextElementSibling).toHaveTextContent("Not answered");
    expect(within(rows).getByText("Downtime").nextElementSibling).toHaveTextContent("Not answered");
    expect(within(rows).getByText("Laws and standards").nextElementSibling).toHaveTextContent("GDPR 2016");
    expect(within(rows).getByText("Relies on").nextElementSibling).toHaveTextContent("Landing Zone");
    expect(screen.getByRole("img", { name: /Confidentiality high, Integrity not classified, Availability not classified/ })).toBeInTheDocument();
    expect(screen.getByText(/Controls apply\./)).toHaveTextContent("6 Controls apply. 4 need work from you; the rest are shared or already covered.");
    expect(screen.getByText(/Your answers can change later/)).toBeInTheDocument();

    // Edit goes back to the step, and the answer is kept.
    await user.click(screen.getByRole("button", { name: "Edit Sensitivity" }));
    expect(questionTitle()).toHaveTextContent("What is the most sensitive information in it?");
    expect(screen.getByRole("radio", { name: "Confidential" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Review" }));

    await user.type(screen.getByLabelText("Vendor (optional)"), "Acme");
    await user.type(screen.getByLabelText("Description (optional)"), "Pays people");
    await user.click(screen.getByRole("button", { name: "Create System" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/systems/sys1"));
    expect(postedBody()).toEqual({
      name: "Payroll",
      vendor: "Acme",
      description: "Pays people",
      confidentialityImpactLevel: "HIGH",
      deploymentFacetIds: ["f-prem"],
      frameworkScopeIds: ["gdpr"],
      providerIds: ["p1"],
    });
  });

  it("needs a name before it creates, and shows the server's refusal", async () => {
    vi.stubGlobal("fetch", mockFetch({ onPost: () => new Response(JSON.stringify({ error: "Only a System Owner, Risk Owner or Admin can create a System" }), { status: 403 }) }));
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(screen.getByRole("button", { name: "Create System" })).toBeDisabled();
    expect(screen.getByText(/Name the System at the top of the page/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("System name"), "Payroll");
    await user.click(screen.getByRole("button", { name: "Create System" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Only a System Owner, Risk Owner or Admin can create a System");
    expect(push).not.toHaveBeenCalled();
    // Only the name and a Facet are sent when nothing else was answered.
    expect(postedBody()).toMatchObject({ name: "Payroll", deploymentFacetIds: ["f-saas"], frameworkScopeIds: [], providerIds: [] });
    expect(postedBody()).not.toHaveProperty("confidentialityImpactLevel");
    expect(screen.getByRole("button", { name: "Create System" })).toBeEnabled();
  });

  it("lets a Control that leaves the list animate out, hidden and inert and not counted, then removes it", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    expect(screen.getByText("C-2")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    // Still in the DOM for the exit, but out of reach and out of the counts.
    const leaving = screen.getByText("C-2", { selector: ".code" }).closest("li")!;
    expect(leaving).toHaveClass("leaving");
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveAttribute("inert");
    expect(screen.queryByText("C-2", { ignore: "[aria-hidden=true] *" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /3 Controls apply, of 7/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /You do this . 3/ })).toBeInTheDocument();

    fireEvent.animationEnd(leaving);
    expect(screen.queryByText("C-2")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("removes a Control at once under reduced motion", async () => {
    const user = await setup();
    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    await user.click(screen.getByRole("checkbox", { name: "On-premises" }));
    expect(screen.queryByText("C-2")).not.toBeInTheDocument();
  });

  it("says so when the onboarding data can't be loaded", async () => {
    vi.stubGlobal("fetch", mockFetch({ catalogResponse: () => new Response(JSON.stringify({ error: "Only a System Owner, Risk Owner or Admin can create a System" }), { status: 403 }) }));
    render(<OnboardingInterview />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a System Owner, Risk Owner or Admin can create a System");
  });
});
