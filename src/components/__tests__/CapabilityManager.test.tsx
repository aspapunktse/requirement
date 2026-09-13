import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityManager } from "../CapabilityManager";

const capabilities = [{ id: "c1", name: "Active Directory", description: "Central directory" }];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/capabilities") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ capabilities }), { status: 200 }));
    }
    if (url.endsWith("/api/capabilities") && method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ capability: {} }), { status: 201 }));
    }
    if (url.includes("/api/capabilities/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ capability: {} }), { status: 200 }));
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("CapabilityManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists existing Capabilities, wired to /api/capabilities", async () => {
    render(<CapabilityManager />);
    expect(await screen.findByDisplayValue("Active Directory")).toBeInTheDocument();
  });

  it("submits a new Capability via the create form", async () => {
    const user = userEvent.setup();
    render(<CapabilityManager />);
    await screen.findByDisplayValue("Active Directory");

    await user.type(screen.getByLabelText("Name"), "Central IAM/SSO");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/capabilities") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({ name: "Central IAM/SSO" });
    });
  });
});
