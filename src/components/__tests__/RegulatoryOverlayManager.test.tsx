import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegulatoryOverlayManager } from "../RegulatoryOverlayManager";

const regulatoryOverlays = [{ id: "o1", name: "GDPR", description: "EU personal data" }];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/regulatory-overlays") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ regulatoryOverlays }), { status: 200 }));
    }
    if (url.endsWith("/api/regulatory-overlays") && method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ regulatoryOverlay: {} }), { status: 201 }));
    }
    if (url.includes("/api/regulatory-overlays/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ regulatoryOverlay: {} }), { status: 200 }));
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("RegulatoryOverlayManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists existing Regulatory Overlays, wired to /api/regulatory-overlays", async () => {
    render(<RegulatoryOverlayManager />);
    expect(await screen.findByDisplayValue("GDPR")).toBeInTheDocument();
  });

  it("submits a new Regulatory Overlay via the create form", async () => {
    const user = userEvent.setup();
    render(<RegulatoryOverlayManager />);
    await screen.findByDisplayValue("GDPR");

    await user.type(screen.getByLabelText("Name"), "EAR/ITAR");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([url, init]) =>
          typeof url === "string" && url.endsWith("/api/regulatory-overlays") && init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({ name: "EAR/ITAR" });
    });
  });
});
