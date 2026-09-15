"use client";

import { useEffect, useState } from "react";

type CatalogItem = { id: string; name: string };
type User = { id: string; name: string; email: string };

/**
 * Admin screen for assigning each BUSINESS_RISK_OWNER User their Business
 * Unit and Framework portfolio — the two independent axes settled in #55
 * (a Business Risk Owner may own Business Units, Frameworks, or both, not
 * necessarily paired).
 */
export function BusinessRiskOwnerAssignments() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [businessUnits, setBusinessUnits] = useState<CatalogItem[]>([]);
  const [frameworks, setFrameworks] = useState<CatalogItem[]>([]);
  const [assignedBusinessUnits, setAssignedBusinessUnits] = useState<Record<string, CatalogItem[]>>({});
  const [assignedFrameworks, setAssignedFrameworks] = useState<Record<string, CatalogItem[]>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    const [usersRes, businessUnitsRes, frameworksRes] = await Promise.all([
      fetch("/api/users?role=BUSINESS_RISK_OWNER"),
      fetch("/api/business-units"),
      fetch("/api/frameworks"),
    ]);
    const usersBody = await usersRes.json();
    const businessUnitsBody = await businessUnitsRes.json();
    const frameworksBody = await frameworksRes.json();
    const loadedUsers: User[] = usersBody.users ?? [];

    const [businessUnitScopes, frameworkScopes] = await Promise.all([
      Promise.all(loadedUsers.map((u) => fetch(`/api/users/${u.id}/business-unit-scopes`).then((r) => r.json()))),
      Promise.all(loadedUsers.map((u) => fetch(`/api/users/${u.id}/framework-scopes`).then((r) => r.json()))),
    ]);

    setUsers(loadedUsers);
    setBusinessUnits(businessUnitsBody.businessUnits ?? []);
    setFrameworks(frameworksBody.frameworks ?? []);
    setAssignedBusinessUnits(
      Object.fromEntries(loadedUsers.map((u, i) => [u.id, businessUnitScopes[i].businessUnits ?? []])),
    );
    setAssignedFrameworks(Object.fromEntries(loadedUsers.map((u, i) => [u.id, frameworkScopes[i].frameworks ?? []])));
  }

  useEffect(() => {
    let cancelled = false;
    loadAll().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleBusinessUnit(userId: string, businessUnitId: string, assigned: boolean) {
    setError(null);
    const response = await fetch(
      assigned
        ? `/api/users/${userId}/business-unit-scopes/${businessUnitId}`
        : `/api/users/${userId}/business-unit-scopes`,
      {
        method: assigned ? "DELETE" : "POST",
        headers: assigned ? undefined : { "Content-Type": "application/json" },
        body: assigned ? undefined : JSON.stringify({ businessUnitId }),
      },
    );
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to update assignment");
      return;
    }
    const body = await response.json();
    setAssignedBusinessUnits((prev) => ({ ...prev, [userId]: body.businessUnits }));
  }

  async function toggleFramework(userId: string, frameworkId: string, assigned: boolean) {
    setError(null);
    const response = await fetch(
      assigned ? `/api/users/${userId}/framework-scopes/${frameworkId}` : `/api/users/${userId}/framework-scopes`,
      {
        method: assigned ? "DELETE" : "POST",
        headers: assigned ? undefined : { "Content-Type": "application/json" },
        body: assigned ? undefined : JSON.stringify({ frameworkId }),
      },
    );
    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to update assignment");
      return;
    }
    const body = await response.json();
    setAssignedFrameworks((prev) => ({ ...prev, [userId]: body.frameworks }));
  }

  if (users === null) {
    return <p>Loading Business Risk Owners…</p>;
  }

  if (users.length === 0) {
    return <p className="text-sm text-zinc-500">No Users have the Business Risk Owner role yet.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {users.map((user) => {
        const assignedBU = new Set(assignedBusinessUnits[user.id]?.map((b) => b.id) ?? []);
        const assignedFW = new Set(assignedFrameworks[user.id]?.map((f) => f.id) ?? []);

        return (
          <div key={user.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">
              {user.name} <span className="font-normal text-zinc-500">({user.email})</span>
            </h3>

            <fieldset className="mt-2 flex flex-col gap-1">
              <legend className="text-xs font-semibold text-zinc-500">Business Units</legend>
              {businessUnits.map((bu) => (
                <label key={bu.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={assignedBU.has(bu.id)}
                    onChange={() => toggleBusinessUnit(user.id, bu.id, assignedBU.has(bu.id))}
                  />
                  {bu.name}
                </label>
              ))}
            </fieldset>

            <fieldset className="mt-2 flex flex-col gap-1">
              <legend className="text-xs font-semibold text-zinc-500">Frameworks</legend>
              {frameworks.map((framework) => (
                <label key={framework.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={assignedFW.has(framework.id)}
                    onChange={() => toggleFramework(user.id, framework.id, assignedFW.has(framework.id))}
                  />
                  {framework.name}
                </label>
              ))}
            </fieldset>
          </div>
        );
      })}
    </div>
  );
}
