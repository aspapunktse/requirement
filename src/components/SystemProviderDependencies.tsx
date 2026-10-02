"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { CONTROL_OFFERING_TYPE_LABEL } from "@/lib/control-offering-rules";
import { PROVIDER_PENDING_TEXT, SHARED_OFFERING_CREDIT_TEXT } from "@/lib/effective-status";
import {
  describeDependencyRemovalConfirmation,
  type ProviderChoice,
  type ProviderDependencyRow,
} from "@/lib/provider-dependency-rules";

const SELECT_CLASSES = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

/**
 * The "Provider dependencies" section of the System page (PRD 0001 F-IN.3,
 * F-IN.4, ADR 0008, #124): the Providers this System depends on and so inherits
 * Full and Shared Offerings from, live. Each shows its name (a link only when the viewer can
 * open it as a System: a viewer who can't is told only its name, whether it is
 * Onboarded, its Offerings and its own status for each), *pending: Provider not
 * Onboarded* while it isn't (an Offering gives no credit until it is), and the
 * Offerings that match this System's applicable Controls. A Shared Offering is
 * listed with its customer responsibility and what it needs to give credit.
 *
 * The System's owner or an Admin (`canManage`, computed by the page with the same
 * `canManageProviderDependencies` the API enforces) gets a picker of every
 * Provider (not this System, not one already declared) and a Remove button whose
 * confirmation says which Controls stop being inherited. The data comes from the
 * server page as props and is updated from each response; nothing is fetched on
 * mount. A change refreshes the page, so the Controls and Requirements below
 * show the new effective statuses (nothing is copied to this System).
 */
export function SystemProviderDependencies({
  systemId,
  canManage,
  initialDependencies,
  choices,
}: {
  systemId: string;
  canManage: boolean;
  initialDependencies: ProviderDependencyRow[];
  /** Every Provider (id, name, Onboarded or pending); only passed to the owner or an Admin. */
  choices: ProviderChoice[];
}) {
  const router = useRouter();
  const [dependencies, setDependencies] = useState(initialDependencies);
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const declared = new Set(dependencies.map((dependency) => dependency.providerId));
  const pickable = choices.filter((choice) => choice.id !== systemId && !declared.has(choice.id));

  async function send(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(parsed.error ?? "Something went wrong");
        return null;
      }
      return parsed;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    const result = await send(`/api/systems/${systemId}/dependencies`, "POST", { providerId });
    if (!result) return;
    const added = result.dependency as ProviderDependencyRow;
    setDependencies((previous) => [...previous, added].sort((a, b) => a.name.localeCompare(b.name)));
    setProviderId("");
    router.refresh();
  }

  async function handleRemove(dependency: ProviderDependencyRow) {
    if (!window.confirm(describeDependencyRemovalConfirmation(dependency))) return;
    const result = await send(`/api/systems/${systemId}/dependencies/${dependency.providerId}`, "DELETE");
    if (!result) return;
    setDependencies((previous) => previous.filter((row) => row.providerId !== dependency.providerId));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {error && <p className="text-red-600">{error}</p>}

      {dependencies.length === 0 ? (
        <p className="text-zinc-500">This System doesn&apos;t depend on any Provider.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dependencies.map((dependency) => (
            <li
              key={dependency.providerId}
              aria-label={`Provider ${dependency.name}`}
              className="flex flex-col gap-1 rounded border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2">
                {dependency.canSee ? (
                  <Link className="font-medium underline" href={`/systems/${dependency.providerId}`}>
                    {dependency.name}
                  </Link>
                ) : (
                  <span className="font-medium">{dependency.name}</span>
                )}
                {dependency.onboarded ? (
                  <StatusChip tone="success">Onboarded</StatusChip>
                ) : (
                  <StatusChip tone="warn">{PROVIDER_PENDING_TEXT}</StatusChip>
                )}
              </div>

              {!dependency.onboarded && (
                <p className="text-xs text-zinc-500">
                  Its Offerings give this System no credit until the Provider is Onboarded.
                </p>
              )}

              {dependency.offerings.length === 0 ? (
                <p className="text-zinc-500">It offers none of the Controls that apply to this System.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {dependency.offerings.map((offering) => (
                    <li key={offering.control.id} className="flex flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span>
                          <span className="font-medium">{offering.control.code}</span> {offering.control.title}
                        </span>
                        <StatusChip tone={offering.type === "FULL" ? "accent" : "warn"}>
                          {CONTROL_OFFERING_TYPE_LABEL[offering.type]}
                        </StatusChip>
                        <span className="text-zinc-500">Provider&apos;s own status:</span>
                        <StatusChip tone={controlAssessmentStatusTone(offering.providerStatus)}>
                          {CONTROL_ASSESSMENT_STATUS_LABEL[offering.providerStatus]}
                        </StatusChip>
                      </span>
                      {offering.type === "SHARED" && (
                        <span className="text-xs text-zinc-500">
                          {offering.customerResponsibility && `Customer responsibility: ${offering.customerResponsibility}. `}
                          {SHARED_OFFERING_CREDIT_TEXT}
                        </span>
                      )}
                      {!offering.appliesToProvider && (
                        <span className="text-xs text-ems-warn">
                          This Control no longer applies to the Provider, so the Offering gives no credit.
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canManage && (
                <div>
                  <Button
                    className="px-2 py-0.5 text-xs"
                    aria-label={`Remove dependency on ${dependency.name}`}
                    onClick={() => handleRemove(dependency)}
                    disabled={busy}
                  >
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage &&
        (pickable.length === 0 ? (
          <p className="text-xs text-zinc-500">
            {choices.length === 0
              ? "No System is marked as a Provider yet."
              : "Every Provider is already declared (a System can't depend on itself)."}
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <h3 className="font-medium">Depend on a Provider</h3>
            <label className="flex flex-col gap-1">
              Provider
              <select className={SELECT_CLASSES} value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                <option value="">Select a Provider</option>
                {pickable.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.onboarded ? choice.name : `${choice.name} (${PROVIDER_PENDING_TEXT})`}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" onClick={handleAdd} disabled={busy || providerId === ""}>
              Add dependency
            </Button>
          </div>
        ))}
    </div>
  );
}
