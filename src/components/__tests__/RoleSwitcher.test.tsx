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
  { id: "u3", name: "Rita Risk", email: "rita@example.com", role: "RISK_OWNER" },
];

function postedUserId() {
  const postCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "POST");
  return postCall ? JSON.parse(postCall[1].body).userId : undefined;
}

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
          return Promise.resolve(new Response(JSON.stringify({ user: users[0] }), { status: 200 }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the acting user on the chip button", async () => {
    render(<RoleSwitcher />);

    const button = await screen.findByRole("button", { name: "Acting as Ada Admin" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("lists every seeded user as an option once opened, marking the acting user selected", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Acting as/ }));

    expect(screen.getByRole("listbox", { name: "Acting as" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ada Admin/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Vic Viewer/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("option", { name: /Rita Risk/ })).toBeInTheDocument();
  });

  it("lists the Internal Auditor with its role label and can pick it (#147)", async () => {
    const auditor = { id: "u4", name: "Ivy Auditor", email: "ivy@example.com", role: "INTERNAL_AUDITOR" };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/users")) {
          return Promise.resolve(new Response(JSON.stringify({ users: [...users, auditor] }), { status: 200 }));
        }
        if (url.includes("/api/session/acting-user") && init?.method === "POST") {
          return Promise.resolve(new Response(JSON.stringify({ user: auditor }), { status: 200 }));
        }
        return Promise.resolve(new Response(JSON.stringify({ user: users[0] }), { status: 200 }));
      }),
    );
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Acting as/ }));
    const option = screen.getByRole("option", { name: /Ivy Auditor/ });
    expect(option).toHaveTextContent("INTERNAL AUDITOR");

    await user.click(option);
    await waitFor(() => expect(postedUserId()).toBe("u4"));
  });

  it("posts the clicked user and redirects to /home", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Acting as/ }));
    await user.click(screen.getByRole("option", { name: /Vic Viewer/ }));

    await waitFor(() => expect(postedUserId()).toBe("u2"));
    expect(push).toHaveBeenCalledWith("/home");
    expect(refresh).toHaveBeenCalled();
  });

  it("selects with the keyboard: ArrowDown moves the highlight, Enter picks it", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    await user.click(await screen.findByRole("button", { name: /Acting as/ }));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    await waitFor(() => expect(postedUserId()).toBe("u3"));
    expect(push).toHaveBeenCalledWith("/home");
  });

  describe("scrolling the active option into view (#68)", () => {
    const scrollIntoView = vi.fn();
    const scrolledIds = () => scrollIntoView.mock.contexts.map((el) => (el as HTMLElement).id);

    beforeEach(() => {
      scrollIntoView.mockClear();
      Element.prototype.scrollIntoView = scrollIntoView;
    });

    afterEach(() => {
      // @ts-expect-error jsdom has no scrollIntoView; remove the stub.
      delete Element.prototype.scrollIntoView;
    });

    it("scrolls the selected user into view when opened", async () => {
      const user = userEvent.setup();
      render(<RoleSwitcher />);

      await user.click(await screen.findByRole("button", { name: /Acting as/ }));

      expect(scrolledIds()).toEqual(["acting-user-u1"]);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    });

    it("keeps the highlighted option in view as arrow, End and Home keys move it", async () => {
      const user = userEvent.setup();
      render(<RoleSwitcher />);

      await user.click(await screen.findByRole("button", { name: /Acting as/ }));
      await user.keyboard("{ArrowDown}{End}{Home}");

      expect(scrolledIds()).toEqual(["acting-user-u1", "acting-user-u2", "acting-user-u3", "acting-user-u1"]);
    });

    it("does not scroll when the highlight moves with the mouse", async () => {
      const user = userEvent.setup();
      render(<RoleSwitcher />);

      await user.click(await screen.findByRole("button", { name: /Acting as/ }));
      scrollIntoView.mockClear();
      await user.hover(screen.getByRole("option", { name: /Rita Risk/ }));

      expect(scrollIntoView).not.toHaveBeenCalled();

      await user.keyboard("{ArrowUp}");
      expect(scrolledIds()).toEqual(["acting-user-u2"]);
    });
  });

  it("closes on Escape without switching and returns focus to the button", async () => {
    const user = userEvent.setup();
    render(<RoleSwitcher />);

    const button = await screen.findByRole("button", { name: /Acting as/ });
    await user.click(button);
    await user.keyboard("{ArrowDown}{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(postedUserId()).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });
});
