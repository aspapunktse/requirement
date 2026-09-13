import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemTypeManager } from "../SystemTypeManager";

const systemTypes = [{ id: "st1", name: "On-Premises Datacenter", description: "Our own DC" }];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/system-types") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ systemTypes }), { status: 200 }));
    }
    if (url.endsWith("/api/system-types") && method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ systemType: {} }), { status: 201 }));
    }
    if (url.includes("/api/system-types/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ systemType: {} }), { status: 200 }));
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("SystemTypeManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists existing System Types", async () => {
    render(<SystemTypeManager />);
    expect(await screen.findByDisplayValue("On-Premises Datacenter")).toBeInTheDocument();
  });

  it("submits a new System Type via the create form", async () => {
    const user = userEvent.setup();
    render(<SystemTypeManager />);
    await screen.findByDisplayValue("On-Premises Datacenter");

    await user.type(screen.getByLabelText("Name"), "Cloud IaaS/PaaS");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toMatchObject({ name: "Cloud IaaS/PaaS" });
    });
  });

  it("saves an edited description", async () => {
    const user = userEvent.setup();
    render(<SystemTypeManager />);
    await screen.findByDisplayValue("On-Premises Datacenter");

    const textarea = screen.getByLabelText("Description for On-Premises Datacenter");
    await user.clear(textarea);
    await user.type(textarea, "Updated description");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall![1].body)).toEqual({
        name: "On-Premises Datacenter",
        description: "Updated description",
      });
    });
  });

  it("saves an edited name", async () => {
    const user = userEvent.setup();
    render(<SystemTypeManager />);
    await screen.findByDisplayValue("On-Premises Datacenter");

    const nameInput = screen.getByLabelText("Name for On-Premises Datacenter");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Type");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall![1].body)).toEqual({
        name: "Renamed Type",
        description: "Our own DC",
      });
    });
  });
});
