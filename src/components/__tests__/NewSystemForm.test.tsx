import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSystemForm } from "../NewSystemForm";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const deploymentFacets = [{ id: "st1", name: "On-Premises Datacenter" }];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/deployment-facets") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ deploymentFacets }), { status: 200 }));
    }
    if (url.endsWith("/api/systems") && method === "POST") {
      return Promise.resolve(
        new Response(JSON.stringify({ system: { id: "sys1" } }), { status: 201 }),
      );
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("NewSystemForm", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a System and navigates to its detail page", async () => {
    const user = userEvent.setup();
    render(<NewSystemForm />);

    await user.type(await screen.findByLabelText("Name"), "My New System");
    await user.click(screen.getByLabelText("On-Premises Datacenter"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/systems") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        name: "My New System",
        deploymentFacetIds: ["st1"],
      });
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/systems/sys1"));
  });

  it("includes a selected Impact Level axis in the create request", async () => {
    const user = userEvent.setup();
    render(<NewSystemForm />);

    await user.type(await screen.findByLabelText("Name"), "Impact Level System");
    await user.click(screen.getByLabelText("On-Premises Datacenter"));
    await user.selectOptions(screen.getByLabelText("Confidentiality"), "HIGH");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/systems") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({
        confidentialityImpactLevel: "HIGH",
      });
    });
  });

  it("shows a server error without navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/deployment-facets") && method === "GET") {
          return Promise.resolve(new Response(JSON.stringify({ deploymentFacets }), { status: 200 }));
        }
        if (url.endsWith("/api/systems") && method === "POST") {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Deployment Facet not found" }), { status: 400 }),
          );
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(<NewSystemForm />);

    await user.type(await screen.findByLabelText("Name"), "Doomed System");
    await user.click(screen.getByLabelText("On-Premises Datacenter"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Deployment Facet not found")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
