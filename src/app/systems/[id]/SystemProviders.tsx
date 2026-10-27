"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/StatusChip";
import { SystemProvider } from "@/components/SystemProvider";
import { PROVIDER_PENDING_TEXT } from "@/lib/effective-status";
import { describeDependencyRemovalConfirmation, type DependentRow, type ProviderChoice, type ProviderDependencyRow } from "@/lib/provider-dependency-rules";
import type { ControlOfferingRow, OfferableControl } from "@/lib/control-offerings";
import { providerCardOf, flowNodesOf, type FlowNode } from "./providers-model";
import { writeHash } from "./system-hash";
import { controlHash } from "./system-page-logic";

const W = 760;
const H = 320;
const GAP = 14;

/** "Where the Controls come from": each source as a bar on the left, a ribbon from it into the System's applicable Controls, sized by count. */
function Flow({ nodes, total, systemName }: { nodes: FlowNode[]; total: number; systemName: string }) {
  if (nodes.length === 0) {
    return <p className="hc-empty">No Control applies to this System yet, so nothing is inherited.</p>;
  }
  const sum = nodes.reduce((acc, node) => acc + node.count, 0);
  const usable = H - 40 - GAP * (nodes.length - 1);
  const summary = nodes.map((node) => `${node.name} ${node.count}`).join(", ");
  // Each source's bar (top, height) and where its ribbon lands on the target bar (top, height), top to bottom.
  const bars = nodes.reduce<{ y: number; h: number; targetY: number; th: number }[]>((placed, node) => {
    const share = sum === 0 ? 0 : node.count / sum;
    const previous = placed[placed.length - 1];
    return [
      ...placed,
      {
        y: previous ? previous.y + previous.h + GAP : 20,
        h: Math.max(34, share * (usable - 68)),
        targetY: previous ? previous.targetY + previous.th : 20,
        th: share * (H - 40),
      },
    ];
  }, []);
  return (
    <svg className="sc-flow" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Where this System's Controls come from: ${summary}; ${total} applicable Controls`}>
      {nodes.map((node, index) => {
        const { y, h, targetY, th } = bars[index];
        const midY = y + h / 2;
        const midT = targetY + th / 2;
        return (
          <g key={node.key} opacity={node.pending ? 0.55 : 1}>
            <rect x={20} y={y} width={10} height={h} rx={3} fill={node.color} />
            <text x={38} y={midY - 4}>
              {node.name}
            </text>
            <text x={38} y={midY + 11} className="muted-t">
              {`${node.count} ${node.count === 1 ? "Control" : "Controls"}${node.pending ? ", pending" : ""}`}
            </text>
            <path d={`M 200 ${midY} C 420 ${midY}, 420 ${midT}, ${W - 150} ${midT}`} stroke={node.color} strokeWidth={Math.max(3, th)} strokeDasharray={node.pending ? "6 4" : undefined} />
          </g>
        );
      })}
      <rect x={W - 150} y={20} width={14} height={H - 40} rx={4} fill="var(--rg-accent)" />
      <text x={W - 128} y={H / 2 - 4} style={{ fontWeight: 700 }}>
        {systemName.length > 18 ? `${systemName.slice(0, 17)}…` : systemName}
      </text>
      <text x={W - 128} y={H / 2 + 12} className="muted-t">
        {`${total} applicable Controls`}
      </text>
    </svg>
  );
}

function DependencyCard({ dependency, canManage, busy, onRemove }: { dependency: ProviderDependencyRow; canManage: boolean; busy: boolean; onRemove: () => void }) {
  const card = providerCardOf(dependency);
  return (
    <article className="hc-card sc-provcard" aria-label={`Provider ${card.name}`}>
      <div className="hc-card-h">
        <h3>
          {card.canSee ? (
            <Link href={`/systems/${card.providerId}`} className="sc-provlink">
              {card.name}
            </Link>
          ) : (
            card.name
          )}
        </h3>
        {card.onboarded ? <StatusChip tone="success">Onboarded</StatusChip> : <StatusChip tone="warn">{PROVIDER_PENDING_TEXT}</StatusChip>}
      </div>
      <div className="hc-card-b sc-provbody">
        <div className="hc-legend" aria-label={`Offerings of ${card.name}`}>
          <span>
            Full Offerings <b>{card.full}</b>
          </span>
          <span>
            Shared <b>{card.shared}</b>
          </span>
        </div>
        {!card.onboarded && <p className="sc-faint">Its Offerings give this System no credit until the Provider is Onboarded.</p>}
        {card.controls.length === 0 ? (
          <p className="sc-faint">It offers none of the Controls that apply to this System.</p>
        ) : (
          <ul className="sc-tags btns" aria-label={`Controls covered by ${card.name}`}>
            {card.controls.map((control) => (
              <li key={control.code}>
                <button
                  type="button"
                  className="sc-tagbtn"
                  title={`${control.title} · ${control.type === "FULL" ? "Full" : "Shared"} Offering${control.appliesToProvider ? "" : " · no longer applies to the Provider, so it gives no credit"}`}
                  onClick={() => writeHash(controlHash(control.code))}
                >
                  {control.code}
                </button>
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <button type="button" className="sc-link sc-remove" aria-label={`Remove dependency on ${card.name}`} onClick={onRemove} disabled={busy}>
            Remove dependency
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The Providers tab (design proposal A, #245): the flow of where this System's Controls come from, one card per
 * Provider this System depends on (Onboarded or pending, its Full and Shared Offering counts, the Control codes it
 * covers, each opening the Control drawer, and Remove dependency), "+ Depend on a Provider", and, below, the
 * System's own side as a Provider (`SystemProvider`: mark or unmark, Control Offerings, the Systems that depend
 * on it). Who may change what is decided by the page with the same rules the API enforces (`canManageDependencies`
 * and `canManageProvider`); nothing here widens it. The data comes from the server page as props and is updated from
 * each response; a change refreshes the page so the other tabs show the new effective statuses.
 */
export function SystemProviders({
  systemId,
  systemName,
  canManageDependencies,
  canManageProvider,
  initialDependencies,
  choices,
  isProvider,
  offerings,
  offerable,
  dependents,
  controlTotals,
}: {
  systemId: string;
  systemName: string;
  canManageDependencies: boolean;
  canManageProvider: boolean;
  initialDependencies: ProviderDependencyRow[];
  /** Every Provider (id, name, Onboarded or pending); only passed to the owner or an Admin. */
  choices: ProviderChoice[];
  isProvider: boolean;
  offerings: ControlOfferingRow[];
  offerable: OfferableControl[];
  dependents: DependentRow[];
  /** What the flow's other sources supply: the Overview's "Where the status comes from" figures. */
  controlTotals: { total: number; organization: number; system: number };
}) {
  const router = useRouter();
  const [dependencies, setDependencies] = useState(initialDependencies);
  const [adding, setAdding] = useState(false);
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
    } catch {
      setError("Something went wrong");
      return null;
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
    setAdding(false);
    router.refresh();
  }

  async function handleRemove(dependency: ProviderDependencyRow) {
    if (!window.confirm(describeDependencyRemovalConfirmation(dependency))) return;
    const result = await send(`/api/systems/${systemId}/dependencies/${dependency.providerId}`, "DELETE");
    if (!result) return;
    setDependencies((previous) => previous.filter((row) => row.providerId !== dependency.providerId));
    router.refresh();
  }

  const nodes = flowNodesOf({ organization: controlTotals.organization, system: controlTotals.system, dependencies });

  return (
    <div className="sc-stackgap">
      <section className="hc-card" aria-labelledby="sc-flow-h">
        <div className="hc-card-h">
          <h2 id="sc-flow-h">Where the Controls come from</h2>
        </div>
        <div className="hc-card-b">
          <Flow nodes={nodes} total={controlTotals.total} systemName={systemName} />
        </div>
      </section>

      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}

      <section className="sc-provs" aria-label="Provider dependencies">
        {dependencies.map((dependency) => (
          <DependencyCard key={dependency.providerId} dependency={dependency} canManage={canManageDependencies} busy={busy} onRemove={() => handleRemove(dependency)} />
        ))}
        <article className="hc-card sc-provadd">
          {dependencies.length === 0 && <p className="sc-faint">This System doesn&apos;t depend on any Provider.</p>}
          {canManageDependencies ? (
            pickable.length === 0 ? (
              <p className="sc-faint">{choices.length === 0 ? "No System is marked as a Provider yet." : "Every Provider is already declared (a System can't depend on itself)."}</p>
            ) : adding ? (
              <div className="sc-picker">
                <label className="sc-field">
                  <span>Provider</span>
                  <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
                    <option value="">Select a Provider</option>
                    {pickable.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.onboarded ? choice.name : `${choice.name} (${PROVIDER_PENDING_TEXT})`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sc-btnrow">
                  <button type="button" className="hc-btn primary" onClick={handleAdd} disabled={busy || providerId === ""}>
                    Add dependency
                  </button>
                  <button type="button" className="hc-btn" onClick={() => setAdding(false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="hc-btn" onClick={() => setAdding(true)}>
                + Depend on a Provider
              </button>
            )
          ) : (
            <p className="sc-faint">Only the System&apos;s owner or an Admin can declare a Provider dependency.</p>
          )}
        </article>
      </section>

      <section className="hc-card" aria-labelledby="sc-asprov-h">
        <div className="hc-card-h">
          <h2 id="sc-asprov-h">This System as a Provider</h2>
        </div>
        <div className="hc-card-b">
          <SystemProvider
            systemId={systemId}
            canManage={canManageProvider}
            initialIsProvider={isProvider}
            initialOfferings={offerings}
            initialOfferable={offerable}
            dependents={dependents}
          />
        </div>
      </section>
    </div>
  );
}
