import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type BoundaryDetail } from "@/lib/compliance-boundary";
import { listBoundariesOfSystem } from "@/lib/compliance-boundary-data";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
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

import ListPage from "../page";
import NewPage from "../new/page";
import EditPage from "../[id]/edit/page";
import DetailPage from "../[id]/page";
import { BoundaryForm } from "../BoundaryForm";
import { BoundaryView } from "../[id]/BoundaryView";
import { SystemBoundaries } from "@/app/systems/[id]/SystemBoundaries";

/**
 * The Compliance Boundary pages (#418): who sees what, and what the forms post. Fixtures are `Test #418 pages …` rows removed in
 * `afterAll`; the page tests render the async server components against real Postgres, the component tests stub `fetch`.
 */
const suffix = `${process.pid}-${Date.now()}`;
const users: Record<string, string> = {};
const roles: [string, UserRole][] = [["cm", "COMPLIANCE_MANAGER"], ["admin", "ADMIN"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["other", "SYSTEM_OWNER"]];
let frameworkId: string;
let boundaryId: string;
const systems: Record<string, string> = {};
const N = (label: string) => `Test #418 pages ${label} ${suffix}`;

beforeAll(async () => {
  for (const [key, role] of roles) users[key] = (await prisma.user.create({ data: { email: `test-418-pages-${key}-${suffix}@example.com`, name: `Test 418 ${key}`, role } })).id;
  frameworkId = (await prisma.framework.create({ data: { name: N("Framework"), version: "1", status: "PUBLISHED" } })).id;
  // An Onboarded System anyone sees, and a Draft only its owner and the full-visibility roles see.
  systems.onboarded = (await prisma.system.create({ data: { name: N("onboarded"), status: "ONBOARDED", ownerId: users.other } })).id;
  systems.draft = (await prisma.system.create({ data: { name: N("draft"), status: "DRAFT", ownerId: users.other } })).id;
  boundaryId = (
    await prisma.complianceBoundary.create({
      data: {
        name: N("Boundary"),
        description: "Contract 12",
        boundaryOwnerId: users.owner,
        frameworks: { create: [{ frameworkId }] },
        systems: { create: [{ systemId: systems.onboarded }, { systemId: systems.draft }] },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.complianceBoundary.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.system.deleteMany({ where: { id: { in: Object.values(systems) } } });
  await prisma.framework.delete({ where: { id: frameworkId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const as = (key: string | null) => {
  acting.userId = key ? users[key] : null;
};

describe("the list page", () => {
  const html = async (key: string | null) => {
    as(key);
    return renderToStaticMarkup(await ListPage());
  };

  it("lists the Boundary with its Frameworks and member count for every role", async () => {
    for (const key of ["cm", "admin", "viewer", "owner", "other"]) {
      const markup = await html(key);
      expect(markup, key).toContain(N("Boundary"));
      expect(markup, key).toContain(`${N("Framework")}:1`);
      expect(markup, key).toContain("2 Systems");
      expect(markup, key).not.toContain("take effect in a later release");
    }
  });

  it("offers New Compliance Boundary to a Compliance Manager and an Admin only", async () => {
    expect(await html("cm")).toContain("New Compliance Boundary");
    expect(await html("admin")).toContain("New Compliance Boundary");
    expect(await html("viewer")).not.toContain("New Compliance Boundary");
    expect(await html("owner")).not.toContain("New Compliance Boundary");
  });

  it("asks to pick a user when nobody is acting", async () => {
    expect(await html(null)).toContain("Pick a user to act as first.");
  });
});

describe("the new and edit pages", () => {
  it("show the form to a Compliance Manager and an Admin, and refuse everyone else", async () => {
    for (const key of ["cm", "admin"]) {
      as(key);
      expect(renderToStaticMarkup(await NewPage()), key).toContain("Create Compliance Boundary");
      const edit = renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: boundaryId }), searchParams: Promise.resolve({}) }));
      expect(edit, key).toContain("Save changes");
      expect(edit, key).toContain(N("Boundary"));
    }
    for (const key of ["viewer", "owner"]) {
      as(key);
      expect(renderToStaticMarkup(await NewPage()), key).toContain("Only Compliance Managers and Admins can add a Compliance Boundary.");
      expect(renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: boundaryId }), searchParams: Promise.resolve({}) })), key).not.toContain("Save changes");
    }
  });

  it("the edit page says so for a Boundary that doesn't exist", async () => {
    as("cm");
    expect(renderToStaticMarkup(await EditPage({ params: Promise.resolve({ id: "missing" }), searchParams: Promise.resolve({}) }))).toContain("Compliance Boundary not found.");
  });
});

describe("the detail page", () => {
  const html = async (key: string | null, id = boundaryId) => {
    as(key);
    return renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
  };

  it("shows every member's name to every role, and links only the Systems the role may see", async () => {
    const viewer = await html("viewer");
    expect(viewer).toContain(N("onboarded"));
    expect(viewer).toContain(N("draft"));
    expect(viewer).toContain(`/systems/${systems.onboarded}`);
    expect(viewer).not.toContain(`/systems/${systems.draft}`);
    expect(viewer).toContain("Not yet operating");
    const cm = await html("cm");
    expect(cm).toContain(`/systems/${systems.draft}`);
    expect(cm).toContain(`/systems/${systems.onboarded}`);
  });

  it("shows add and remove to the Boundary Owner, a Compliance Manager and an Admin, and edit to the last two only", async () => {
    for (const key of ["owner", "cm", "admin"]) {
      const markup = await html(key);
      expect(markup, key).toContain("Add System");
      expect(markup, key).toContain("Remove");
      expect(markup.includes("/edit"), key).toBe(key !== "owner");
    }
    for (const key of ["viewer", "other"]) {
      const markup = await html(key);
      expect(markup, key).not.toContain("Add System");
      expect(markup, key).not.toContain("Remove");
      expect(markup, key).not.toContain("/edit");
    }
  });

  it("says so for a Boundary that doesn't exist", async () => {
    expect(await html("viewer", "missing")).toContain("Compliance Boundary not found");
  });
});

describe("the Boundary view", () => {
  const boundary: BoundaryDetail = {
    id: "b1",
    name: "FCI boundary",
    description: null,
    businessUnit: null,
    boundaryOwner: { id: "u1", name: "Olle Owner" },
    frameworks: [{ id: "f1", name: "CMMC", version: "L1" }],
    members: [
      { systemId: "s1", name: "Payroll", state: "OPERATING", status: "ONBOARDED", addedAt: "2026-11-22T00:00:00.000Z", addedByName: null },
      { systemId: "s2", name: "Old CRM", state: "CLOSED", status: "NOT_SELECTED", addedAt: "2026-11-22T00:00:00.000Z", addedByName: null },
    ],
    createdAt: "2026-11-22T00:00:00.000Z",
    updatedAt: "2026-11-22T00:00:00.000Z",
  };
  const candidates = [{ id: "s3", name: "Planned ERP", state: "NOT_YET_OPERATING" as const }];
  const calls = () => vi.mocked(fetch).mock.calls;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("labels each member's state and links only the linkable ones", () => {
    render(<BoundaryView boundary={boundary} linkableSystemIds={["s1"]} candidates={candidates} canManageMembers canCurate={false} />);
    expect(screen.getByRole("link", { name: "Payroll" })).toHaveAttribute("href", "/systems/s1");
    expect(screen.queryByRole("link", { name: "Old CRM" })).toBeNull();
    expect(screen.getByText("Old CRM")).toBeInTheDocument();
    expect(screen.getByText("Operating")).toBeInTheDocument();
    expect(screen.getByText("Closed: Not selected")).toBeInTheDocument();
    expect(screen.queryByText(/take effect in a later release/)).toBeNull();
  });

  it("adds the chosen System with a POST and refreshes the page", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ boundary }), { status: 201 }));
    render(<BoundaryView boundary={boundary} linkableSystemIds={[]} candidates={candidates} canManageMembers canCurate />);
    const button = screen.getByRole("button", { name: "Add System" });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Add a System"), "s3");
    await userEvent.click(button);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[0][0]).toBe("/api/compliance-boundaries/b1/systems");
    expect(calls()[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(calls()[0][1]!.body as string)).toEqual({ systemId: "s3" });
  });

  it("removes a member with a DELETE, and shows the server's refusal without refreshing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Only the Boundary Owner can." }), { status: 403 }));
    render(<BoundaryView boundary={boundary} linkableSystemIds={[]} candidates={[]} canManageMembers canCurate={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Payroll" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the Boundary Owner can.");
    expect(calls()[0][0]).toBe("/api/compliance-boundaries/b1/systems/s1");
    expect(calls()[0][1]).toMatchObject({ method: "DELETE" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows no add or remove controls and no Edit link to a reader", () => {
    render(<BoundaryView boundary={boundary} linkableSystemIds={["s1"]} candidates={[]} canManageMembers={false} canCurate={false} />);
    expect(screen.queryByRole("button", { name: /Remove|Add System/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
  });
});

describe("the Boundary form", () => {
  const choices = {
    frameworks: [
      { id: "f1", name: "CMMC", version: "L1" },
      { id: "f2", name: "ISO/IEC 27001", version: "2022" },
    ],
    businessUnits: [{ id: "bu1", name: "Finance" }],
    users: [{ id: "u1", name: "Olle Owner" }],
  };
  const posts = () => vi.mocked(fetch).mock.calls;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("creates with a POST of the details and opens the new Boundary", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ boundary: { id: "b-new" } }), { status: 201 }));
    render(<BoundaryForm choices={choices} />);
    await userEvent.type(screen.getByLabelText("Name"), "  UK contract ");
    await userEvent.type(screen.getByLabelText("Description"), "Contract 9");
    await userEvent.selectOptions(screen.getByLabelText("Business Unit"), "bu1");
    await userEvent.selectOptions(screen.getByLabelText("Boundary Owner"), "u1");
    await userEvent.click(screen.getByRole("checkbox", { name: "CMMC:L1" }));
    await userEvent.click(screen.getByRole("button", { name: "Create Compliance Boundary" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/compliance-boundaries/b-new"));
    expect(posts()[0][0]).toBe("/api/compliance-boundaries");
    expect(posts()[0][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(posts()[0][1]!.body as string)).toEqual({ name: "UK contract", description: "Contract 9", businessUnitId: "bu1", boundaryOwnerId: "u1", frameworkIds: ["f1"] });
  });

  it("refuses a blank name and a Boundary with no Framework before sending anything", async () => {
    render(<BoundaryForm choices={choices} />);
    await userEvent.click(screen.getByRole("button", { name: "Create Compliance Boundary" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the Compliance Boundary a name.");
    await userEvent.type(screen.getByLabelText("Name"), "Named");
    await userEvent.click(screen.getByRole("button", { name: "Create Compliance Boundary" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least one Framework");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("edits with a PATCH, starting from the Boundary's values, and shows the server's error", async () => {
    const boundary = {
      id: "b1",
      name: "FCI boundary",
      description: "Old",
      businessUnit: { id: "bu1", name: "Finance" },
      boundaryOwner: null,
      frameworks: [{ id: "f1", name: "CMMC", version: "L1" }],
      members: [],
      createdAt: "",
      updatedAt: "",
    } satisfies BoundaryDetail;
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'A Compliance Boundary named "X" already exists.' }), { status: 409 }));
    render(<BoundaryForm choices={choices} boundary={boundary} />);
    expect(screen.getByLabelText("Name")).toHaveValue("FCI boundary");
    expect(screen.getByRole("checkbox", { name: "CMMC:L1" })).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "ISO/IEC 27001:2022" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(posts()[0][0]).toBe("/api/compliance-boundaries/b1");
    expect(posts()[0][1]).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(posts()[0][1]!.body as string)).toMatchObject({ businessUnitId: "bu1", boundaryOwnerId: null, frameworkIds: ["f1", "f2"] });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("the System page's Boundaries card", () => {
  it("reads the Boundaries a System is in from the database", async () => {
    expect(await listBoundariesOfSystem(systems.onboarded)).toEqual([
      { id: boundaryId, name: N("Boundary"), ownerName: "Test 418 owner", frameworks: [{ id: frameworkId, name: N("Framework"), version: "1" }] },
    ]);
    expect(await listBoundariesOfSystem("missing")).toEqual([]);
  });

  it("lists the Boundaries read-only, with their Frameworks, or says there are none", () => {
    render(<SystemBoundaries boundaries={[{ id: "b1", name: "FCI boundary", ownerName: "Olle Owner", frameworks: [{ id: "f1", name: "CMMC", version: "L1" }] }]} />);
    expect(screen.getByRole("link", { name: "FCI boundary" })).toHaveAttribute("href", "/compliance-boundaries/b1");
    expect(screen.getByText("CMMC:L1")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<SystemBoundaries boundaries={[]} />);
    expect(screen.getByText("This System is not in any Compliance Boundary.")).toBeInTheDocument();
  });
});
