/**
 * Shown wherever a Review Group is tied to a Framework but has no members: its Review Step still exists, but
 * no member can decide it, so only an Admin can (CONTEXT.md, Review Group).
 */
export function ReviewGroupEmptyWarning({ groupName }: { groupName?: string }) {
  return (
    <p role="status" className="rounded-[var(--rg-radius-md)] bg-rg-gold-soft px-3 py-2 text-sm text-rg-gold-ink">
      {groupName ? `${groupName} has` : "This Review Group has"} no members: only an Admin can decide its Review Step.
    </p>
  );
}
