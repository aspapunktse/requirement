import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRequirementRow } from "@/lib/document-requirement";
import { DocumentRequirementsRegister } from "../DocumentRequirementsRegister";

const rows: DocumentRequirementRow[] = [
  { id: "d1", name: "Test Architecture description", description: "How the System is built.", stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] },
  { id: "d2", name: "Test DPIA", description: null, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] },
  { id: "d3", name: "Test Operations handover", description: "Runbooks.", stage: "SECOND_ROUND", tracks: ["FULL"] },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderRegister(canCurate: boolean) {
  return render(<DocumentRequirementsRegister initialRequirements={rows} canCurate={canCurate} />);
}
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DocumentRequirementsRegister: read-only (#323)", () => {
  it("lists each requirement with its stage and Tracks, first documentation first, and offers no editing", () => {
    renderRegister(false);
    const body = within(screen.getByRole("table", { name: "Document Requirements" })).getAllByRole("row").slice(1);
    expect(body.map((row) => within(row).getAllByRole("cell").slice(0, 3).map((cell) => cell.textContent))).toEqual([
      ["Test Architecture descriptionHow the System is built.", "First documentation", "Full"],
      ["Test DPIA", "Second round", "SelfFull"],
      ["Test Operations handoverRunbooks.", "Second round", "Full"],
    ]);
    expect(screen.queryByRole("button", { name: "Add Document Requirement" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByText(/Only the Compliance Manager or an Admin changes the catalogue/)).toBeInTheDocument();
  });

  it("opens a requirement read-only, with no form", async () => {
    renderRegister(false);
    await userEvent.click(screen.getByRole("button", { name: "Open Test DPIA" }));
    const dialog = await screen.findByRole("dialog", { name: "Test DPIA" });
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).getByText("No description.")).toBeInTheDocument();
    expect(within(dialog).getByText("Second round")).toBeInTheDocument();
    expect(within(within(dialog).getByRole("list", { name: "Tracks" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Self", "Full"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("filters by stage and by search", async () => {
    renderRegister(false);
    await userEvent.click(screen.getByRole("button", { name: "Second round: 2 requirements" }));
    expect(screen.queryByRole("button", { name: "Open Test Architecture description" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Test DPIA" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Document Requirements" }), "runbooks");
    expect(screen.queryByRole("button", { name: "Open Test DPIA" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Test Operations handover" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 Document Requirements")).toBeInTheDocument();
  });
});

describe("DocumentRequirementsRegister: curator (#323)", () => {
  it("adds a requirement: Self is offered for second round and the route's row joins the table", async () => {
    const created: DocumentRequirementRow = { id: "d9", name: "Test New", description: null, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] };
    const fetchMock = vi.fn().mockResolvedValue(json({ documentRequirement: created }, 201));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Add Document Requirement" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a Document Requirement" });
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "  Test New ");
    await userEvent.click(within(dialog).getByRole("radio", { name: /Second round/ }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Self" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Full" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/document-requirements");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Test New", description: null, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] });
    expect(rowOf("Test New")).toBeInTheDocument();
    expect(screen.getByText(/Added Test New\./)).toBeInTheDocument();
  });

  it("choosing first documentation drops Self and disables it with the reason", async () => {
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit Test DPIA" }));
    const dialog = await screen.findByRole("dialog", { name: "Test DPIA" });
    const self = within(dialog).getByRole("checkbox", { name: "Self" });
    expect(self).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: /First documentation/ }));
    expect(self).not.toBeChecked();
    expect(self).toBeDisabled();
    expect(within(dialog).getByText(/First documentation is a Full-track stage/)).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Full" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Second round/ }));
    expect(self).toBeEnabled();
  });

  it("saves an edit with PATCH and shows the route's error (duplicate name) without closing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "A Document Requirement with that name already exists." }, 409))
      .mockResolvedValueOnce(json({ documentRequirement: { ...rows[2], name: "Test Handover" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Operations handover" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Operations handover" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Test Handover");
    await userEvent.click(save);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/document-requirements/d3");
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH");
    expect(rowOf("Test Handover")).toBeInTheDocument();
  });

  it("deletes after a confirmation, and keeps the row when kept or when the route refuses", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "nope" }, 403)).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete Test DPIA" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Test DPIA" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Test DPIA" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test DPIA" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await userEvent.click(screen.getByRole("button", { name: "Delete Test DPIA" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Test DPIA" })).toBeNull());
    expect(fetchMock.mock.calls[1]).toEqual(["/api/document-requirements/d2", { method: "DELETE" }]);
    expect(screen.getByText("Deleted Test DPIA.")).toBeInTheDocument();
  });
});
