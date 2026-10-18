"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { frameworkLabel } from "@/lib/framework-label";
import { ReviewGroupEmptyWarning } from "@/components/ReviewGroupEmptyWarning";

export type ReviewGroupDetail = {
  id: string;
  name: string;
  description: string | null;
  members: { id: string; name: string; email: string }[];
  frameworks: { id: string; name: string; version: string }[];
};
/** A User who may be a member (never an Internal Auditor: the page filters those out). */
export type MemberCandidate = { id: string; name: string; email: string };
/** A non-base Framework, with the Review Group it is tied to now, if any. */
export type TieCandidate = { id: string; name: string; version: string; reviewGroupId: string | null };

const INPUT_CLASS =
  "rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 text-sm text-rg-ink placeholder:text-rg-muted";

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * One Review Group's page for an Admin: rename it, add and remove members, tie and untie Frameworks, delete it.
 * The server returns the whole group after each change, so the screen just shows what came back.
 */
export function ReviewGroupEditor({
  initialGroup,
  users,
  frameworks,
}: {
  initialGroup: ReviewGroupDetail;
  users: MemberCandidate[];
  frameworks: TieCandidate[];
}) {
  const router = useRouter();
  const [group, setGroup] = useState(initialGroup);
  const [name, setName] = useState(initialGroup.name);
  const [description, setDescription] = useState(initialGroup.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [userToAdd, setUserToAdd] = useState("");
  const [frameworkToTie, setFrameworkToTie] = useState("");

  const memberIds = new Set(group.members.map((member) => member.id));
  const addableUsers = users.filter((user) => !memberIds.has(user.id));
  const tiedIds = new Set(group.frameworks.map((framework) => framework.id));
  const tieableFrameworks = frameworks.filter(
    (framework) => !tiedIds.has(framework.id) && (framework.reviewGroupId === null || framework.reviewGroupId === group.id),
  );

  /** Sends a request; on a refusal or a network failure shows the error and returns null. */
  async function call(request: () => Promise<Response>, fallback: string): Promise<Response | null> {
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        setError(await errorMessage(response, fallback));
        return null;
      }
      return response;
    } catch {
      setError(`${fallback}: the server could not be reached`);
      return null;
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const response = await call(
      () =>
        fetch(`/api/review-groups/${group.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ name, description }),
        }),
      "Failed to save the Review Group",
    );
    if (!response) return;
    const saved = (await response.json()).reviewGroup as ReviewGroupDetail;
    setGroup(saved);
    setName(saved.name);
    setDescription(saved.description ?? "");
  }

  // The member routes return the updated group, so the screen takes it from there.
  async function handleAddMember(event: React.FormEvent) {
    event.preventDefault();
    if (!userToAdd) return;
    const response = await call(
      () =>
        fetch(`/api/review-groups/${group.id}/members`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ userId: userToAdd }),
        }),
      "Failed to add the member",
    );
    if (!response) return;
    setGroup((await response.json()).reviewGroup);
    setUserToAdd("");
  }

  async function handleRemoveMember(userId: string) {
    const response = await call(
      () => fetch(`/api/review-groups/${group.id}/members/${userId}`, { method: "DELETE" }),
      "Failed to remove the member",
    );
    if (response) setGroup((await response.json()).reviewGroup);
  }

  // The Framework routes don't return the group, so the tied list is updated locally once the server has accepted.
  async function handleTie(event: React.FormEvent) {
    event.preventDefault();
    const framework = frameworks.find((candidate) => candidate.id === frameworkToTie);
    if (!framework) return;
    const response = await call(
      () =>
        fetch(`/api/frameworks/${framework.id}/review-group`, {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({ reviewGroupId: group.id }),
        }),
      "Failed to tie the Framework",
    );
    if (!response) return;
    setGroup((current) => ({
      ...current,
      frameworks: [...current.frameworks, { id: framework.id, name: framework.name, version: framework.version }],
    }));
    setFrameworkToTie("");
  }

  async function handleUntie(frameworkId: string) {
    const response = await call(
      () => fetch(`/api/frameworks/${frameworkId}/review-group`, { method: "DELETE" }),
      "Failed to untie the Framework",
    );
    if (response) {
      setGroup((current) => ({ ...current, frameworks: current.frameworks.filter((f) => f.id !== frameworkId) }));
    }
  }

  async function handleDelete() {
    const response = await call(
      () => fetch(`/api/review-groups/${group.id}`, { method: "DELETE" }),
      "Failed to delete the Review Group",
    );
    if (response) router.push("/admin/review-groups");
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-rg-danger">
          {error}
        </p>
      )}

      {group.frameworks.length > 0 && group.members.length === 0 && <ReviewGroupEmptyWarning />}

      <form onSubmit={handleSave} className="flex flex-col gap-2">
        <input
          aria-label="Name"
          className={`${INPUT_CLASS} font-medium`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <textarea
          aria-label="Description"
          placeholder="Description (optional)"
          className={INPUT_CLASS}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Button type="submit" variant="secondary">
          Save
        </Button>
      </form>

      <section aria-labelledby="review-group-members" className="flex flex-col gap-2">
        <h2 id="review-group-members" className="text-base">
          Members
        </h2>
        {group.members.length === 0 ? (
          <p className="text-sm text-rg-muted">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {group.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {member.name} <span className="text-rg-muted">({member.email})</span>
                </span>
                <Button onClick={() => handleRemoveMember(member.id)} aria-label={`Remove ${member.name}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddMember} className="flex flex-wrap items-center gap-2">
          <select
            aria-label="User to add"
            className={INPUT_CLASS}
            value={userToAdd}
            onChange={(event) => setUserToAdd(event.target.value)}
          >
            <option value="">Add a member…</option>
            {addableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" disabled={!userToAdd}>
            Add member
          </Button>
        </form>
      </section>

      <section aria-labelledby="review-group-frameworks" className="flex flex-col gap-2">
        <h2 id="review-group-frameworks" className="text-base">
          Tied Frameworks
        </h2>
        {group.frameworks.length === 0 ? (
          <p className="text-sm text-rg-muted">Not tied to any Framework.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {group.frameworks.map((framework) => (
              <li key={framework.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{frameworkLabel(framework)}</span>
                <Button onClick={() => handleUntie(framework.id)} aria-label={`Untie ${frameworkLabel(framework)}`}>
                  Untie
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleTie} className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Framework to tie"
            className={INPUT_CLASS}
            value={frameworkToTie}
            onChange={(event) => setFrameworkToTie(event.target.value)}
          >
            <option value="">Tie a Framework…</option>
            {tieableFrameworks.map((framework) => (
              <option key={framework.id} value={framework.id}>
                {frameworkLabel(framework)}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary" disabled={!frameworkToTie}>
            Tie Framework
          </Button>
        </form>
      </section>

      <section className="flex flex-col gap-2 border-t border-rg-line pt-4">
        <h2 className="text-base">Delete</h2>
        <p className="text-sm text-rg-muted">
          A Review Group can only be deleted once it is not tied to any Framework.
        </p>
        <Button onClick={handleDelete}>Delete Review Group</Button>
      </section>
    </div>
  );
}
