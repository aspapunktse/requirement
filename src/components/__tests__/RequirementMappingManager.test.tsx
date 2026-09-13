import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequirementMappingManager } from "../RequirementMappingManager";

const requirements = [
  {
    id: "r1",
    code: "A.5.3",
    title: "Segregation of duties",
    applicability: "BOTH",
    systemTypes: [],
    capabilities: [],
  },
  {
    id: "r2",
    code: "A.5.1",
    title: "Policies for information security",
    applicability: "ORGANIZATIONAL",
    systemTypes: [],
    capabilities: [],
  },
];
const systemTypes = [{ id: "st1", name: "On-Premises Datacenter" }];
const capabilities = [{ id: "c1", name: "Active Directory" }];

function mockFetch() {
  return vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/requirements") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ requirements }), { status: 200 }));
    }
    if (url.endsWith("/api/system-types") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ systemTypes }), { status: 200 }));
    }
    if (url.endsWith("/api/capabilities") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({ capabilities }), { status: 200 }));
    }
    if (url.includes("/api/requirements/") && method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({ requirement: {} }), { status: 200 }));
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
}

describe("RequirementMappingManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets an admin scope a Requirement to a System Type and save", async () => {
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
        systemTypeIds: ["st1"],
      });
    });
  });

  it("hides System Type selection for an ORGANIZATIONAL requirement", async () => {
    const user = userEvent.setup();
    render(<RequirementMappingManager />);

    await user.selectOptions(await screen.findByLabelText("Requirement"), "r2");

    expect(screen.queryByLabelText("On-Premises Datacenter")).not.toBeInTheDocument();
    expect(screen.getByText(/never assessed per System/)).toBeInTheDocument();
  });
});
