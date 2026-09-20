import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppHeader } from "../AppHeader";

let pathname = "/home";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const acting = { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "SYSTEM_OWNER" as const };

describe("AppHeader", () => {
  beforeEach(() => {
    pathname = "/home";
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        const body = url.includes("/api/users") ? { users: [acting] } : { user: acting };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
  });

  it("shows the wordmark and a static user chip when the dev stub is off", () => {
    render(<AppHeader devStub={false} user={acting} />);

    expect(screen.getByRole("link", { name: "ISMS - system onboarding" })).toHaveAttribute("href", "/home");
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM OWNER")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the role switcher when the dev stub is on", async () => {
    render(<AppHeader devStub user={acting} />);

    expect(await screen.findByRole("button", { name: "Acting as Ada Admin" })).toBeInTheDocument();
  });

  it("shows only the wordmark on the sign-in page", () => {
    pathname = "/";
    render(<AppHeader devStub user={null} />);

    expect(screen.getByRole("link", { name: "ISMS - system onboarding" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a user/)).not.toBeInTheDocument();
  });
});
