"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ReviewGroupEmptyWarning } from "@/components/ReviewGroupEmptyWarning";

export type ReviewGroupOption = { id: string; name: string; memberCount: number };

/**
 * A Framework's Review Group on its page: shows the group (with the no-members warning), and lets a Compliance
 * Manager or Admin tie another or untie it. The base Framework can't be tied. Only an Admin gets a link to the
 * group's own page, which is an Admin page.
 */
export function FrameworkReviewGroup({
  frameworkId,
  isBase,
  groups,
  initialReviewGroupId,
  canOpenGroup,
}: {
  frameworkId: string;
  isBase: boolean;
  groups: ReviewGroupOption[];
  initialReviewGroupId: string | null;
  canOpenGroup: boolean;
}) {
  const [reviewGroupId, setReviewGroupId] = useState(initialReviewGroupId);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const current = groups.find((group) => group.id === reviewGroupId) ?? null;

  async function change(request: () => Promise<Response>, fallback: string) {
    setError(null);
    let response: Response;
    try {
      response = await request();
    } catch {
      setError(`${fallback}: the server could not be reached`);
      return;
    }
    if (!response.ok) {
      let message = fallback;
      try {
        message = (await response.json()).error ?? fallback;
      } catch {
        // keep the fallback
      }
      setError(message);
      return;
    }
    const { framework } = await response.json();
    setReviewGroupId(framework.reviewGroup?.id ?? null);
    setSelected("");
  }

  if (isBase) {
    return (
      <section aria-labelledby="framework-review-group" className="mb-4">
        <h2 id="framework-review-group" className="text-base">
          Review Group
        </h2>
        <p className="text-sm text-rg-muted">
          The base Framework is reviewed by the base Review Step and can&apos;t be tied to a Review Group.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="framework-review-group" className="mb-4 flex flex-col gap-2">
      <h2 id="framework-review-group" className="text-base">
        Review Group
      </h2>
      {error && (
        <p role="alert" className="text-sm text-rg-danger">
          {error}
        </p>
      )}

      {current ? (
        <>
          <p className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              Reviewed by{" "}
              {canOpenGroup ? (
                <Link href={`/admin/review-groups/${current.id}`} className="font-semibold text-rg-accent hover:underline">
                  {current.name}
                </Link>
              ) : (
                <strong>{current.name}</strong>
              )}{" "}
              <span className="text-rg-muted">
                ({current.memberCount} {current.memberCount === 1 ? "member" : "members"})
              </span>
            </span>
            <Button
              onClick={() =>
                change(() => fetch(`/api/frameworks/${frameworkId}/review-group`, { method: "DELETE" }), "Failed to untie")
              }
            >
              Untie
            </Button>
          </p>
          {current.memberCount === 0 && <ReviewGroupEmptyWarning groupName={current.name} />}
        </>
      ) : (
        <>
          <p className="text-sm text-rg-muted">
            No Review Group: this Framework&apos;s non-base Controls fall to the base Review Step.
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!selected) return;
              void change(
                () =>
                  fetch(`/api/frameworks/${frameworkId}/review-group`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reviewGroupId: selected }),
                  }),
                "Failed to tie the Review Group",
              );
            }}
          >
            <select
              aria-label="Review Group to tie"
              className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 text-sm text-rg-ink"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">Tie a Review Group…</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="secondary" disabled={!selected}>
              Tie
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
