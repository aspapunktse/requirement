"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BusinessSystemOwnerPicker } from "@/components/BusinessSystemOwnerPicker";

/**
 * Set, change or clear a System's Business System Owner from the System page (#321), through
 * `PUT /api/systems/[id]/business-system-owner`. The System's owner can't be picked, so they are left out
 * of the list. Clearing is the "Not set" choice.
 */
export function ChangeBusinessSystemOwnerDialog({
  system,
  onClose,
  onDone,
}: {
  system: { id: string; name: string; ownerId: string; businessSystemOwnerId: string | null; businessSystemOwnerName: string | null };
  onClose: () => void;
  /** Called after a successful save. */
  onDone: () => void;
}) {
  const titleId = useId();
  const [value, setValue] = useState(system.businessSystemOwnerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unchanged = value === (system.businessSystemOwnerId ?? "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (unchanged) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${system.id}/business-system-owner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessSystemOwnerId: value || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Failed to change the Business System Owner");
        return;
      }
      onDone();
    } catch {
      setError("Failed to change the Business System Owner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-rg-scrim" onClick={onClose} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(480px,calc(100vw-32px))] overflow-y-auto -translate-x-1/2 flex-col gap-3 rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Business System Owner
        </h2>
        <p className="text-rg-muted">
          {system.name}: {system.businessSystemOwnerName ? `${system.businessSystemOwnerName} is the Business System Owner.` : "no Business System Owner is set."} They decide
          the System&apos;s evaluation gates and can see it at any stage. Any user can be one except the System&apos;s owner.
        </p>
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}
        <BusinessSystemOwnerPicker label="Business System Owner" noneLabel="Not set (clear)" value={value} onChange={setValue} excludeUserId={system.ownerId} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || unchanged}>
            Save
          </Button>
        </div>
      </form>
    </>
  );
}
