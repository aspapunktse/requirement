"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SubmitForReviewButton({ systemId }: { systemId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/submit`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to submit for review");
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        className="self-start rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        onClick={handleSubmit}
        disabled={submitting}
      >
        Submit for Review
      </button>
    </div>
  );
}
