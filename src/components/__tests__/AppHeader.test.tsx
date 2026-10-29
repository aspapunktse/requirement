import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { usePagePalette } from "@/components/PaletteProvider";
import { AppHeader } from "../AppHeader";
import { withHeader } from "./with-header";

let pathname = "/home";
const push = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: vi.fn(), push }),
}));

// A plain anchor that doesn't navigate (jsdom can't), so a click on a link only runs the header's own handlers.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  ),
}));

const acting = { id: "u1", name: "Ada Admin", email: "ada@example.com", role: "SYSTEM_OWNER" as const };
const asRole = (role: UserRole) => ({ ...acting, role });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = url.includes("/api/users") ? { users: [acting] } : { user: acting };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

afterEach(cleanup);

describe("AppHeader", () => {
  beforeEach(() => {
    pathname = "/home";
    push.mockClear();
    stubFetch();
  });

  it("shows the wordmark and a static user chip when the dev stub is off", () => {
    render(<AppHeader devStub={false} user={acting} />);

    expect(screen.getByRole("link", { name: "ISMS - system onboarding" })).toHaveAttribute("href", "/home");
    expect(screen.getByText("Ada Admin")).toBeInTheDocument();
    expect(screen.getByText("SYSTEM OWNER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Acting as Ada Admin" })).not.toBeInTheDocument();
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

const mainNav = () => screen.getByRole("navigation", { name: "Main" });
const navLabels = () => [...mainNav().querySelectorAll("a, button")].map((el) => el.textContent?.replace("▾", "").trim());
const SHARED = ["Home", "Systems", "Controls", "Check-ups", "SoA", "Frameworks"];

describe("AppHeader: main navigation", () => {
  beforeEach(() => {
    pathname = "/home";
    push.mockClear();
    stubFetch();
  });

  const ITEMS_BY_ROLE: Record<UserRole, string[]> = {
    ADMIN: ["Home", "Systems", "Controls", "Risks", "Check-ups", "Internal Audits", "SoA", "Frameworks", "Admin"],
    COMPLIANCE_MANAGER: ["Home", "Systems", "Controls", "Check-ups", "Internal Audits", "SoA", "Frameworks"],
    SYSTEM_OWNER: SHARED,
    RISK_OWNER: ["Home", "Systems", "Controls", "Risks", "Check-ups", "Internal Audits", "SoA", "Frameworks"],
    REVIEWER: SHARED,
    BUSINESS_RISK_OWNER: [...SHARED, "My Business Risks"],
    VIEWER: SHARED,
    INTERNAL_AUDITOR: ["Home", "Systems", "Controls", "Risks", "Check-ups", "Internal Audits", "SoA", "Frameworks"],
  };

  it.each(Object.entries(ITEMS_BY_ROLE))("lists the pages %s may open, in order, and no others", (role, expected) => {
    render(<AppHeader devStub={false} user={asRole(role as UserRole)} />);
    expect(navLabels()).toEqual(expected);
  });

  it("links each item to its page", () => {
    render(<AppHeader devStub={false} user={asRole("BUSINESS_RISK_OWNER")} />);
    const href = (name: string) => within(mainNav()).getByRole("link", { name }).getAttribute("href");
    expect(href("Home")).toBe("/home");
    expect(href("Systems")).toBe("/systems");
    expect(href("Controls")).toBe("/controls");
    expect(href("Check-ups")).toBe("/check-ups");
    expect(href("SoA")).toBe("/statement-of-applicability");
    expect(href("Frameworks")).toBe("/frameworks");
    expect(href("My Business Risks")).toBe("/business-risk-owner");
    expect(within(mainNav()).getByRole("link", { name: "SoA" })).toHaveAttribute("title", "Statement of Applicability");
  });

  it("links Risks and Internal Audits to their pages for a role that may open them", () => {
    render(<AppHeader devStub={false} user={asRole("RISK_OWNER")} />);
    expect(within(mainNav()).getByRole("link", { name: "Risks" })).toHaveAttribute("href", "/risks/organization");
    expect(within(mainNav()).getByRole("link", { name: "Internal Audits" })).toHaveAttribute("href", "/internal-audits");
  });

  it("follows the acting user when the role changes", () => {
    const { rerender } = render(<AppHeader devStub={false} user={asRole("VIEWER")} />);
    expect(within(mainNav()).queryByRole("link", { name: "Risks" })).not.toBeInTheDocument();
    rerender(<AppHeader devStub={false} user={asRole("RISK_OWNER")} />);
    expect(within(mainNav()).getByRole("link", { name: "Risks" })).toBeInTheDocument();
  });

  it.each([
    ["/home", "Home"],
    ["/systems", "Systems"],
    ["/systems/abc", "Systems"],
    ["/controls", "Controls"],
    ["/risks/organization", "Risks"],
    ["/risks/xyz", "Risks"],
    ["/check-ups", "Check-ups"],
    ["/check-ups/c1", "Check-ups"],
    ["/internal-audits/a1", "Internal Audits"],
    ["/statement-of-applicability", "SoA"],
    ["/frameworks/f1", "Frameworks"],
  ])("marks only the item for %s as current", (path, label) => {
    pathname = path;
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    const current = [...mainNav().querySelectorAll("[aria-current]")];
    expect(current.map((el) => [el.textContent?.replace("▾", "").trim(), el.getAttribute("aria-current")])).toEqual([[label, "page"]]);
  });

  it("marks My Business Risks for a Business Risk Owner", () => {
    pathname = "/business-risk-owner";
    render(<AppHeader devStub={false} user={asRole("BUSINESS_RISK_OWNER")} />);
    expect(within(mainNav()).getByRole("link", { name: "My Business Risks" })).toHaveAttribute("aria-current", "page");
  });

  it("marks nothing on a page outside the list, such as the Organization Controls", () => {
    pathname = "/organization/controls";
    render(<AppHeader devStub={false} user={acting} />);
    expect(mainNav().querySelector("[aria-current]")).toBeNull();
  });

  it("shows no navigation, Jump to button or palette on the sign-in page", async () => {
    pathname = "/";
    render(withHeader(null, acting));
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jump to" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("AppHeader: Admin menu", () => {
  beforeEach(() => {
    pathname = "/home";
    stubFetch();
  });

  const ADMIN_LINKS = [
    ["Control Library", "/admin/controls"],
    ["Frameworks", "/admin/frameworks"],
    ["Deployment Facets", "/admin/deployment-facets"],
    ["Review Groups", "/admin/review-groups"],
    ["Business Units", "/admin/business-units"],
    ["Business Risk Owners", "/admin/business-risk-owners"],
    ["Settings", "/admin/settings"],
  ];

  it("is offered to an Admin only", () => {
    for (const role of ["COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"] as const) {
      const { unmount } = render(<AppHeader devStub={false} user={asRole(role)} />);
      expect(screen.queryByRole("button", { name: /Admin/ })).not.toBeInTheDocument();
      unmount();
    }
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    expect(within(mainNav()).getByRole("button", { name: /Admin/ })).toBeInTheDocument();
  });

  it("opens a menu of every Admin page, in order, and closes on Escape with focus back on the button", async () => {
    const user = userEvent.setup();
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    const button = within(mainNav()).getByRole("button", { name: /Admin/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const links = within(screen.getByRole("navigation", { name: "Admin pages" })).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual(ADMIN_LINKS);

    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Admin pages" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("closes on an outside click and on choosing a page", async () => {
    const user = userEvent.setup();
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    const button = within(mainNav()).getByRole("button", { name: /Admin/ });
    await user.click(button);
    await user.click(document.body);
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    await user.click(within(screen.getByRole("navigation", { name: "Admin pages" })).getByRole("link", { name: "Settings" }));
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("is marked current on any Admin path, and then so is the page in the menu", async () => {
    pathname = "/admin/frameworks/f1";
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    const button = within(mainNav()).getByRole("button", { name: /Admin/ });
    expect(button).toHaveAttribute("aria-current", "page");
    expect(within(mainNav()).getByRole("link", { name: "Frameworks" })).not.toHaveAttribute("aria-current");
    await userEvent.click(button);
    expect(within(screen.getByRole("navigation", { name: "Admin pages" })).getByRole("link", { name: "Frameworks" })).toHaveAttribute("aria-current", "page");
  });

  it("is not current on a page outside Admin", () => {
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    expect(within(mainNav()).getByRole("button", { name: /Admin/ })).not.toHaveAttribute("aria-current");
  });
});

describe("AppHeader: collapsed menu", () => {
  beforeEach(() => {
    pathname = "/systems/abc";
    stubFetch();
  });

  it("shows the current page's name on the menu button", () => {
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    expect(screen.getByRole("button", { name: "Systems" })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a Go to popover marking the current page, with the Admin pages as a group for an Admin", async () => {
    const user = userEvent.setup();
    render(<AppHeader devStub={false} user={asRole("ADMIN")} />);
    await user.click(screen.getByRole("button", { name: "Systems" }));
    const goTo = screen.getByRole("navigation", { name: "Go to" });
    expect(within(goTo).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Home",
      "Systems",
      "Controls",
      "Risks",
      "Check-ups",
      "Internal Audits",
      "Statement of Applicability",
      "Frameworks",
    ]);
    expect(within(goTo).getByRole("link", { name: "Systems" })).toHaveAttribute("aria-current", "page");
    const admin = screen.getAllByRole("navigation", { name: "Admin pages" })[0];
    expect(within(admin).getByText("Admin")).toBeInTheDocument();
    expect(within(admin).getAllByRole("link")).toHaveLength(7);
  });

  it("has no Admin group for other roles", async () => {
    render(<AppHeader devStub={false} user={asRole("VIEWER")} />);
    await userEvent.click(screen.getByRole("button", { name: "Systems" }));
    expect(screen.getByRole("navigation", { name: "Go to" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Admin pages" })).not.toBeInTheDocument();
  });

  it("closes on Escape with focus back on the button, and on an outside click", async () => {
    const user = userEvent.setup();
    render(<AppHeader devStub={false} user={asRole("VIEWER")} />);
    const button = screen.getByRole("button", { name: "Systems" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();

    await user.click(button);
    expect(screen.getByRole("navigation", { name: "Go to" })).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("navigation", { name: "Go to" })).not.toBeInTheDocument();
  });

  it("is labelled Menu on a page outside the list", () => {
    pathname = "/organization/controls";
    render(<AppHeader devStub={false} user={asRole("VIEWER")} />);
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("keeps one popover open at a time, the role switcher included", async () => {
    const user = userEvent.setup();
    render(<AppHeader devStub user={asRole("ADMIN")} />);
    const menu = screen.getByRole("button", { name: "Systems" });
    const admin = within(mainNav()).getByRole("button", { name: /Admin/ });
    const switcher = await screen.findByRole("button", { name: "Acting as Ada Admin" });

    await user.click(menu);
    await user.click(admin);
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(admin).toHaveAttribute("aria-expanded", "true");

    await user.click(switcher);
    expect(admin).toHaveAttribute("aria-expanded", "false");
    expect(switcher).toHaveAttribute("aria-expanded", "true");
  });
});

function PageWithItems({ onSelect }: { onSelect?: () => void }) {
  usePagePalette({
    items: [{ group: "Tasks", icon: "check", label: "Review the cloud policy", meta: "due", href: "/x/1" }],
    onSelect,
    placeholder: "Jump to a task…",
  });
  return <p>page</p>;
}

describe("AppHeader: Ctrl+K palette", () => {
  beforeEach(() => {
    pathname = "/controls";
    push.mockClear();
  });

  it("opens exactly one palette with only the Go to pages on a page without items of its own", async () => {
    const user = userEvent.setup();
    render(withHeader(<p>page</p>, asRole("VIEWER")));
    await user.keyboard("{Control>}k{/Control}");
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(1);
    const options = within(dialogs[0]).getAllByRole("option");
    expect(options.map((o) => o.querySelector("span")?.textContent)).toEqual([
      "Home",
      "Systems",
      "Controls",
      "Check-ups",
      "Statement of Applicability",
      "Frameworks",
    ]);
    expect(within(dialogs[0]).getByText("Go to")).toBeInTheDocument();
    await user.type(within(dialogs[0]).getByRole("combobox"), "framew");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/frameworks");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the same single palette from the Jump to button, and Ctrl+K again closes it", async () => {
    const user = userEvent.setup();
    render(withHeader(<p>page</p>, asRole("VIEWER")));
    const button = screen.getByRole("button", { name: "Jump to" });
    await user.click(button);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("lists the page's own items first, then the Go to pages, in one palette", async () => {
    const user = userEvent.setup();
    render(withHeader(<PageWithItems />, asRole("VIEWER")));
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const dialog = screen.getByRole("dialog");
    const options = within(dialog).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Review the cloud policy");
    expect(options).toHaveLength(7);
    expect(within(dialog).getByRole("combobox")).toHaveAttribute("placeholder", "Jump to a task…");
    const groups = within(dialog)
      .getAllByText(/^(Tasks|Go to)$/)
      .map((el) => el.textContent);
    expect(groups).toEqual(["Tasks", "Go to"]);
  });

  it("hands a page item to the page's own handler, and a Go to page to the router", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(withHeader(<PageWithItems onSelect={onSelect} />, asRole("VIEWER")));
    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: "Review the cloud policy" }));
    expect(push).not.toHaveBeenCalled();

    await user.keyboard("{Control>}k{/Control}");
    await user.type(screen.getByRole("combobox"), "systems");
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/systems");
  });

  it("forgets the page's items when the page goes away", async () => {
    const user = userEvent.setup();
    const { rerender } = render(withHeader(<PageWithItems />, asRole("VIEWER")));
    rerender(withHeader(<p>other</p>, asRole("VIEWER")));
    await user.keyboard("{Control>}k{/Control}");
    expect(within(screen.getByRole("dialog")).queryByText("Review the cloud policy")).not.toBeInTheDocument();
  });

  it("lists the Admin pages under Go to for an Admin only", async () => {
    const user = userEvent.setup();
    const { unmount } = render(withHeader(null, asRole("ADMIN")));
    await user.keyboard("{Control>}k{/Control}");
    const labels = within(screen.getByRole("dialog"))
      .getAllByRole("option")
      .map((o) => o.querySelector("span")?.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Control Library", "Deployment Facets", "Review Groups", "Settings", "Business Risk Owners"]));
    unmount();

    render(withHeader(null, asRole("COMPLIANCE_MANAGER")));
    await user.keyboard("{Control>}k{/Control}");
    expect(within(screen.getByRole("dialog")).queryByText("Deployment Facets")).not.toBeInTheDocument();
  });
});
