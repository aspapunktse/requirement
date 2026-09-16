"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";

/**
 * The dev-stub-gated picker shown at `/` when no acting user is set yet —
 * a stand-in for a future real login page. Picking a user sets the acting
 * user cookie and lands on /home, same destination the header RoleSwitcher
 * redirects to on a mid-session switch. See #59.
 */
export function RoleChecker() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickingId, setPickingId] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const response = await fetch("/api/users");
      const body = await response.json();
      if (cancelled) return;
      setUsers(body.users ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(userId: string) {
    setPickingId(userId);
    await fetch("/api/session/acting-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    router.push("/home");
    router.refresh();
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading users…</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {users.map((user) => (
        <li key={user.id}>
          <button
            type="button"
            onClick={() => pick(user.id)}
            disabled={pickingId !== ""}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--ems-radius-2)] border border-zinc-200 p-4 text-left hover:border-ems-amber-hover disabled:opacity-50 dark:border-zinc-800"
          >
            <span className="font-medium">{user.name}</span>
            <span className="ems-mono-label text-ems-ink-4">{user.role.replace(/_/g, " ")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
