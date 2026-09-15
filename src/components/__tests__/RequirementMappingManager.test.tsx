import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequirementMappingManager } from "../RequirementMappingManager";

const baseRequirement = {
  description: "desc",
  category: "Security",
  mandatory: true,
  question: null,
  intent: null,
  examples: [] as string[],
  deploymentFacets: [] as { id: string; name: string }[],
  regulatoryOverlays: [] as { id: string; name: string }[],
  capabilities: [] as { id: string; name: string }[],
  frameworks: [] as { id: string; name: string }[],
  minConfidentialityImpactLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
};

let requirements = [
  {
    ...baseRequirement,
    id: "r1",
    code: "A.5.3",
    title: "Segregation of duties",
    applicability: "BOTH",
  },
  {
    ...baseRequirement,
    id: "r2",
    code: "A.5.1",
    title: "Policies for information security",
    applicability: "ORGANIZATIONAL",
  },
];
const deploymentFacets = [{ id: "st1", name: "On-Premises Datacenter" }];
const regulatoryOverlays = [{ id: "o1", name: "GDPR" }];
const capabilities = [{ id: "c1", name: "Active Directory" }];
const frameworks = [
  { id: "f1", name: "ISO27001:2022 Annex A" },
  { id: "f2", name: "CSA CCM 4.0" },
];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/requirements") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ requirements }), { status: 200 }));
    }
    if (url.endsWith("/api/deployment-facets") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ deploymentFacets }), { status: 200 }));
    }
    if (url.endsWith("/api/regulatory-overlays") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ regulatoryOverlays }), { status: 200 }));
    }
    if (url.endsWith("/api/capabilities") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ capabilities }), { status: 200 }));
    }
    if (url.endsWith("/api/frameworks") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ frameworks }), { status: 200 }));
    }
    if (url.includes("/api/requirements/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ requirement: {} }), { status: 200 }));
    }
    if (url.endsWith("/api/requirements") && method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ requirement: { id: "r3" } }), { status: 201 }),
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("RequirementMappingManager", () => {
  beforeEach(() => {
    requirements = [
      { ...baseRequirement, id: "r1", code: "A.5.3", title: "Segregation of duties", applicability: "BOTH" },
      {
        ...baseRequirement,
        id: "r2",
        code: "A.5.1",
        title: "Policies for information security",
        applicability: "ORGANIZATIONAL",
      },
    ];
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists Requirements with a tag summary", async () => {
    render(<RequirementMappingManager />);
    expect(await screen.findByText("A.5.3")).toBeInTheDocument();
    expect(screen.getByText("A.5.1")).toBeInTheDocument();
  });

  it("lets an admin scope a Requirement to a Deployment Facet and save", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await user.selectOptions(await screen.findByLabelText("Requirement"), "r1");
    await user.click(screen.getByLabelText("On-Premises Datacenter"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/requirements/r1") && init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall![1].body)).toEqual({
        capabilityIds: [],
        frameworkIds: [],
        deploymentFacetIds: ["st1"],
        regulatoryOverlayIds: [],
        minConfidentialityImpactLevel: null,
        minIntegrityImpactLevel: null,
        minAvailabilityImpactLevel: null,
      });
    });
  });

  it("lets an admin scope a Requirement to a Regulatory Overlay and save", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await user.selectOptions(await screen.findByLabelText("Requirement"), "r1");
    await user.click(screen.getByLabelText("GDPR"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/requirements/r1") && init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body);
      expect(body.regulatoryOverlayIds).toEqual(["o1"]);
    });
  });

  it("lets an admin tag a Requirement with Frameworks", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await user.selectOptions(await screen.findByLabelText("Requirement"), "r1");
    await user.click(screen.getByLabelText("ISO27001:2022 Annex A"));
    await user.click(screen.getByLabelText("CSA CCM 4.0"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/requirements/r1") && init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body);
      expect(body.frameworkIds).toEqual(["f1", "f2"]);
    });
  });

  it("hides Deployment Facet, Regulatory Overlay, and Impact Level selection for an ORGANIZATIONAL requirement", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await user.selectOptions(await screen.findByLabelText("Requirement"), "r2");

    expect(screen.queryByLabelText("On-Premises Datacenter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("GDPR")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Min. Confidentiality")).not.toBeInTheDocument();
    expect(screen.getByText(/never assessed per System/)).toBeInTheDocument();
  });

  it("creates a new Requirement via the create form", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await screen.findByLabelText("Requirement");
    await user.click(screen.getByRole("button", { name: "+ New Requirement" }));

    await user.type(screen.getByLabelText("Code"), "SEC-042");
    await user.type(screen.getByLabelText("Title"), "Encryption at rest");
    await user.type(screen.getByLabelText("Description"), "desc");
    await user.type(screen.getByLabelText("Category"), "Security");
    await user.selectOptions(screen.getByLabelText("Applicability"), "ORGANIZATIONAL");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/requirements") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        code: "SEC-042",
        title: "Encryption at rest",
        applicability: "ORGANIZATIONAL",
      });
    });
    // Bumped from the 5s default: this test's initial render now waits on
    // five parallel mocked fetches (added /api/frameworks alongside the
    // existing four catalogs — see #55), which occasionally pushes total
    // time close to/over 5s under load, unrelated to test correctness.
  }, 10000);
});
