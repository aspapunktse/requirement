import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SensitivityLevelsForm } from "../SensitivityLevelsForm";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

const levels: SensitivityLevelInfo[] = [
  { level: 1, label: "Public", description: "Anyone may see it.", textColor: "#475569", backgroundColor: "#F1F5F9" },
  { level: 2, label: "Internal", description: "Staff only.", textColor: "#1D4ED8", backgroundColor: "#EFF6FF" },
  { level: 3, label: "Sensitive", description: "Leaks hurt.", textColor: "#854D0E", backgroundColor: "#FEF9C3" },
  { level: 4, label: "Highly Sensitive", description: "Leaks hurt a lot.", textColor: "#9A3412", backgroundColor: "#FFEDD5" },
  { level: 5, label: "Critical Sensitivity", description: "Existential.", textColor: "#991B1B", backgroundColor: "#FEE2E2" },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const renderForm = () => render(<SensitivityLevelsForm levels={levels} defaults={levels} />);
const row = (n: number) => document.querySelector(`[data-level-row="${n}"]`) as HTMLElement;

afterEach(() => vi.unstubAllGlobals());

describe("SensitivityLevelsForm (#291)", () => {
  it("renders a row per level with its chip, colours and contrast, and nothing to save yet", () => {
    renderForm();
    expect(document.querySelectorAll("[data-level-row]")).toHaveLength(5);
    expect(screen.getByLabelText("Label for level 4")).toHaveValue("Highly Sensitive");
    expect(screen.getByLabelText("Text colour, level 2 hex")).toHaveValue("#1D4ED8");
    expect(within(row(2)).getAllByRole("img", { name: "Sensitivity Level: Internal" })).toHaveLength(2);
    expect(within(row(2)).getByText("Dark is derived from the light pair.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save level 2" })).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves one level with PATCH and shows it saved", async () => {
    const saved = { ...levels[2], label: "Confidential" };
    const fetchMock = vi.fn().mockResolvedValue(json({ level: saved }));
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    const label = screen.getByLabelText("Label for level 3");
    await userEvent.clear(label);
    await userEvent.type(label, "Confidential");
    expect(within(row(3)).getAllByRole("img", { name: "Sensitivity Level: Confidential" }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Save level 3" }));
    await waitFor(() => expect(within(row(3)).getByRole("status")).toHaveTextContent("Saved"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sensitivity-levels");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({ level: 3, label: "Confidential", textColor: "#854D0E", backgroundColor: "#FEF9C3" });
  });

  it("locks the row's fields while its save is pending, so the response can't overwrite later edits", async () => {
    let resolve: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>((done) => (resolve = done))));
    renderForm();
    const label = screen.getByLabelText("Label for level 3");
    await userEvent.clear(label);
    await userEvent.type(label, "Confidential");
    await userEvent.click(screen.getByRole("button", { name: "Save level 3" }));
    for (const name of ["Label for level 3", "Description for level 3", "Text colour, level 3 hex", "Text colour, level 3 picker", "Background colour, level 3 hex", "Background colour, level 3 picker"]) {
      expect(screen.getByLabelText(name)).toBeDisabled();
    }
    expect(screen.getByLabelText("Label for level 2")).toBeEnabled();
    resolve(json({ level: { ...levels[2], label: "Confidential" } }));
    await waitFor(() => expect(within(row(3)).getByRole("status")).toHaveTextContent("Saved"));
    expect(screen.getByLabelText("Label for level 3")).toBeEnabled();
  });

  it("refuses low contrast, an empty label, a bad colour and a duplicate label before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    const text = screen.getByLabelText("Text colour, level 1 hex");
    await userEvent.clear(text);
    await userEvent.type(text, "#CCCCCC");
    expect(within(row(1)).getByRole("alert")).toHaveTextContent(/Public: contrast is 1\.\d\d:1/);
    expect(screen.getByRole("button", { name: "Save level 1" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Revert level 1" }));
    expect(text).toHaveValue("#475569");

    const label = screen.getByLabelText("Label for level 2");
    await userEvent.clear(label);
    expect(within(row(2)).getByRole("alert")).toHaveTextContent("Give the level a label.");
    await userEvent.type(label, "public");
    expect(within(row(2)).getByRole("alert")).toHaveTextContent("level 1 already has this label");
    expect(screen.getByRole("button", { name: "Save level 2" })).toBeDisabled();

    const background = screen.getByLabelText("Background colour, level 3 hex");
    await userEvent.clear(background);
    await userEvent.type(background, "#12");
    expect(within(row(3)).getByRole("alert")).toHaveTextContent("Background colour must be a hex colour");
    expect(screen.getByRole("button", { name: "Save level 3" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal in an alert and keeps the draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "Sensitive: nope", errors: ["Sensitive: nope"] }, 400)));
    renderForm();
    await userEvent.type(screen.getByLabelText("Description for level 3"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save level 3" }));
    await waitFor(() => expect(within(row(3)).getByRole("alert")).toHaveTextContent("Sensitive: nope"));
    expect(screen.getByLabelText("Description for level 3")).toHaveValue("Leaks hurt.!");
  });

  it("Default puts the default wording and colours into the draft without saving", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    const label = screen.getByLabelText("Label for level 1");
    await userEvent.clear(label);
    await userEvent.type(label, "Open");
    await userEvent.click(screen.getByRole("button", { name: "Default for level 1" }));
    expect(label).toHaveValue("Public");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
