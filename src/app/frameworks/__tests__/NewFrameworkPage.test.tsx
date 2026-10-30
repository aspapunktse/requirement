import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import NewFrameworkPage from "../new/page";
import { NewFrameworkForm } from "../new/NewFrameworkForm";

/** /frameworks/new (#266, decision 4b): who gets the form, and what the form posts and does with the answer. */
const suffix = `${process.pid}-${Date.now()}`;
const users: Record<string, string> = {};
const roles: [string, UserRole][] = [["cm", "COMPLIANCE_MANAGER"], ["admin", "ADMIN"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"]];
let existingId: string;

beforeAll(async () => {
  for (const [key, role] of roles) {
    users[key] = (await prisma.user.create({ data: { email: `test-266-new-${key}-${suffix}@example.com`, name: `Test 266 ${key}`, role } })).id;
  }
  existingId = (await prisma.framework.create({ data: { name: `Test 266 earlier ${suffix}`, version: "2013", status: "PUBLISHED" } })).id;
});

afterAll(async () => {
  await prisma.framework.delete({ where: { id: existingId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

afterEach(() => {
  cleanup();
  push.mockClear();
  vi.unstubAllGlobals();
});

describe("the New Framework page", () => {
  const html = async (userKey: string | null) => {
    acting.userId = userKey ? users[userKey] : null;
    return renderToStaticMarkup(await NewFrameworkPage());
  };

  it("shows the form to a Compliance Manager and an Admin, with the existing Frameworks to supersede", async () => {
    for (const key of ["cm", "admin"]) {
      const markup = await html(key);
      expect(markup).toContain("New Framework");
      expect(markup).toContain("Create Framework");
      expect(markup).toContain(`Test 266 earlier ${suffix}:2013`);
    }
  });

  it("refuses every other role with a message, and shows no form and no Framework name", async () => {
    for (const key of ["viewer", "owner"]) {
      const markup = await html(key);
      expect(markup).toContain("Only Compliance Managers and Admins can add a Framework.");
      expect(markup).not.toContain("Create Framework");
      expect(markup).not.toContain(`Test 266 earlier ${suffix}`);
    }
  });

  it("asks to pick a user when nobody is acting", async () => {
    expect(await html(null)).toContain("Pick a user to act as first.");
  });
});

describe("the New Framework form", () => {
  const frameworks = [{ id: "f-iso", name: "ISO/IEC 27001", version: "2013" }];
  const posts = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("posts the details to /api/frameworks and opens the new Framework's authoring page", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ framework: { id: "f-new" } }), { status: 201 }));
    render(<NewFrameworkForm frameworks={frameworks} />);

    await userEvent.type(screen.getByLabelText("Name"), "  CMMC Level 2 ");
    await userEvent.type(screen.getByLabelText("Version"), "2.0");
    await userEvent.type(screen.getByLabelText("Description"), "Defence supply chain");
    await userEvent.selectOptions(screen.getByLabelText("Licensing"), "QUOTABLE");
    await userEvent.selectOptions(screen.getByLabelText("Supersedes"), "f-iso");
    await userEvent.click(screen.getByRole("checkbox", { name: /Requires 100% Fulfilled/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create Framework" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/frameworks/f-new"));
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe("/api/frameworks");
    expect(JSON.parse(posts()[0][1]!.body as string)).toEqual({
      name: "CMMC Level 2",
      version: "2.0",
      description: "Defence supply chain",
      strictComplianceRequired: true,
      licensing: "QUOTABLE",
      supersedesId: "f-iso",
    });
  });

  it("sends defaults when only name and version are given: paraphrase only, not strict, supersedes nothing", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ framework: { id: "f-new" } }), { status: 201 }));
    render(<NewFrameworkForm frameworks={frameworks} />);
    await userEvent.type(screen.getByLabelText("Name"), "NIS2");
    await userEvent.type(screen.getByLabelText("Version"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create Framework" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(JSON.parse(posts()[0][1]!.body as string)).toEqual({ name: "NIS2", version: "1", strictComplianceRequired: false, licensing: "PARAPHRASE_ONLY", supersedesId: null });
  });

  it("shows a validation error for a blank name or version, sends nothing and stays", async () => {
    render(<NewFrameworkForm frameworks={frameworks} />);
    await userEvent.type(screen.getByLabelText("Name"), "   ");
    await userEvent.type(screen.getByLabelText("Version"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create Framework" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name and version are required.");
    expect(fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the reason when the route refuses, for example a duplicate, and stays on the form", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "A Framework with that name and version already exists" }), { status: 409 }));
    render(<NewFrameworkForm frameworks={frameworks} />);
    await userEvent.type(screen.getByLabelText("Name"), "ISO/IEC 27001");
    await userEvent.type(screen.getByLabelText("Version"), "2013");
    await userEvent.click(screen.getByRole("button", { name: "Create Framework" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A Framework with that name and version already exists");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Framework" })).toBeEnabled();
  });

  it("shows a failure when the request itself fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    render(<NewFrameworkForm frameworks={frameworks} />);
    await userEvent.type(screen.getByLabelText("Name"), "NIS2");
    await userEvent.type(screen.getByLabelText("Version"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Create Framework" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to create the Framework");
    expect(push).not.toHaveBeenCalled();
  });

  it("links back to the list", () => {
    render(<NewFrameworkForm frameworks={frameworks} />);
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/frameworks");
  });
});
