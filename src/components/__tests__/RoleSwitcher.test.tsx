import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleSwitcher } from "../RoleSwitcher";

const refresh = vi.fn();
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
}));

const users = [
  { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "ADMIN" },
  { id: "u2", name: "Vic Viewer", email: "vic@example.com", role: "VIEWER" },
];

describe("RoleSwitcher", () => {
  beforeEach(() => {
    refresh.mockClear();
    push.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/users")) {
          return Promise.resolve(new Response(JSON.stringify({ users }), { status: 200 }));
        }
        if (url.includes("/api/session/acting-user")) {
          return Promise.resolve(new Response(JSON.stringify({ user: null }), { status: 200 }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists every seeded user as an option", async () => {
    render(<RoleSwitcher />);

    expect(await screen.findByRole("option", { name: "Ada Admin (ADMIN)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Vic Viewer (VIEWER)" })).toBeInTheDocument();
  });

  it("posts the selected user and redirects to /home on change", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    const select = await screen.findByLabelText("Acting as");
    await user.selectOptions(select, "u2");

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
