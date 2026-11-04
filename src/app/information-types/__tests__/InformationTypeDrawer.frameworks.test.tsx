import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SENSITIVITY_LEVELS } from "@/lib/sensitivity-level-defaults";
import type { InformationTypeRow, SuggestedFrameworkRef } from "@/lib/information-type";
import { InformationTypesRegister } from "../InformationTypesRegister";

/** The suggested Frameworks in the Information Type drawer (#300, ADR 0013). */
const GDPR: SuggestedFrameworkRef = { id: "fw-gdpr", name: "GDPR", version: "1", status: "PUBLISHED" };
const NIS: SuggestedFrameworkRef = { id: "fw-nis", name: "NIS2", version: "1", status: "DRAFT" };
const type: InformationTypeRow = { id: "t1", name: "Test Personal data", description: null, sensitivityLevel: 3, systemCount: 2, suggestedFrameworks: [GDPR] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(canCurate: boolean) {
  render(<InformationTypesRegister initialTypes={[type]} levels={[...DEFAULT_SENSITIVITY_LEVELS]} frameworkChoices={[GDPR, NIS]} canCurate={canCurate} />);
}

describe("InformationTypeDrawer: suggested Frameworks", () => {
  it("shows them read-only to everyone else", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ informationType: type, systems: [] })));
    open(false);
    await userEvent.click(screen.getByRole("button", { name: "Open Test Personal data" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Personal data" });
    expect(within(dialog).getByRole("list", { name: "Suggested Frameworks" })).toHaveTextContent("GDPR:1");
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("lets a curator pick Frameworks, warns that declaring Systems are flagged, and sends the whole list", async () => {
    const fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(init?.method === "PATCH" ? json({ informationType: { ...type, suggestedFrameworks: [GDPR, NIS] } }) : json({ informationType: type, systems: [] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    open(true);
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Personal data" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Personal data" });
    expect(within(dialog).getByRole("checkbox", { name: "GDPR:1" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /NIS2:1/ }));
    expect(within(dialog).getByText(/Draft: suggests nothing until it is published/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Changing its Frameworks flags those Systems for their owners to review; their Framework Scope isn't changed.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/information-types/t1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Test Personal data", description: null, sensitivityLevel: 3, frameworkIds: ["fw-gdpr", "fw-nis"] }) }),
      ),
    );
  });
});
