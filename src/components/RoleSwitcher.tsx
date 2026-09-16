"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";

export function RoleSwitcher() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [actingUserId, setActingUserId] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [usersResponse, actingResponse] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/session/acting-user"),
      ]);
      const usersBody = await usersResponse.json();
      const actingBody = await actingResponse.json();

      if (cancelled) return;
      setUsers(usersBody.users ?? []);
      setActingUserId(actingBody.user?.id ?? "");
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const userId = event.target.value;
    if (!userId) return;

    setActingUserId(userId);
    await fetch("/api/session/acting-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    // Not every role can see every page, so stay put risks a 404 for the
    // role just switched to — /home is valid for all of them. See #59.
    router.push("/home");
    router.refresh();
  }

  if (loading) {
    return <span>Loading users…</span>;
  }

  return (
    <label>
      Acting as:{" "}
      <select aria-label="Acting as" value={actingUserId} onChange={handleChange}>
        <option value="">Select a user…</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} ({user.role})
          </option>
        ))}
      </select>
    </label>
  );
}
