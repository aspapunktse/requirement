"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/** Deletes a draft Internal Audit after a confirmation, then returns to the list. */
export function DeleteInternalAuditButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete the draft Internal Audit "${title}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal-audits/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to delete the Internal Audit");
        return;
      }
      router.push("/internal-audits");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button onClick={handleDelete} disabled={busy}>
        Delete draft
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
