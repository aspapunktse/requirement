import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";
import type { InformationTypeRow } from "@/lib/information-type";
import { InformationTypesRegister } from "../InformationTypesRegister";

const types: InformationTypeRow[] = [
  { id: "t1", name: "Test Payroll", description: "Salaries and bank details.", sensitivityLevel: 4, systemCount: 2 },
  { id: "t2", name: "Test Source code", description: "Repositories.", sensitivityLevel: 3, systemCount: 0 },
  { id: "t3", name: "Test Marketing", description: null, sensitivityLevel: 1, systemCount: 0 },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const detail = (row: InformationTypeRow, systems: unknown[] = []) => json({ informationType: row, systems });

function renderRegister(canCurate: boolean) {
  return render(<InformationTypesRegister initialTypes={types} levels={[...DEFAULT_SENSITIVITY_LEVELS]} canCurate={canCurate} />);
}
const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr") as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InformationTypesRegister: read-only (#303)", () => {
  it("lists each type with its level chip and the count of Systems, highest level first, and offers no editing", () => {
    renderRegister(false);
    const rows = within(screen.getByRole("table", { name: "Information Types" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "Test PayrollSalaries and bank details.",
      "Test Source codeRepositories.",
      "Test Marketing",
    ]);
    expect(within(rows[0]).getByRole("img", { name: "Sensitivity Level: Highly Sensitive" })).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 Systems")).toBeInTheDocument();
    expect(within(rows[1]).getByText("No System yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Information Type" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByText(/Only the Compliance Manager or an Admin changes the catalogue/)).toBeInTheDocument();
  });

  it("opens a type read-only with the Systems that declare it, and no form", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      detail(types[0], [
        { id: "s1", name: "Test Workday", vendor: null, sensitivityLevel: 4 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(false);
    await userEvent.click(screen.getByRole("button", { name: "Open Test Payroll" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Payroll" });
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Save" })).toBeNull();
    expect(within(dialog).getByText("Salaries and bank details.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Only the Compliance Manager or an Admin changes the catalogue/)).toBeInTheDocument();
    expect(await within(dialog).findByRole("link", { name: "Test Workday" })).toHaveAttribute("href", "/systems/s1");
    expect(within(dialog).getByText("Declared by 2 Systems")).toBeInTheDocument();
    expect(within(dialog).getByText("1 more System not shown to your role.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/information-types/t1");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows an error when the declaring Systems cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "boom" }, 500)));
    renderRegister(false);
    await userEvent.click(screen.getByRole("button", { name: "Open Test Payroll" }));
    expect(await screen.findByText("Could not load the Systems that declare this type.")).toBeInTheDocument();
  });

  it("filters by search and by level", async () => {
    renderRegister(false);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Information Types" }), "bank");
    expect(screen.getByText("1 of 3 Information Types")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test Payroll" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test Marketing" })).toBeNull();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search Information Types" }));
    await userEvent.click(screen.getByRole("button", { name: "Public: 1 type" }));
    expect(screen.getByText("1 of 3 Information Types")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Test Marketing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Test Payroll" })).toBeNull();
  });
});

describe("InformationTypesRegister: editing (#303)", () => {
  it("adds a type with POST and lists it", async () => {
    const created: InformationTypeRow = { id: "t4", name: "Test Invoices", description: "Supplier invoices.", sensitivityLevel: 2, systemCount: 0 };
    const fetchMock = vi.fn().mockResolvedValue(json({ informationType: created }, 201));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Add Information Type" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an Information Type" });
    const save = within(dialog).getByRole("button", { name: "Add" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Test Invoices");
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Description/ }), "Supplier invoices.");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Sensitivity Level: Internal" }));
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/information-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Invoices", description: "Supplier invoices.", sensitivityLevel: 2 }),
    });
    expect(screen.getByRole("button", { name: "Test Invoices" })).toBeInTheDocument();
    expect(screen.getByText("Added Test Invoices.")).toBeInTheDocument();
  }, 20000);

  it("edits a type with PATCH, says a level change leaves the Systems alone, and shows the new level", async () => {
    const updated = { ...types[0], sensitivityLevel: 5 };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === "PATCH" ? json({ informationType: updated }) : detail(types[0])),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Payroll" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Payroll" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Test Payroll");
    expect(within(dialog).getByRole("radio", { name: "Sensitivity Level: Highly Sensitive" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Sensitivity Level: Critical Sensitivity" }));
    expect(within(dialog).getByText(/Changing its level to Critical Sensitivity changes nothing on those Systems by itself/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/information-types/t1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Payroll", description: "Salaries and bank details.", sensitivityLevel: 5 }),
    });
    expect(within(rowOf("Test Payroll")).getByRole("img", { name: "Sensitivity Level: Critical Sensitivity" })).toBeInTheDocument();
  });

  it("keeps the drawer open and shows the route's message when a save is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: { method?: string }) =>
        Promise.resolve(init?.method === "PATCH" ? json({ error: "An Information Type with that name already exists." }, 409) : detail(types[1])),
      ),
    );
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Source code" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Source code" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Test Payroll");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("An Information Type with that name already exists.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("deletes a type no System declares, after asking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete Test Marketing" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Delete Test Marketing? No System declares it");
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Test Marketing" })).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith("/api/information-types/t3", { method: "DELETE" });
    expect(screen.getByText("Deleted Test Marketing.")).toBeInTheDocument();
  });

  it("refuses to delete a type a System declares, without calling the route", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete Test Payroll" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Test Payroll is declared by 2 Systems and can't be deleted");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Test Payroll" })).toBeInTheDocument();
  });

  it("shows the route's message when a delete is refused after all (a System declared it meanwhile)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "This Information Type is declared by 1 System and can't be deleted." }, 409)));
    renderRegister(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete Test Marketing" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("declared by 1 System and can't be deleted");
    expect(screen.getByRole("button", { name: "Test Marketing" })).toBeInTheDocument();
  });
});
