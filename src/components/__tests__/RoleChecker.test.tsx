import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleChecker } from "../RoleChecker";

const refresh = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const users = [
  { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "ADMIN" },
  { id: "u2", name: "Vic Viewer", email: "vic@example.com", role: "VIEWER" },
];

describe("RoleChecker", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    refresh.mockClear();
    push.mockClear();
    fetchMock = vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/users")) {
        return Promise.resolve(new Response(JSON.stringify({ users }), { status: 200 }));
      }
      if (url.includes("/api/session/acting-user")) {
        return Promise.resolve(new Response(JSON.stringify({ user: users[0] }), { status: 200 }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a radio tile per user with nothing selected and Sign in disabled", async () => {
    render(<RoleChecker />);

    expect(await screen.findByRole("radio", { name: /Ada Admin/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Vic Viewer/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Sign in/ })).toBeDisabled();
  });

  it("enables Sign in once a tile is selected, then posts the user and redirects to /home", async () => {
    const user = userEvent.setup();
    render(<RoleChecker />);

    await user.click(await screen.findByRole("radio", { name: /Vic Viewer/ }));
    const button = screen.getByRole("button", { name: /Sign in/ });
    expect(button).toBeEnabled();
    expect(push).not.toHaveBeenCalled();

    await user.click(button);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/home"));
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/session/acting-user"));
    expect(JSON.parse(post![1].body)).toEqual({ userId: "u2" });
    expect(refresh).toHaveBeenCalled();
  });
});
