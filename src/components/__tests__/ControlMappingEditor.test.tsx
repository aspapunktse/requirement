import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlMappingEditor, type MappedControl } from "../ControlMappingEditor";

const controls = [
  { id: "c1", code: "A.5.1", title: "Policies for information security" },
  { id: "c2", code: "A.8.24", title: "Use of cryptography" },
  { id: "c3", code: "A.8.25", title: "Secure development life cycle" },
];
const mapped: MappedControl = {
  id: "m1",
  coverage: "FULL",
  rationale: null,
  control: { id: "c1", code: "A.5.1", title: "Policies for information security" },
};

const onChanged = vi.fn(async () => {});
let respond: (url: string, init?: RequestInit) => Response;

function renderEditor(mappings: MappedControl[] = []) {
  return render(
    <ControlMappingEditor
      frameworkId="f1"
      requirementId="q1"
      requirementCode="Art. 21"
      mappings={mappings}
      controls={controls}
      onChanged={onChanged}
    />,
  );
}

function calls(method: string) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === method);
}

describe("ControlMappingEditor", () => {
  beforeEach(() => {
    onChanged.mockClear();
    respond = () => new Response(JSON.stringify({ mapping: {} }), { status: 200 });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => Promise.resolve(respond(String(input), init))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls a Requirement with no mappings a Coverage Gap", () => {
    renderEditor();
    expect(screen.getByText(/No Controls mapped yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Map Control" })).toBeDisabled();
  });

  it("filters the Control picker by code or title and hides Controls that are already mapped", async () => {
    const user = userEvent.setup();
    renderEditor([mapped]);
    const picker = screen.getByLabelText("Control to map to Art. 21");

    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select a Control (2)…",
      "A.8.24 — Use of cryptography",
      "A.8.25 — Secure development life cycle",
    ]);

    await user.type(screen.getByLabelText("Search Controls to map to Art. 21"), "crypto");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select a Control (1)…",
      "A.8.24 — Use of cryptography",
    ]);

    await user.clear(screen.getByLabelText("Search Controls to map to Art. 21"));
    await user.type(screen.getByLabelText("Search Controls to map to Art. 21"), "zzz");
    expect(within(picker).getByRole("option")).toHaveTextContent("No matching Controls");
  });

  it("adds a mapping with the chosen Coverage and rationale, then reloads", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText("Search Controls to map to Art. 21"), "A.8.24");
    await user.selectOptions(screen.getByLabelText("Control to map to Art. 21"), "c2");
    await user.selectOptions(screen.getByLabelText("Coverage for the new mapping on Art. 21"), "PARTIAL");
    await user.type(screen.getByLabelText("Rationale for the new mapping on Art. 21"), "  Only covers keys ");
    await user.click(screen.getByRole("button", { name: "Map Control" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    const [url, init] = calls("POST")[0];
    expect(url).toBe("/api/frameworks/f1/requirements/q1/mappings");
    expect(JSON.parse(init.body)).toEqual({ controlId: "c2", coverage: "PARTIAL", rationale: "Only covers keys" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    // The form resets.
    await waitFor(() => expect(screen.getByLabelText("Search Controls to map to Art. 21")).toHaveValue(""));
    expect(screen.getByLabelText("Coverage for the new mapping on Art. 21")).toHaveValue("FULL");
  });

  it("changes Coverage on an existing mapping with a PATCH", async () => {
    const user = userEvent.setup();
    renderEditor([mapped]);

    await user.selectOptions(screen.getByLabelText("Coverage of A.5.1 for Art. 21"), "PARTIAL");

    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    const [url, init] = calls("PATCH")[0];
    expect(url).toBe("/api/frameworks/f1/requirements/q1/mappings/m1");
    expect(JSON.parse(init.body)).toEqual({ coverage: "PARTIAL" });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("saves an edited rationale on blur, and not when it did not change", async () => {
    const user = userEvent.setup();
    renderEditor([{ ...mapped, rationale: "Old" }]);
    const rationale = screen.getByLabelText("Rationale for A.5.1 on Art. 21");

    await user.click(rationale);
    await user.tab();
    expect(calls("PATCH")).toHaveLength(0);

    await user.clear(rationale);
    await user.type(rationale, "New reason");
    await user.tab();
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ rationale: "New reason" });
  });

  it("removes a mapping with a DELETE", async () => {
    const user = userEvent.setup();
    renderEditor([mapped]);

    await user.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/frameworks/f1/requirements/q1/mappings/m1");
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows the server's error and does not reload when a change is refused", async () => {
    respond = () =>
      new Response(JSON.stringify({ error: "This Requirement is already mapped to that Control" }), { status: 409 });
    const user = userEvent.setup();
    renderEditor();

    await user.selectOptions(screen.getByLabelText("Control to map to Art. 21"), "c2");
    await user.click(screen.getByRole("button", { name: "Map Control" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already mapped to that Control");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
