import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeOwnerButton } from "../ChangeOwnerButton";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const CANDIDATES = [
  { id: "u-elena", name: "Elena Voss", email: "e@example.com", role: "SYSTEM_OWNER" },
  { id: "u-risk", name: "Default Risk Owner", email: "r@example.com", role: "RISK_OWNER" },
];
const system = { id: "s1", name: "Jira", ownerId: "u-elena", ownerName: "Elena Voss", canChange: true };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) =>
      String(input).includes("owner-candidates") ? json({ users: CANDIDATES }) : json({ changed: [{ id: "s1", name: "Jira" }], unchanged: [] }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

async function handOver(actor: { id: string; role: string }, to: string) {
  render(<ChangeOwnerButton system={system} actor={actor} />);
  await userEvent.click(screen.getByRole("button", { name: "Change owner" }));
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "New owner" }), to);
}

describe("ChangeOwnerButton (#233)", () => {
  it("warns a non-Admin handing their System away, and goes to the list after saving", async () => {
    await handOver({ id: "u-elena", role: "SYSTEM_OWNER" }, "u-risk");
    expect(screen.getByText("You will no longer be able to change this System after handing it over.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/systems"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows no warning to an Admin, and refreshes the page in place", async () => {
    await handOver({ id: "u-admin", role: "ADMIN" }, "u-risk");
    expect(screen.queryByText(/no longer be able/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("shows no warning when the owner picks themselves", async () => {
    await handOver({ id: "u-elena", role: "SYSTEM_OWNER" }, "u-elena");
    expect(screen.queryByText(/no longer be able/)).not.toBeInTheDocument();
  });
});
