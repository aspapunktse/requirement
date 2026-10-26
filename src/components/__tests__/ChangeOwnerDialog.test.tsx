import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeOwnerDialog, type OwnerChangeSystem } from "../ChangeOwnerDialog";

const CANDIDATES = [
  { id: "u-ada", name: "Ada Admin", email: "ada@example.com", role: "ADMIN" },
  { id: "u-sam", name: "Sam Owner", email: "sam@example.com", role: "SYSTEM_OWNER" },
];
const sys = (over: Partial<OwnerChangeSystem> & Pick<OwnerChangeSystem, "id" | "name">): OwnerChangeSystem => ({
  ownerId: "u-sam",
  ownerName: "Sam Owner",
  canChange: true,
  ...over,
});

const ADMIN = { id: "u-admin", role: "ADMIN" };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((input: string | URL | Request) =>
    String(input).includes("owner-candidates") ? json({ users: CANDIDATES }) : json({ changed: [{ id: "s1", name: "Jira" }], unchanged: [] }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChangeOwnerDialog (#233)", () => {
  it("loads the possible owners, posts the pick and reports the result", async () => {
    const onDone = vi.fn();
    render(<ChangeOwnerDialog actor={ADMIN} systems={[sys({ id: "s1", name: "Jira" })]} onClose={vi.fn()} onDone={onDone} />);
    const save = screen.getByRole("button", { name: "Save owner" });
    expect(save).toBeDisabled();

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-ada");
    await userEvent.click(save);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([url]) => url === "/api/systems/owner")!;
    expect(JSON.parse(post[1].body)).toEqual({ systemIds: ["s1"], ownerId: "u-ada" });
  });

  it("says up front which Systems can't be changed and blocks saving", async () => {
    render(
      <ChangeOwnerDialog
        actor={ADMIN}
        systems={[sys({ id: "s1", name: "Jira" }), sys({ id: "s2", name: "Okta", ownerId: "u-x", canChange: false })]}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-ada");
    expect(screen.getByRole("alert")).toHaveTextContent(/can't change the owner of Okta/);
    expect(screen.getByRole("button", { name: "Save owner" })).toBeDisabled();
  });

  it("notes a System the pick already owns", async () => {
    render(<ChangeOwnerDialog actor={ADMIN} systems={[sys({ id: "s1", name: "Jira" })]} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-sam");
    expect(screen.getByText(/already owned by this user/)).toBeInTheDocument();
  });

  it("shows the server's refusal and the names of the refused Systems, and stays open", async () => {
    fetchMock.mockImplementation((input: string | URL | Request) =>
      String(input).includes("owner-candidates")
        ? json({ users: CANDIDATES })
        : json({ error: "Only a System's owner or an Admin can change its owner", refusedIds: ["s1"] }, 403),
    );
    const onDone = vi.fn();
    render(<ChangeOwnerDialog actor={ADMIN} systems={[sys({ id: "s1", name: "Jira" })]} onClose={vi.fn()} onDone={onDone} />);
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-ada");
    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/change its owner: Jira/);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows the error when the possible owners can't be loaded", async () => {
    fetchMock.mockImplementation(() => json({ error: "nope" }, 403));
    render(<ChangeOwnerDialog actor={ADMIN} systems={[sys({ id: "s1", name: "Jira" })]} onClose={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
  });

  it("warns in the plural when a non-Admin hands several of their own Systems away", async () => {
    render(
      <ChangeOwnerDialog
        actor={{ id: "u-sam", role: "SYSTEM_OWNER" }}
        systems={[sys({ id: "s1", name: "Jira" }), sys({ id: "s2", name: "Okta" })]}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), "u-ada");
    expect(screen.getByText("You will no longer be able to change these Systems after handing them over.")).toBeInTheDocument();
  });
});
