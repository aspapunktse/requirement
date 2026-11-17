import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingInterview } from "../OnboardingInterview";
import type { OnboardingCatalog, OnboardingControl } from "@/lib/onboarding-interview";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const control = (code: string, patch: Partial<OnboardingControl> = {}): OnboardingControl => ({
  id: `id-${code}`,
  code,
  title: `Title of ${code}`,
  applicability: "PER_SYSTEM",
  deploymentFacetIds: [],
  minSensitivityLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
  frameworkIds: ["base"],
  organizationFulfilled: false,
  offerings: [],
  ...patch,
});

const catalog: OnboardingCatalog = {
  sensitivityLevels: [
    { level: 1, label: "Public", description: "Information anyone may see." },
    { level: 2, label: "Internal", description: "Everyday business information." },
    { level: 3, label: "Sensitive", description: "Would cause harm if it leaked." },
    { level: 4, label: "Highly Sensitive", description: "Would seriously harm people." },
    { level: 5, label: "Critical Sensitivity", description: "Would threaten the organisation." },
  ],
  informationTypes: [
    { id: "it-code", name: "Source code", description: "Our own software", sensitivityLevel: 3, suggestedFrameworkIds: [] },
    { id: "it-pay", name: "Payroll", description: "Salaries and bank details", sensitivityLevel: 4, suggestedFrameworkIds: [] },
  ],
  deploymentFacets: [
    { id: "f-saas", name: "Software as a service", description: "We subscribe to it and log in", requiresVendorDetails: false },
    { id: "f-prem", name: "On-premises", description: "We run it in our own data centre", requiresVendorDetails: false },
    { id: "f-vendor", name: "Bought as a service", description: "A vendor runs it for us", requiresVendorDetails: true },
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
    control("C-4", { minSensitivityLevel: 4 }),
    control("C-5", { offerings: [{ providerId: "p1", type: "FULL", customerResponsibility: null, fulfilled: true }] }),
    control("C-6", { offerings: [{ providerId: "p1", type: "SHARED", customerResponsibility: "Review the access list", fulfilled: false }] }),
    control("C-7", { frameworkIds: ["ccm"] }),
  ],
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let classification: { status: number; body: unknown };

beforeEach(() => {
  push.mockClear();
  calls = [];
  classification = {
    status: 200,
    body: {
      classification: {
        deploymentFacetIds: ["f-saas", "f-gone"],
        informationTypeIds: ["it-pay", "it-gone"],
        sensitivityLevel: 4,
        integrityImpactLevel: "HIGH",
        availabilityImpactLevel: "MODERATE",
        frameworkScopeIds: ["gdpr", "base", "fw-gone"],
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/system-onboarding")) return Promise.resolve(new Response(JSON.stringify(catalog), { status: 200 }));
      if (url.endsWith("/api/systems") && init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ system: { id: "sys-new" } }), { status: 201 }));
      if (url.endsWith("/api/systems/bso-candidates")) return Promise.resolve(new Response(JSON.stringify({ users: [] }), { status: 200 }));
      if (url.endsWith("/classification")) return Promise.resolve(new Response(JSON.stringify(classification.body), { status: classification.status }));
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const comparison = { id: "cmp-1", name: "New HR system 2027", candidates: [{ systemId: "s-alpha", name: "Alpha" }] };
const posted = () => JSON.parse(String(calls.find((call) => call.init?.method === "POST")!.init!.body));

async function open(withComparison = true) {
  const user = userEvent.setup();
  render(<OnboardingInterview comparison={withComparison ? comparison : undefined} />);
  await screen.findByRole("heading", { name: "What is the system?" });
  return user;
}

async function nameAndCreate(user: ReturnType<typeof userEvent.setup>, name: string, facet?: string) {
  await user.click(screen.getByLabelText("System name"));
  await user.paste(name);
  await user.click(screen.getByRole("button", { name: "Next" }));
  if (facet) await user.click(await screen.findByRole("checkbox", { name: facet }));
  await user.click(await screen.findByRole("button", { name: "Review" }));
  await user.click(screen.getByRole("button", { name: "Create System" }));
}

describe("OnboardingInterview started from a Comparison (#374)", () => {
  it("says the System becomes a Candidate, and offers a start from each Candidate the reader can open", async () => {
    await open();
    expect(screen.getByTestId("ob-comparison")).toHaveTextContent("This System becomes a Candidate in the Comparison New HR system 2027");
    expect(screen.getByRole("button", { name: "Start from Alpha's classification" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Start from / })).toHaveLength(1);
  });

  it("shows none of it outside a Comparison", async () => {
    await open(false);
    expect(screen.queryByTestId("ob-comparison")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Start from / })).not.toBeInTheDocument();
  });

  it("pre-fills only the classification, leaves out what the catalog doesn't offer, and keeps the name and the rest empty", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Start from Alpha's classification" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Started from Alpha's classification");
    const read = calls.find((call) => call.url.endsWith("/classification"))!;
    expect(read.url).toBe("/api/comparisons/cmp-1/candidates/s-alpha/classification");
    expect(screen.getByLabelText("System name")).toHaveValue("");

    await nameAndCreate(user, "Newcomer");
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(posted()).toEqual({
      name: "Newcomer",
      comparisonId: "cmp-1",
      sensitivityLevel: 4,
      informationTypeIds: ["it-pay"],
      integrityImpactLevel: "HIGH",
      availabilityImpactLevel: "MODERATE",
      deploymentFacetIds: ["f-saas"],
      frameworkScopeIds: ["gdpr"],
      providerIds: [],
    });
  });

  it("creates the System into the Comparison and returns to it", async () => {
    const user = await open();
    await nameAndCreate(user, "Newcomer", "On-premises");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/comparisons/cmp-1"));
    expect(posted().comparisonId).toBe("cmp-1");
  });

  it("sends no comparisonId and goes to the new System's page outside a Comparison", async () => {
    const user = await open(false);
    await nameAndCreate(user, "Plain", "On-premises");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/systems/sys-new"));
    expect(posted()).not.toHaveProperty("comparisonId");
  });

  it("shows the refusal and fills nothing when the classification can't be read", async () => {
    classification = { status: 404, body: { error: "Candidate not found" } };
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Start from Alpha's classification" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Candidate not found");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
