import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const reply = (ok: boolean, status: number, body: unknown) => ({ ok, status, json: async () => body });
import { ControlEditor } from "../ControlEditor";
import type { ControlEditView } from "../control-edit-data";
import { draftOf, draftProblems, editBody, exampleLines } from "../control-edit-logic";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function view(over: Partial<ControlEditView["control"]> = {}): ControlEditView {
  return {
    control: {
      id: "c1",
      code: "A.5.3",
      title: "Segregation",
      description: "Keep duties apart.",
      category: "Organizational",
      mandatory: true,
      applicability: "BOTH",
      question: "Do you?",
      intent: null,
      examples: ["One", "Two"],
      deploymentFacetIds: ["f1"],
      minSensitivityLevel: 2,
      minIntegrityImpactLevel: null,
      minAvailabilityImpactLevel: "HIGH",
      ownerId: "u9",
      ownerName: "Gone Owner",
      ...over,
    },
    deploymentFacets: [
      { id: "f1", name: "Cloud" },
      { id: "f2", name: "On-premises" },
    ],
    owners: [{ id: "u1", name: "Olive" }],
    sensitivityLevels: [1, 2, 3, 4, 5].map((level) => ({ level, label: `Level ${level}`, description: `d${level}`, textColor: "#000", backgroundColor: "#fff" })),
    mappedFrameworks: [{ id: "fw1", label: "ISO/IEC 27001:2022" }],
  };
}

describe("control-edit-logic (#314)", () => {
  it("sends nothing when nothing changed, and only what changed otherwise", () => {
    const v = view().control;
    expect(editBody(v, draftOf(v))).toEqual({});
    expect(editBody(v, { ...draftOf(v), title: "  New  ", intent: "Why", examples: "One\n\n Three " })).toEqual({ title: "New", intent: "Why", examples: ["One", "Three"] });
    expect(editBody(v, { ...draftOf(v), ownerId: "" })).toEqual({ ownerId: null });
    expect(editBody(v, { ...draftOf(v), deploymentFacetIds: ["f1", "f2"], minSensitivityLevel: null })).toEqual({ deploymentFacetIds: ["f1", "f2"], minSensitivityLevel: null });
  });

  it("never sends the fields an Organizational Control doesn't have", () => {
    const v = view({ applicability: "ORGANIZATIONAL", question: null }).control;
    const body = editBody(v, { ...draftOf(v), question: "Q?", examples: "x", deploymentFacetIds: ["f2"], minSensitivityLevel: 4, mandatory: false });
    expect(body).toEqual({ mandatory: false });
  });

  it("flags empty required fields, and a cleared question only on a Control that had one", () => {
    const v = view().control;
    expect(draftProblems(v, { ...draftOf(v), title: " ", question: "" })).toEqual(["Title is required.", "A Per-System or Both Control needs a Self-Assessment Question."]);
    const none = view({ question: null }).control;
    expect(draftProblems(none, draftOf(none))).toEqual([]);
    expect(exampleLines("a\n\n b ")).toEqual(["a", "b"]);
  });
});

describe("ControlEditor (#314)", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps Save off until something changes, then sends only the changed fields and returns to the tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(true, 200, { control: {} }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ControlEditor view={view()} returnTab="systems" />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Segregation of duties" } });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/controls/c1");
    expect(init.method).toBe("PATCH");
    // The current owner isn't in the picker's list; a Save that never touched it must not clear it.
    expect(JSON.parse(init.body)).toEqual({ title: "Segregation of duties" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/controls/A.5.3?tab=systems"));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows a refusal in place and stays on the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(false, 400, { error: "Invalid update" })));
    render(<ControlEditor view={view()} returnTab={null} />);
    await userEvent.click(screen.getByLabelText("Mandatory"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid update");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("shows a network failure in place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ControlEditor view={view()} returnTab={null} />);
    await userEvent.click(screen.getByLabelText("Mandatory"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not reach the server/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("offers no scoping or question fields for an Organizational Control, and links the mapping editor", () => {
    render(<ControlEditor view={view({ applicability: "ORGANIZATIONAL", question: null })} returnTab={null} />);
    expect(screen.queryByLabelText("Self-Assessment Question")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Deployment Facets/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ISO/IEC 27001:2022" })).toHaveAttribute("href", "/admin/frameworks/fw1");
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/controls/A.5.3");
  });

  it("blocks a Save with an empty title and says why", async () => {
    render(<ControlEditor view={view()} returnTab={null} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    expect(screen.getByText("Title is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
