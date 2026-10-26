import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSettingsForm } from "../AppSettingsForm";
import type { AppSettingDefinition, AppSettingValue } from "@/lib/app-settings";

const definitions: AppSettingDefinition[] = [
  { key: "systems.staleDraftDays", section: "Systems list", label: "Stale Draft after", help: "Help one.", unit: "days", type: "integer", min: 1, max: 365, default: 60, affectsTrends: true },
  { key: "systems.underFulfilledPercent", section: "Systems list", label: "Under N% met threshold", help: "Help two.", unit: "%", type: "integer", min: 1, max: 100, default: 70, affectsTrends: true },
];
const values: AppSettingValue[] = [
  { key: "systems.staleDraftDays", value: 60, isDefault: true, updatedAt: null, updatedByName: null },
  { key: "systems.underFulfilledPercent", value: 80, isDefault: false, updatedAt: "2026-10-25T10:30:00.000Z", updatedByName: "Test Admin" },
];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const renderForm = () => render(<AppSettingsForm sections={["Systems list"]} definitions={definitions} values={values} />);

afterEach(() => vi.unstubAllGlobals());

describe("AppSettingsForm (#240)", () => {
  it("shows each setting with its value, default, and who last changed it, and says trend lines can jump", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "Systems list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Stale Draft after")).toHaveValue("60");
    expect(screen.getByLabelText("Under N% met threshold")).toHaveValue("80");
    expect(screen.getByText(/Default 60 days\. Not changed yet/)).toBeInTheDocument();
    expect(screen.getByText(/Default 70 %\. Last changed by Test Admin on /)).toBeInTheDocument();
    expect(screen.getByText(/trend lines on the Systems list count earlier days under the value that was in force then/)).toBeInTheDocument();
  });

  it("keeps Save off until the value is a changed whole number in range, and says why", async () => {
    renderForm();
    const [save] = screen.getAllByRole("button", { name: "Save" });
    const input = screen.getByLabelText("Stale Draft after");
    expect(save).toBeDisabled(); // unchanged
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    expect(save).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("A whole number from 1 to 365");
    await userEvent.clear(input);
    await userEvent.type(input, "366");
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "4.5");
    expect(save).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "45");
    expect(save).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("PATCHes the key and the number, then shows the saved value and who changed it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({ changed: true, setting: { key: "systems.staleDraftDays", value: 45, isDefault: false, updatedAt: "2026-10-26T08:00:00.000Z", updatedByName: "Test Admin" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    const input = screen.getByLabelText("Stale Draft after");
    await userEvent.clear(input);
    await userEvent.type(input, "45");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ key: "systems.staleDraftDays", value: 45 });
    expect(screen.getByText(/Default 60 days\. Last changed by Test Admin/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save" })[0]).toBeDisabled();
  });

  it("shows the server's refusal and keeps the typed value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Only Admins" }, 403)));
    renderForm();
    const input = screen.getByLabelText("Stale Draft after");
    await userEvent.clear(input);
    await userEvent.type(input, "45");
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only Admins");
    expect(input).toHaveValue("45");
  });
});
