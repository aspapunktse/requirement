"use client";

import { Icon, Ring } from "@/app/home/HomeGraphics";
import { initialsOf } from "@/app/home/home-format";
import type { PlannerControl } from "@/lib/audit-planner";
import type { PlanPreview } from "./planner-types";

/** One line of "Ready to save" or "Before it can launch". */
export type Item = { ok: boolean; warn?: boolean; title: string; detail: string; action?: { label: string; onClick: () => void } };

function Items({ items, label }: { items: Item[]; label: string }) {
  return (
    <ul className="ap-ready" aria-label={label}>
      {items.map((item) => (
        <li key={item.title} className={item.ok ? "ok" : item.warn ? "warn" : ""}>
          <span className="mk">
            <Icon name={item.warn ? "alert" : "check"} size={12} />
          </span>
          <span>
            {item.title}
            <small>
              {item.detail}
              {item.action && (
                <>
                  {" · "}
                  <button type="button" className="ap-link" onClick={item.action.onClick}>
                    {item.action.label}
                  </button>
                </>
              )}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

const RECIPIENTS_SHOWN = 6;

/**
 * The launch preview (sticky aside, a bottom bar on narrow screens): the Check-up ring, the summary, what is
 * still missing to save, what blocks the launch and who receives Check-ups. The numbers, blockers and recipients are
 * the server's (`planLaunch`); this only lays them out. `preview` is null until the first answer arrives, and
 * `stale` while an answer for the latest picks is on its way.
 */
export function PlannerPreview({
  preview,
  stale,
  failed,
  readiness,
  controlsById,
  creating,
  busy,
  saveTitle,
  onSave,
  onCancel,
  onWriteQuestion,
}: {
  preview: PlanPreview | null;
  stale: boolean;
  failed: boolean;
  readiness: Item[];
  controlsById: Map<string, PlannerControl>;
  creating: boolean;
  busy: boolean;
  saveTitle: string;
  onSave: () => void;
  onCancel: () => void;
  onWriteQuestion: (controlId: string) => void;
}) {
  const total = preview ? preview.systemCheckUpCount + preview.organizationCheckUpCount : 0;
  const skipped = preview?.skippedCount ?? 0;
  const t = Math.max(1, total + skipped);
  const ready = readiness.filter((item) => item.ok).length;

  const blockers = (preview?.blockers ?? []).filter((blocker) => blocker.kind !== "invalid");
  const launchItems: Item[] = blockers.length
    ? blockers.map((blocker) => {
        const codes = blocker.controlIds.map((id) => controlsById.get(id)?.code).filter((code): code is string => Boolean(code));
        return {
          ok: false,
          warn: true,
          title: blocker.message,
          detail: codes.length > 6 ? `${codes.slice(0, 6).join(", ")} +${codes.length - 6}` : codes.join(", "),
          action: blocker.kind === "no-questions" && blocker.controlIds[0] ? { label: "Write the first", onClick: () => onWriteQuestion(blocker.controlIds[0]) } : undefined,
        };
      })
    : [
        {
          ok: total > 0,
          title: total > 0 ? "Nothing blocks the launch" : "Nothing to check yet",
          detail: "The draft is launched from its page once saved",
        },
      ];

  const recipients = preview?.recipients ?? [];
  const max = Math.max(1, ...recipients.map((r) => r.fromThisAudit + r.alreadyOpen));

  return (
    <aside className={`ap-card ap-preview${stale ? " stale" : ""}`} aria-labelledby="ap-pv-h">
      <div className="ap-card-h">
        <h2 id="ap-pv-h">Launch preview</h2>
        <p>{failed ? "could not update" : stale ? "updating…" : "updates as you pick"}</p>
      </div>
      <div className="ap-card-b" style={{ display: "grid", gap: 14, paddingTop: 10 }}>
        {failed && (
          <p role="alert" className="ap-note">
            The preview could not be updated. Saving still works; the launch checks run again when the draft is launched.
          </p>
        )}
        <div className="ap-pv-live" style={{ display: "grid", gap: 14 }}>
          <div className="ap-pv-top">
            <Ring
              size={118}
              stroke={12}
              center={String(total)}
              sub="Check-ups"
              segments={[
                [(preview?.systemCheckUpCount ?? 0) / t, "var(--rg-accent)"],
                [(preview?.organizationCheckUpCount ?? 0) / t, "var(--rg-audit)"],
                [skipped / t, "var(--rg-line)"],
              ]}
            />
            <div className="ap-legend">
              <span>
                <i style={{ background: "var(--rg-accent)" }} />
                <b>{preview?.systemCheckUpCount ?? 0}</b> System-level
              </span>
              <span>
                <i style={{ background: "var(--rg-audit)" }} />
                <b>{preview?.organizationCheckUpCount ?? 0}</b> Organization-level
              </span>
              <span>
                <i style={{ background: "var(--rg-line)" }} />
                <b>{skipped}</b> pairs skipped
              </span>
              <span style={{ marginTop: 4 }}>
                <b>{recipients.length}</b>&nbsp;recipients
              </span>
            </div>
          </div>
          <p className="ap-pv-sum" data-testid="plan-summary">
            {preview && (total > 0 || skipped > 0) ? `${preview.summary}.` : "Pick Controls and Systems (or the Organization) to see what launching would generate."}
          </p>

          <div className="ap-pv-sec">
            <h3>
              Ready to save <span>{ready}/{readiness.length}</span>
            </h3>
            <Items items={readiness} label="Ready to save" />
          </div>

          <div className="ap-pv-sec">
            <h3>Before it can launch</h3>
            <Items items={launchItems} label="Before it can launch" />
          </div>

          <div className="ap-pv-sec">
            <h3>
              Who receives Check-ups <span>{recipients.length ? `${recipients.length} people` : ""}</span>
            </h3>
            <div className="ap-load">
              {recipients.length === 0 && <p className="ap-empty">Nobody yet</p>}
              {recipients.slice(0, RECIPIENTS_SHOWN).map((person) => (
                <div key={person.id} className="ap-load-row">
                  <span className={`ap-av av${person.roles.includes("Control Owner") && !person.roles.includes("System Owner") ? " org" : ""}`}>{initialsOf(person.name)}</span>
                  <span className="nm">
                    <span>{person.name}</span>
                    <small>
                      {person.roles.join(" · ")}
                      {person.alreadyOpen > 0 ? ` · ${person.alreadyOpen} already open` : ""}
                    </small>
                  </span>
                  <b aria-label={`${person.fromThisAudit} from this audit`}>{person.fromThisAudit}</b>
                  <span className="ap-load-track">
                    <i style={{ width: `${(person.fromThisAudit / max) * 100}%`, background: "var(--rg-accent)" }} />
                    <i style={{ width: `${(person.alreadyOpen / max) * 100}%`, background: "var(--rg-gold)" }} />
                  </span>
                </div>
              ))}
              {recipients.length > RECIPIENTS_SHOWN && <p className="ap-muted" style={{ fontSize: "0.78rem" }}>+{recipients.length - RECIPIENTS_SHOWN} more people</p>}
            </div>
            <div className="ap-legend row">
              <span>
                <i style={{ background: "var(--rg-accent)" }} />
                from this audit
              </span>
              <span>
                <i style={{ background: "var(--rg-gold)" }} />
                already open
              </span>
            </div>
          </div>
        </div>

        <div className="ap-actions">
          <button type="button" className="hc-btn primary lg" disabled={busy} title={saveTitle} onClick={onSave}>
            {creating ? "Create draft" : "Save"}
          </button>
          <button type="button" className="hc-btn lg" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </aside>
  );
}
