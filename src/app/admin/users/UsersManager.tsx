"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import type { UserRole } from "@prisma/client";
import { Icon } from "@/app/home/HomeGraphics";
import { useSearchHotkey } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { StatusChip } from "@/components/ui/StatusChip";
import { ALL_ROLES, describeHoldings, roleName, type AdminUser, type UserHoldings } from "@/lib/user-admin-shared";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./users.css";

export type ManagedUser = AdminUser & { holdings: UserHoldings };

type FormState = { mode: "new" } | { mode: "edit"; id: string } | null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (iso: string) => iso.slice(0, 10);
const byName = (a: ManagedUser, b: ManagedUser) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email);

/**
 * Admin -> Users (#364), in the Home look: a stat card per role that has Users (and "All Users") that filters the
 * list, a search field, the list, and one form above it to create a User or edit one's name, email and role. A role
 * change is always allowed (decision 1a); the form lists what the User still holds that the new role doesn't use.
 * The server refuses a demotion of the last Admin (409) and a duplicate email (409); both are shown on the form.
 */
export function UsersManager({ initialUsers, actingUserId }: { initialUsers: ManagedUser[]; actingUserId: string }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const editing = form?.mode === "edit" ? (users.find((user) => user.id === form.id) ?? null) : null;
  const adminCount = users.filter((user) => user.role === "ADMIN").length;

  // Ctrl+K: each User opens in the form, in place.
  const paletteItems = useMemo(
    () => users.map((user) => ({ group: "Users", icon: "search" as const, label: user.name, meta: `${user.email} · ${roleName(user.role)}`, href: "/admin/users" })),
    [users],
  );
  usePagePalette({
    items: paletteItems,
    placeholder: "Find a User",
    onSelect: (item) => {
      const user = users.find((candidate) => `${candidate.email} · ${roleName(candidate.role)}` === item.meta && candidate.name === item.label);
      if (user) setForm({ mode: "edit", id: user.id });
    },
  });

  const roleCounts = ALL_ROLES.map((role) => ({ role, count: users.filter((user) => user.role === role).length })).filter((entry) => entry.count > 0);
  const needle = query.trim().toLowerCase();
  const listed = users
    .filter((user) => !roleFilter || user.role === roleFilter)
    .filter((user) => !needle || `${user.name} ${user.email}`.toLowerCase().includes(needle))
    .sort(byName);

  function saved(user: ManagedUser, created: boolean) {
    setUsers((current) => (created ? [...current, user] : current.map((item) => (item.id === user.id ? user : item))));
    setNotice(created ? `Created ${user.name}.` : `Saved ${user.name}.`);
    setForm(null);
    // An Admin who gave themself another role is no longer allowed on this page: reload it, which shows that.
    if (user.id === actingUserId && user.role !== "ADMIN") router.refresh();
  }

  return (
    <div className="hc sy us" data-page-id="ADMIN USERS">
      <section className="hc-hero" aria-labelledby="us-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Admin / Users</span>
          </div>
          <h1 id="us-title">Users</h1>
          <p className="hc-lede">
            Create Users, rename them and give them a role. {plural(users.length, "User")} in all. A Business Risk Owner&apos;s Business Unit and Framework
            scope is assigned on the Business Risk Owners page.
          </p>
        </div>
      </section>

      <section className="hc-stats" aria-label="Users by role">
        <button type="button" className="hc-card hc-stat" aria-pressed={roleFilter === ""} onClick={() => setRoleFilter("")}>
          <span className="k">
            All Users
            <em aria-hidden="true">Filter →</em>
          </span>
          <span className="v">{users.length}</span>
        </button>
        {roleCounts.map(({ role, count }) => (
          <button
            key={role}
            type="button"
            className="hc-card hc-stat"
            aria-pressed={roleFilter === role}
            onClick={() => setRoleFilter(roleFilter === role ? "" : role)}
          >
            <span className="k">
              {roleName(role)}
              <em aria-hidden="true">Filter →</em>
            </span>
            <span className="v">{count}</span>
          </button>
        ))}
      </section>

      {form && (
        <UserForm
          // A new form state for each User opened (or a new one), so its fields start from that User.
          key={form.mode === "new" ? "new" : form.id}
          user={editing}
          users={users}
          isLastAdmin={editing?.role === "ADMIN" && adminCount === 1}
          isYou={editing?.id === actingUserId}
          onCancel={() => setForm(null)}
          onSaved={saved}
        />
      )}

      <section className="hc-card sy-reg" aria-labelledby="us-reg-h">
        <div className="hc-card-h">
          <h2 id="us-reg-h">User list</h2>
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search by name or email"
              aria-label="Search Users"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="us-grow" />
          <button type="button" className="hc-btn primary" onClick={() => setForm({ mode: "new" })}>
            New user
          </button>
        </div>

        <div aria-live="polite">
          {notice && (
            <p className="us-banner ok" role="status">
              {notice}{" "}
              <button type="button" className="us-link-btn" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
        </div>

        <div className="sy-tablewrap">
          <table className="us-t" aria-label="Users">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="name">
                      <b>{user.name}</b>
                      {user.id === actingUserId && <span className="us-you">you</span>}
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <StatusChip tone={user.role === "ADMIN" ? "accent" : "neutral"}>{roleName(user.role)}</StatusChip>
                    {user.role === "BUSINESS_RISK_OWNER" && (
                      <>
                        {" "}
                        <Link href="/admin/business-risk-owners" className="us-link" aria-label={`Business Unit and Framework scope of ${user.name}`}>
                          Scope
                        </Link>
                      </>
                    )}
                  </td>
                  <td className="muted">{day(user.createdAt)}</td>
                  <td className="us-actions">
                    <button type="button" className="hc-btn" aria-label={`Edit ${user.name}`} onClick={() => setForm({ mode: "edit", id: user.id })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={5} className="hc-empty">
                    {users.length === 0 ? "No Users yet." : "No User matches the search and filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span className="num" role="status">
            {listed.length} of {users.length} Users
          </span>
        </div>
      </section>
    </div>
  );
}

/** The create / edit form. Sends POST /api/users or PATCH /api/users/:id and hands the saved User back. */
function UserForm({
  user,
  users,
  isLastAdmin,
  isYou,
  onCancel,
  onSaved,
}: {
  /** The User being edited, or null to create one. */
  user: ManagedUser | null;
  users: ManagedUser[];
  isLastAdmin: boolean;
  isYou: boolean;
  onCancel: () => void;
  onSaved: (user: ManagedUser, created: boolean) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<UserRole | "">(user?.role ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const changed = !user || trimmedName !== user.name || normalizedEmail !== user.email || role !== user.role;
  const complete = trimmedName !== "" && normalizedEmail !== "" && role !== "";
  const roleChanged = !!user && role !== "" && role !== user.role;
  const warnings = user && roleChanged ? describeHoldings(user.holdings, role as UserRole) : [];
  const duplicate = users.some((other) => other.id !== user?.id && other.email.toLowerCase() === normalizedEmail);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(user ? `/api/users/${user.id}` : "/api/users", {
        method: user ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: normalizedEmail, role }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Could not save the User.");
        return;
      }
      const saved = body.user as AdminUser;
      onSaved({ ...saved, holdings: user?.holdings ?? { ownedSystems: 0, businessOwnedSystems: 0, businessUnitScopes: 0, frameworkScopes: 0 } }, !user);
    } catch {
      setError("Could not save the User.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hc-card" aria-labelledby="us-form-h">
      <div className="hc-card-h">
        <h2 id="us-form-h">{user ? `Edit ${user.name}` : "New user"}</h2>
      </div>
      <form className="us-form" onSubmit={submit}>
        <div className="us-fields">
          <label className="us-field">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoComplete="off" required />
          </label>
          <label className="us-field">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="off" required />
          </label>
          <label className="us-field">
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)} required disabled={isLastAdmin}>
              {!user && (
                <option value="" disabled>
                  Pick a role
                </option>
              )}
              {ALL_ROLES.map((value) => (
                <option key={value} value={value}>
                  {roleName(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {isLastAdmin && <p className="muted">This is the last Admin, so the role can&apos;t change until another User is made an Admin.</p>}
        {isYou && roleChanged && role !== "ADMIN" && <p className="us-error">You are changing your own role: you will lose access to this page once it is saved.</p>}
        {duplicate && <p className="us-error">A User with this email already exists.</p>}
        {warnings.length > 0 && (
          <div className="us-banner warn" role="alert">
            <div>
              <b>
                {user?.name} still holds things the {roleName(role as UserRole)} role doesn&apos;t use. Nothing is removed or moved.
              </b>
              <ul>
                {warnings.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {error && (
          <p className="us-error" role="alert">
            {error}
          </p>
        )}
        <div className="us-formacts">
          <button type="submit" className="hc-btn primary" disabled={!complete || !changed || saving || duplicate}>
            {saving ? "Saving…" : user ? "Save" : "Create user"}
          </button>
          <button type="button" className="hc-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
