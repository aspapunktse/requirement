import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RolePicker } from "../RolePicker";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const users = [
  { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "ADMIN" as const },
  { id: "u2", name: "Vic Viewer", email: "vic@example.com", role: "VIEWER" as const },
];

describe("RolePicker", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: users[1] }), { status: 200 }))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every seeded user as a card", () => {
    render(<RolePicker users={users} actingUserId={null} />);

    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("Vic Viewer")).toBeInTheDocument();
  });

  it("marks the currently acting user", () => {
    render(<RolePicker users={users} actingUserId="u1" />);

    expect(screen.getByText("Currently acting as this user")).toBeInTheDocument();
  });

  it("posts the picked user and navigates to /home", async () => {
    const user = userEvent.setup();
    render(<RolePicker users={users} actingUserId={null} />);

    await user.click(screen.getByRole("button", { name: /Vic Viewer/ }));

    await waitFor(() => {
      const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
        ([, init]) => init?.method === "POST",
      );
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toEqual({ userId: "u2" });
    });
    expect(push).toHaveBeenCalledWith("/home");
    expect(refresh).toHaveBeenCalled();
  });
});
