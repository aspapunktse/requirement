"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";
import { Button } from "@/components/ui/Button";

/**
 * The dev-stub-gated sign-in form shown at `/` when no acting user is set
 * yet — a stand-in for a future real login page. Pick a user tile, then
 * press "Sign in →" to set the acting user cookie and land on /home, same
 * destination the header RoleSwitcher redirects to on a mid-session
 * switch. See #59 and #64.
 */
export function RoleChecker() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [signingIn, setSigningIn] = useState(false);

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

  async function signIn() {
    if (!selectedId) return;
    setSigningIn(true);
    await fetch("/api/session/acting-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedId }),
    });
    router.push("/home");
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        signIn();
      }}
    >
      <div id="sign-in-as" className="ems-mono-label mb-2 text-ems-ink-3">
        Sign in as · Dev user
      </div>

      {loading ? (
        <p className="text-sm text-ems-ink-3">Loading users…</p>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby="sign-in-as"
          className="flex flex-wrap pt-px pl-px"
        >
          {users.map((user) => {
            const selected = user.id === selectedId;
            return (
              <label
                key={user.id}
                className={`-mt-px -ml-px flex min-h-16 min-w-36 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 border border-zinc-300 px-2 py-2 text-center outline-offset-[-2px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ems-ink-1 dark:border-zinc-700 ${
                  selected ? "bg-ems-amber text-ems-ink-0" : "hover:bg-ems-amber-tint"
                }`}
              >
                <input
                  type="radio"
                  name="acting-user"
                  value={user.id}
                  checked={selected}
                  onChange={() => setSelectedId(user.id)}
                  disabled={signingIn}
                  className="sr-only"
                />
                <span className={`ems-mono-label ${selected ? "text-ems-ink-1" : "text-ems-ink-3"}`}>
                  {user.role.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium">{user.name}</span>
              </label>
            );
          })}
        </div>
      )}

      <Button type="submit" variant="primary" disabled={!selectedId || signingIn} className="mt-6 px-4 py-2">
        Sign in →
      </Button>

      <div className="mt-8 border-t border-zinc-300 pt-3 dark:border-zinc-700">
        <p className="ems-mono-label text-ems-ink-4">{"// Dev auth stub · Not for production"}</p>
      </div>
    </form>
  );
}
