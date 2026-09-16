"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";

/**
 * The `/` role-checker/picker: a card per seeded user, click to act as them
 * and move on to `/home`. Distinct from the header RoleSwitcher's dropdown —
 * this stands in for a real login page, so it gets a more deliberate,
 * full-page picker rather than a compact mid-session switcher. See #59.
 */
export function RolePicker({ users, actingUserId }: { users: PublicUser[]; actingUserId: string | null }) {
  const router = useRouter();
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  async function pickUser(userId: string) {
    setPendingUserId(userId);
    await fetch("/api/session/acting-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    router.push("/home");
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {users.map((user) => {
        const isActing = user.id === actingUserId;
        return (
          <button
            key={user.id}
            type="button"
            onClick={() => pickUser(user.id)}
            disabled={pendingUserId !== null}
            className={`flex flex-col gap-1 rounded-[var(--ems-radius-2)] border p-4 text-left hover:border-ems-amber-hover disabled:opacity-60 dark:border-zinc-800 ${
              isActing ? "border-ems-amber" : "border-zinc-200"
            }`}
          >
            <span className="font-medium">{user.name}</span>
            <span className="ems-mono-label text-ems-ink-4">{user.role.replace(/_/g, " ")}</span>
            {isActing && <span className="mt-1 text-xs text-ems-ink-3">Currently acting as this user</span>}
          </button>
        );
      })}
    </div>
  );
}
