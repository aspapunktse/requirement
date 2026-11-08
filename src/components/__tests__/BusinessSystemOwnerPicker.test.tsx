import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessSystemOwnerPicker } from "../BusinessSystemOwnerPicker";
import { ChangeBusinessSystemOwnerDialog } from "../ChangeBusinessSystemOwnerDialog";

const CANDIDATES = [
  { id: "u-ada", name: "Ada Admin", email: "ada@example.com", role: "ADMIN" },
  { id: "u-sam", name: "Sam Owner", email: "sam@example.com", role: "SYSTEM_OWNER" },
  { id: "u-vic", name: "Vic Viewer", email: "vic@example.com", role: "VIEWER" },
];
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((input: string | URL | Request) =>
    String(input).includes("bso-candidates") ? json({ users: CANDIDATES }) : json({ changed: true, businessSystemOwner: { id: "u-vic", name: "Vic Viewer" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ exclude }: { exclude?: string }) {
  const [value, setValue] = useState("");
  return (
    <>
      <BusinessSystemOwnerPicker value={value} onChange={setValue} excludeUserId={exclude} />
      <output data-testid="picked">{value}</output>
    </>
  );
}

describe("BusinessSystemOwnerPicker (#321)", () => {
  it("lists every user of any role, leaves the excluded one out, and reports the pick", async () => {
    render(<Harness exclude="u-sam" />);
    const picker = await screen.findByRole("combobox", { name: "Business System Owner (optional)" });
    await waitFor(() => expect(picker).toBeEnabled());
    expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual(["Not set", "Ada Admin (ada@example.com)", "Vic Viewer (vic@example.com)"]);

    await userEvent.selectOptions(picker, "u-vic");
    expect(screen.getByTestId("picked")).toHaveTextContent("u-vic");
    await userEvent.selectOptions(picker, "");
    expect(screen.getByTestId("picked")).toBeEmptyDOMElement();
  });

  it("says so when the list can't be loaded", async () => {
    fetchMock.mockImplementation(() => json({ error: "Only an Admin can" }, 403));
    render(<Harness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an Admin can");
  });
});

describe("ChangeBusinessSystemOwnerDialog (#321)", () => {
  const system = { id: "s1", name: "Jira", ownerId: "u-sam", businessSystemOwnerId: null, businessSystemOwnerName: null };

  it("saves the pick with a PUT and reports it", async () => {
    const onDone = vi.fn();
    render(<ChangeBusinessSystemOwnerDialog system={system} onClose={vi.fn()} onDone={onDone} />);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    const picker = await screen.findByRole("combobox", { name: "Business System Owner" });
    await waitFor(() => expect(picker).toBeEnabled());
    // The System's owner can't be picked.
    expect(within(picker).queryByRole("option", { name: /Sam Owner/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(picker, "u-vic");
    await userEvent.click(save);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const put = fetchMock.mock.calls.find(([url]) => url === "/api/systems/s1/business-system-owner")!;
    expect(put[1].method).toBe("PUT");
    expect(JSON.parse(put[1].body)).toEqual({ businessSystemOwnerId: "u-vic" });
  });

  it("clears the Business System Owner by picking Not set", async () => {
    const onDone = vi.fn();
    render(<ChangeBusinessSystemOwnerDialog system={{ ...system, businessSystemOwnerId: "u-vic", businessSystemOwnerName: "Vic Viewer" }} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText(/Vic Viewer is the Business System Owner/)).toBeInTheDocument();
    const picker = await screen.findByRole("combobox", { name: "Business System Owner" });
    await waitFor(() => expect(picker).toBeEnabled());
    expect(picker).toHaveValue("u-vic");
    await userEvent.selectOptions(picker, "");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const put = fetchMock.mock.calls.find(([url]) => url === "/api/systems/s1/business-system-owner")!;
    expect(JSON.parse(put[1].body)).toEqual({ businessSystemOwnerId: null });
  });

  it("shows the server's refusal and stays open", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) =>
      String(input).includes("bso-candidates") ? json({ users: CANDIDATES }) : json({ error: "The Business System Owner can't be the System's owner" }, 400),
    );
    const onDone = vi.fn();
    render(<ChangeBusinessSystemOwnerDialog system={system} onClose={vi.fn()} onDone={onDone} />);
    const picker = await screen.findByRole("combobox", { name: "Business System Owner" });
    await waitFor(() => expect(picker).toBeEnabled());
    await userEvent.selectOptions(picker, "u-ada");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("can't be the System's owner");
    expect(onDone).not.toHaveBeenCalled();
  });
});
