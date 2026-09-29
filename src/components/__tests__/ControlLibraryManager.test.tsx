import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlLibraryManager } from "../ControlLibraryManager";

const baseControl = {
  description: "desc",
  category: "Security",
  mandatory: true,
  question: null,
  intent: null,
  examples: [] as string[],
  deploymentFacets: [] as { id: string; name: string }[],
  regulatoryOverlays: [] as { id: string; name: string }[],
  capabilities: [] as { id: string; name: string }[],
  mappings: [] as {
    id: string;
    coverage: "FULL" | "PARTIAL";
    requirement: {
      id: string;
      code: string;
      title: string;
      framework: { id: string; name: string; version: string; status?: "DRAFT" | "PUBLISHED" };
    };
  }[],
  minConfidentialityImpactLevel: null,
  minIntegrityImpactLevel: null,
  minAvailabilityImpactLevel: null,
};

let controls = [
  {
    ...baseControl,
    id: "r1",
    code: "A.5.3",
    title: "Segregation of duties",
    applicability: "BOTH",
  },
  {
    ...baseControl,
    id: "r2",
    code: "A.5.1",
    title: "Policies for information security",
    applicability: "ORGANIZATIONAL",
  },
];
const deploymentFacets = [{ id: "st1", name: "On-Premises Datacenter" }];
const regulatoryOverlays = [{ id: "o1", name: "GDPR" }];
const capabilities = [{ id: "c1", name: "Active Directory" }];
const iso = { id: "f1", name: "ISO/IEC 27001", version: "2022" };
const nis2 = { id: "f2", name: "NIS2", version: "2022" };

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/controls") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ controls }), { status: 200 }));
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
    if (url.includes("/api/controls/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ control: {} }), { status: 200 }));
    }
    if (url.endsWith("/api/controls") && method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ control: { id: "r3" } }), { status: 201 }),
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("ControlLibraryManager", () => {
  beforeEach(() => {
    controls = [
      { ...baseControl, id: "r1", code: "A.5.3", title: "Segregation of duties", applicability: "BOTH" },
      {
        ...baseControl,
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

  it("lists Controls with a tag summary", async () => {
    render(<ControlLibraryManager />);
    expect(await screen.findByText("A.5.3")).toBeInTheDocument();
    expect(screen.getByText("A.5.1")).toBeInTheDocument();
  });

  it("lets an admin scope a Control to a Deployment Facet and save", async () => {
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r1");
    await user.click(screen.getByLabelText("On-Premises Datacenter"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/controls/r1") && init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall![1].body)).toEqual({
        capabilityIds: [],
        deploymentFacetIds: ["st1"],
        regulatoryOverlayIds: [],
        minConfidentialityImpactLevel: null,
        minIntegrityImpactLevel: null,
        minAvailabilityImpactLevel: null,
      });
    });
  });

  it("lets an admin scope a Control to a Regulatory Overlay and save", async () => {
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r1");
    await user.click(screen.getByLabelText("GDPR"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/controls/r1") && init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body);
      expect(body.regulatoryOverlayIds).toEqual(["o1"]);
    });
  });

  it("shows a read-only Satisfies line derived from Control Mappings, with no Framework picker", async () => {
    controls[0] = {
      ...controls[0],
      mappings: [
        {
          id: "m2",
          coverage: "PARTIAL",
          requirement: { id: "q2", code: "Art. 21(2)(h)", title: "Basic cyber hygiene", framework: nis2 },
        },
        {
          id: "m1",
          coverage: "FULL",
          requirement: { id: "q1", code: "A.5.3", title: "Segregation of duties", framework: iso },
        },
      ],
    };
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r1");

    expect(
      screen.getByText("Satisfies: ISO/IEC 27001:2022 A.5.3, NIS2:2022 Art. 21(2)(h) (partial)"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Frameworks\/standards satisfied/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ISO/IEC 27001")).not.toBeInTheDocument();
  });

  it("shows the reverse view: every Requirement mapped to the Control, across Frameworks", async () => {
    controls[0] = {
      ...controls[0],
      mappings: [
        {
          id: "m2",
          coverage: "PARTIAL",
          requirement: {
            id: "q2",
            code: "Art. 21(2)(h)",
            title: "Basic cyber hygiene",
            framework: { ...nis2, status: "DRAFT" },
          },
        },
        {
          id: "m1",
          coverage: "FULL",
          requirement: { id: "q1", code: "A.5.3", title: "Segregation of duties", framework: iso },
        },
      ],
    };
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r1");

    const list = screen.getByRole("list", { name: "Requirements mapped to A.5.3" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("ISO/IEC 27001:2022 A.5.3 — Segregation of duties · Full coverage");
    expect(items[1]).toHaveTextContent(
      "NIS2:2022 Art. 21(2)(h) — Basic cyber hygiene · Partial coverage · Draft Framework",
    );
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/admin/frameworks/f1");
  });

  it("says so when a Control satisfies no Requirement yet", async () => {
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r1");

    expect(screen.getByText("Satisfies: no Framework Requirement yet")).toBeInTheDocument();
  });

  it("hides Deployment Facet, Regulatory Overlay, and Impact Level selection for an ORGANIZATIONAL control", async () => {
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await user.selectOptions(await screen.findByLabelText("Control"), "r2");

    expect(screen.queryByLabelText("On-Premises Datacenter")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("GDPR")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Min. Confidentiality")).not.toBeInTheDocument();
    expect(screen.getByText(/never assessed per System/)).toBeInTheDocument();
  });

  it("creates a new Control via the create form", async () => {
    const user = userEvent.setup();
    render(<ControlLibraryManager />);

    await screen.findByLabelText("Control");
    await user.click(screen.getByRole("button", { name: "+ New Control" }));

    await user.type(screen.getByLabelText("Code"), "SEC-042");
    await user.type(screen.getByLabelText("Title"), "Encryption at rest");
    await user.type(screen.getByLabelText("Description"), "desc");
    await user.type(screen.getByLabelText("Category"), "Security");
    await user.selectOptions(screen.getByLabelText("Applicability"), "ORGANIZATIONAL");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/controls") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        code: "SEC-042",
        title: "Encryption at rest",
        applicability: "ORGANIZATIONAL",
      });
    });
    // Bumped from the 5s default: the initial render waits on several
    // parallel mocked fetches, which occasionally pushes total time
    // close to/over 5s under load, unrelated to test correctness.
  }, 10000);
});
