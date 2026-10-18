"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { frameworkLabel } from "@/lib/framework-label";
import { ReviewGroupEmptyWarning } from "@/components/ReviewGroupEmptyWarning";

export type ReviewGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  members: { id: string }[];
  frameworks: { id: string; name: string; version: string }[];
};

const INPUT_CLASS =
  "rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 text-sm text-rg-ink placeholder:text-rg-muted";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

/** The Review Groups list: every group with its member count and tied Frameworks, and a form to create one. */
export function ReviewGroupManager() {
  const [groups, setGroups] = useState<ReviewGroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  /** Reloads the list after a change. On failure keeps the list and says the change was saved but the list is stale. */
  async function reload() {
    try {
      const response = await fetch("/api/review-groups");
      if (!response.ok) throw new Error("refresh failed");
      setGroups((await response.json()).reviewGroups ?? []);
    } catch {
      setError("The Review Group was created, but the list could not be refreshed. Reload the page.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/review-groups")
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorMessage(response, "Failed to load Review Groups"));
        return (await response.json()).reviewGroups as ReviewGroupSummary[];
      })
      .then((loaded) => {
        if (!cancelled) setGroups(loaded ?? []);
      })
      .catch((caught: Error) => {
        if (cancelled) return;
        setError(caught.message);
        setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    let response: Response;
    try {
      response = await fetch("/api/review-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, description: newDescription || undefined }),
      });
    } catch {
      setError("Failed to create the Review Group: the server could not be reached");
      return;
    }
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to create the Review Group"));
      return;
    }
    setNewName("");
    setNewDescription("");
    await reload();
  }

  if (groups === null) return <p>Loading Review Groups…</p>;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-rg-danger">
          {error}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-rg-muted">No Review Groups yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((group) => (
            <li key={group.id} className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-3">
              <Link href={`/admin/review-groups/${group.id}`} className="font-semibold text-rg-accent hover:underline">
                {group.name}
              </Link>
              {group.description && <p className="mt-1 text-sm text-rg-muted">{group.description}</p>}
              <p className="mt-1 text-sm text-rg-muted">
                {group.members.length} {group.members.length === 1 ? "member" : "members"}
                {" · "}
                {group.frameworks.length === 0
                  ? "not tied to a Framework"
                  : `tied to ${group.frameworks.map(frameworkLabel).join(", ")}`}
              </p>
              {group.frameworks.length > 0 && group.members.length === 0 && (
                <div className="mt-2">
                  <ReviewGroupEmptyWarning />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="flex flex-col gap-2 border-t border-rg-line pt-4">
        <h2 className="text-base">Add a Review Group</h2>
        <input
          aria-label="Name"
          placeholder="Name"
          className={INPUT_CLASS}
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          required
        />
        <textarea
          aria-label="New Review Group description"
          placeholder="Description (optional)"
          className={INPUT_CLASS}
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
        />
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </div>
  );
}
