"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicUser } from "@/lib/acting-user";

function roleLabel(role: string) {
  return role.replace(/_/g, " ");
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Avatar, name and role of the acting user: the header's right-hand side. */
export function UserChip({ user }: { user: PublicUser | null }) {
  return (
    <span className="flex items-center gap-3 text-left">
      <span aria-hidden className="grid size-8 shrink-0 place-items-center bg-ems-paper-3 text-xs font-medium text-ems-ink-1">
        {user ? initials(user.name) : "?"}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium text-ems-ink-1">{user ? user.name : "Select a user…"}</span>
        {user && <span className="ems-mono-label truncate text-ems-ink-4">{roleLabel(user.role)}</span>}
      </span>
    </span>
  );
}

/**
 * Dev-stub role switcher: the user chip as a button that opens a listbox of
 * every seeded user, styled like the sign-in tiles (#64). Picking one sets
 * the acting user cookie and lands on /home. See #59 and #65.
 */
export function RoleSwitcher() {
  const router = useRouter();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [actingUserId, setActingUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Set when the highlight moved because of the pointer, so the effect below
  // doesn't scroll the list out from under the mouse. See #68.
  const pointerMovedRef = useRef(false);

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

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (pointerMovedRef.current) {
      pointerMovedRef.current = false;
      return;
    }
    const option = listRef.current?.children[activeIndex];
    option?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const current = users.find((user) => user.id === actingUserId) ?? null;

  function openList() {
    const index = users.findIndex((user) => user.id === actingUserId);
    setActiveIndex(index >= 0 ? index : 0);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  async function choose(userId: string) {
    close();
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

  function onListKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, users.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(users.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (users[activeIndex]) choose(users[activeIndex].id);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  if (loading) {
    return <span className="text-sm text-ems-ink-3">Loading users…</span>;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Acting as ${current ? current.name : "nobody"}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openList();
          }
        }}
        className="flex items-center gap-2 p-1 hover:bg-ems-paper-2 focus-visible:outline-2 focus-visible:outline-ems-ink-1"
      >
        <UserChip user={current} />
        <span aria-hidden className="text-ems-ink-3">
          ▾
        </span>
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label="Acting as"
          aria-activedescendant={users[activeIndex] ? `acting-user-${users[activeIndex].id}` : undefined}
          onKeyDown={onListKeyDown}
          className="absolute right-0 z-10 mt-1 max-h-96 w-64 overflow-y-auto border border-zinc-300 bg-ems-paper-1 shadow-md outline-none dark:border-zinc-700"
        >
          {users.map((user, index) => {
            const selected = user.id === actingUserId;
            return (
              <li
                key={user.id}
                id={`acting-user-${user.id}`}
                role="option"
                aria-selected={selected}
                onClick={() => choose(user.id)}
                onPointerMove={() => {
                  if (index === activeIndex) return;
                  pointerMovedRef.current = true;
                  setActiveIndex(index);
                }}
                className={`flex cursor-pointer flex-col gap-0.5 border-b border-zinc-300 px-3 py-2 last:border-b-0 dark:border-zinc-700 ${
                  selected ? "bg-ems-amber text-ems-ink-0" : index === activeIndex ? "bg-ems-amber-tint" : ""
                } ${index === activeIndex ? "outline-2 -outline-offset-2 outline-ems-ink-1" : ""}`}
              >
                <span className={`ems-mono-label ${selected ? "text-ems-ink-1" : "text-ems-ink-3"}`}>
                  {roleLabel(user.role)}
                </span>
                <span className="text-sm font-medium">{user.name}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
