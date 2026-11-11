import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeHoldings } from "@/lib/user-admin-shared";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { UsersManager, type ManagedUser } from "../UsersManager";

const none = { ownedSystems: 0, businessOwnedSystems: 0, businessUnitScopes: 0, frameworkScopes: 0 };
const users: ManagedUser[] = [
  { id: "u1", name: "Test Ada Admin", email: "ada@example.com", role: "ADMIN", createdAt: "2026-01-02T10:00:00.000Z", holdings: none },
  { id: "u2", name: "Test Bo Owner", email: "bo@example.com", role: "SYSTEM_OWNER", createdAt: "2026-02-03T10:00:00.000Z", holdings: { ...none, ownedSystems: 3, businessOwnedSystems: 1 } },
  { id: "u3", name: "Test Cy Risk", email: "cy@example.com", role: "BUSINESS_RISK_OWNER", createdAt: "2026-03-04T10:00:00.000Z", holdings: { ...none, businessUnitScopes: 2, frameworkScopes: 1 } },
  { id: "u4", name: "Test Di Owner", email: "di@example.com", role: "SYSTEM_OWNER", createdAt: "2026-04-05T10:00:00.000Z", holdings: none },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const saved = (user: Omit<ManagedUser, "holdings">) => json({ user, changed: true });

const renderManager = (list: ManagedUser[] = users, actingUserId = "u1") => render(<UsersManager initialUsers={list} actingUserId={actingUserId} />);
const names = () =>
  within(screen.getByRole("table", { name: "Users" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent);

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UsersManager: the list (#364)", () => {
  it("lists each User with email, role and created date, by name, and links a Business Risk Owner to its scope page", () => {
    renderManager();
    expect(names()).toEqual(["Test Ada Adminyou", "Test Bo Owner", "Test Cy Risk", "Test Di Owner"]);
    const row = screen.getByRole("button", { name: "Edit Test Cy Risk" }).closest("tr") as HTMLElement;
    expect(within(row).getByText("cy@example.com")).toBeInTheDocument();
    expect(within(row).getByText("Business Risk Owner")).toBeInTheDocument();
    expect(within(row).getByText("2026-03-04")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: /Business Unit and Framework scope of Test Cy Risk/ })).toHaveAttribute("href", "/admin/business-risk-owners");
    const other = screen.getByRole("button", { name: "Edit Test Bo Owner" }).closest("tr") as HTMLElement;
    expect(within(other).queryByRole("link")).toBeNull();
  });

  it("has a stat card for All Users and one per role that has Users, with counts, and filters by it", async () => {
    renderManager();
    const stats = within(screen.getByRole("region", { name: "Users by role" }));
    expect(stats.getAllByRole("button").map((b) => b.textContent?.replace("Filter →", ""))).toEqual(["All Users4", "Admin1", "System Owner2", "Business Risk Owner1"]);
    expect(stats.getByRole("button", { name: /All Users/ })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(stats.getByRole("button", { name: /System Owner/ }));
    expect(names()).toEqual(["Test Bo Owner", "Test Di Owner"]);
    expect(stats.getByRole("button", { name: /System Owner/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent("2 of 4 Users");

    // Pressing it again, or All Users, clears the filter.
    await userEvent.click(stats.getByRole("button", { name: /System Owner/ }));
    expect(names()).toHaveLength(4);
    await userEvent.click(stats.getByRole("button", { name: /^Admin/ }));
    expect(names()).toEqual(["Test Ada Adminyou"]);
    await userEvent.click(stats.getByRole("button", { name: /All Users/ }));
    expect(names()).toHaveLength(4);
  });

  it("searches by name or email, together with the role filter, and says when nothing matches", async () => {
    renderManager();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Users" }), "BO@");
    expect(names()).toEqual(["Test Bo Owner"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search Users" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search Users" }), "owner");
    expect(names()).toEqual(["Test Bo Owner", "Test Di Owner"]);
    await userEvent.click(within(screen.getByRole("region", { name: "Users by role" })).getByRole("button", { name: /^Admin/ }));
    expect(screen.getByText("No User matches the search and filter.")).toBeInTheDocument();
  });
});

describe("UsersManager: creating a User (#364)", () => {
  it("needs a name, an email and a role, posts them, and adds the User to the list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(saved({ id: "u5", name: "Test Ed New", email: "ed@example.com", role: "VIEWER", createdAt: "2026-05-06T10:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "New user" }));
    const submit = screen.getByRole("button", { name: "Create user" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Name"), "  Test Ed New ");
    await userEvent.type(screen.getByLabelText("Email"), "Ed@Example.com");
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/users", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Test Ed New", email: "ed@example.com", role: "VIEWER" }) }));
    expect(await screen.findByText("Created Test Ed New.")).toBeInTheDocument();
    expect(names()).toContain("Test Ed New");
    expect(screen.queryByRole("heading", { name: "New user" })).toBeNull();
  });

  it("shows the server's message when the email is taken and keeps the form", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "A User with this email already exists" }, 409)));
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "New user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Test Ed New");
    await userEvent.type(screen.getByLabelText("Email"), "someone@elsewhere.com");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A User with this email already exists");
    expect(screen.getByLabelText("Name")).toHaveValue("Test Ed New");
    expect(names()).toHaveLength(4);
  });

  it("flags an email another listed User has, whatever its case, before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "New user" }));
    await userEvent.type(screen.getByLabelText("Name"), "Test Ed New");
    await userEvent.type(screen.getByLabelText("Email"), "BO@example.com");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    expect(screen.getByText("A User with this email already exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create user" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("UsersManager: editing a User (#364)", () => {
  it("opens the form with the User's values and saves a rename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(saved({ id: "u4", name: "Test Di Renamed", email: "di@example.com", role: "SYSTEM_OWNER", createdAt: "2026-04-05T10:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Di Owner" }));
    expect(screen.getByRole("heading", { name: "Edit Test Di Owner" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("di@example.com");
    expect(screen.getByLabelText("Role")).toHaveValue("SYSTEM_OWNER");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Test Di Renamed");
    await userEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/u4", expect.objectContaining({ method: "PATCH" })));
    expect(await screen.findByText("Saved Test Di Renamed.")).toBeInTheDocument();
    expect(names()).toContain("Test Di Renamed");
    expect(names()).not.toContain("Test Di Owner");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("warns what the User still holds when the new role doesn't use it, and still saves", async () => {
    const fetchMock = vi.fn().mockResolvedValue(saved({ id: "u2", name: "Test Bo Owner", email: "bo@example.com", role: "VIEWER", createdAt: "2026-02-03T10:00:00.000Z" }));
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Bo Owner" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("Nothing is removed or moved");
    expect(warning).toHaveTextContent("Still the owner of 3 Systems");
    expect(warning).toHaveTextContent("Business System Owner of 1 System");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved Test Bo Owner.")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Edit Test Bo Owner" }).closest("tr") as HTMLElement).getByText("Viewer")).toBeInTheDocument();
  });

  it("warns about Business Unit and Framework scopes when a Business Risk Owner gets another role", async () => {
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Cy Risk" }));
    await userEvent.selectOptions(screen.getByLabelText("Role"), "REVIEWER");
    expect(screen.getByRole("alert")).toHaveTextContent("Still assigned 2 Business Units and 1 Framework as a Business Risk Owner");
    await userEvent.selectOptions(screen.getByLabelText("Role"), "BUSINESS_RISK_OWNER");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the role of the only Admin in the list and says why", async () => {
    renderManager([{ ...users[0] }, { ...users[1] }], "u2");
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Ada Admin" }));
    // The only Admin in the list: the role can't be changed from the form at all.
    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByText(/This is the last Admin, so the role can't change/)).toBeInTheDocument();
  });

  it("shows a refusal from the server and keeps the form open", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: "This is the last Admin. Make another User an Admin first." }, 409)));
    const two = [users[0], { ...users[3], id: "u9", name: "Test Ed Admin", email: "ed@example.com", role: "ADMIN" as const }];
    renderManager(two, "u1");
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Ed Admin" }));
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This is the last Admin. Make another User an Admin first.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edit Test Ed Admin" })).toBeInTheDocument();
  });

  it("warns an Admin changing their own role, and reloads the page once it is saved", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(saved({ id: "u1", name: "Test Ada Admin", email: "ada@example.com", role: "VIEWER", createdAt: "2026-01-02T10:00:00.000Z" })));
    const two = [users[0], { ...users[3], id: "u9", name: "Test Ed Admin", email: "ed@example.com", role: "ADMIN" as const }];
    renderManager(two, "u1");
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Ada Admin" }));
    await userEvent.selectOptions(screen.getByLabelText("Role"), "VIEWER");
    expect(screen.getByText(/You are changing your own role/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("closes the form on Cancel without sending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderManager();
    await userEvent.click(screen.getByRole("button", { name: "Edit Test Di Owner" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit Test Di Owner" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("describeHoldings", () => {
  const held = { ownedSystems: 2, businessOwnedSystems: 1, businessUnitScopes: 1, frameworkScopes: 0 };
  it("says nothing when the User holds nothing, or the role uses it", () => {
    expect(describeHoldings(none, "VIEWER")).toEqual([]);
    expect(describeHoldings({ ...held, businessUnitScopes: 0 }, "SYSTEM_OWNER")).toEqual([expect.stringContaining("Business System Owner of 1 System;")]);
    expect(describeHoldings({ ...none, businessUnitScopes: 2 }, "BUSINESS_RISK_OWNER")).toEqual([]);
  });
  it("lists owned Systems, Business System Owner Systems and scopes the new role doesn't use", () => {
    const lines = describeHoldings(held, "VIEWER");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("2 Systems");
    expect(lines[1]).toContain("1 System;");
    expect(lines[2]).toContain("1 Business Unit as a Business Risk Owner");
  });
});
