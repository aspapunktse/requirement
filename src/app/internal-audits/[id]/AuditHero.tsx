import type { ReactNode } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import { INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";
import type { InternalAuditDetail } from "@/lib/internal-audits";
import { internalAuditStatusTone } from "@/lib/status-tones";
import { dueLine } from "../audits-list-logic";

const day = (iso: string) => iso.slice(0, 10);

/**
 * The hero of one Internal Audit (#399), the same for every status: the title, the state chip, the scope, the due
 * date, who launched or closed it, and what the role may do (`actions`). `aside` is the ring for a launched or closed
 * audit. The status line says what the status means, as the old page did.
 */
export function AuditHero({
  audit,
  daysUntilDue,
  actions,
  aside,
}: {
  audit: InternalAuditDetail;
  daysUntilDue: number | null;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  const due = dueLine(daysUntilDue);
  const line =
    audit.status === "DRAFT"
      ? "Draft: nothing has been sent to anyone and no Check-up exists"
      : audit.status === "LAUNCHED"
        ? `Launched ${audit.launchedAt ? day(audit.launchedAt) : ""}${audit.launchedBy ? ` by ${audit.launchedBy.name}` : ""}. Its Controls, Systems and questions can no longer be changed`
        : `Closed ${audit.closedAt ? day(audit.closedAt) : ""}${audit.closedBy ? ` by ${audit.closedBy.name}` : ""}. The audit, its Check-ups, responses, evaluations and withdrawals are read-only for everyone`;
  return (
    <section className="hc-hero" aria-labelledby="ad-title">
      <div>
        <p className="ad-crumb">
          <Link href="/internal-audits">Internal Audits</Link>
        </p>
        <div className="hc-who">
          <span className="hc-eyebrow">Internal Audit</span>
        </div>
        <h1 id="ad-title">{audit.title}</h1>
        <p className={`hc-lede${audit.scopeDescription.trim() ? "" : " ad-none"}`}>{audit.scopeDescription.trim() || "No scope description."}</p>
        <div className="hc-chips ad-meta">
          <StatusChip tone={internalAuditStatusTone(audit.status)}>{INTERNAL_AUDIT_STATUS_LABEL[audit.status]}</StatusChip>
          <StatusChip tone={audit.status === "LAUNCHED" && due.urgency === "late" ? "danger" : "neutral"}>
            {audit.status === "LAUNCHED" && due.text ? `${due.text} · ${audit.dueDate}` : `Due ${audit.dueDate}`}
          </StatusChip>
          <span className="ad-line">
            {line}. Created by {audit.createdBy.name}.
          </span>
        </div>
        {actions && <div className="hc-chips ad-actions">{actions}</div>}
      </div>
      {aside}
    </section>
  );
}
