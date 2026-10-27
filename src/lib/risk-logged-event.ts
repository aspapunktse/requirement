import type { RiskSeverity } from "@prisma/client";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import type { Prisma } from "@prisma/client";

/**
 * The `RISK_LOGGED` Change Event (#245): one per Risk opened on a System, in the same transaction as the Risk.
 * Kept in one place with the two product-owner defaults that decide what an auto-opened Risk records, so
 * they are easy to flip:
 *
 *  1. A Risk opened on a System by either auto path (a "No" Self-Assessment answer, an Internal Auditor's
 *     Nonconformity) writes `RISK_LOGGED` *instead of* the `RISK_STATUS_CHANGED` "auto-opened" event it wrote
 *     before, so one Risk gives one timeline entry. An Organization Risk (no System) keeps that old event.
 *  2. The actor of an auto-opened `RISK_LOGGED` stays `SYSTEM_ACTOR`; its detail says how it was opened.
 */
export const AUTO_OPENED_RISK_ACTOR = SYSTEM_ACTOR;

export type RiskOpening =
  | { kind: "manual" }
  | { kind: "self-assessment"; controlCode: string }
  | { kind: "nonconformity"; auditTitle: string };

const SEVERITY_TEXT: Record<RiskSeverity, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

const OPENING_TEXT: Record<RiskOpening["kind"], (how: RiskOpening) => string> = {
  manual: () => "logged by hand",
  "self-assessment": (how) => `auto-opened from a "No" Self-Assessment answer to ${(how as { controlCode: string }).controlCode}`,
  nonconformity: (how) => `auto-opened from a Nonconformity in "${(how as { auditTitle: string }).auditTitle}"`,
};

/** `Risk "T" logged by hand (severity: High)`: names the Risk, how it was opened and its severity. */
export function riskLoggedDetail({ title, severity, how }: { title: string; severity: RiskSeverity; how: RiskOpening }): string {
  return `Risk "${title}" ${OPENING_TEXT[how.kind](how)} (severity: ${SEVERITY_TEXT[severity]})`;
}

type Client = Pick<Prisma.TransactionClient, "changeEvent">;

/**
 * Records a Risk an auto path just opened, on `client` (the transaction that created it). On a System it is
 * `RISK_LOGGED` by `AUTO_OPENED_RISK_ACTOR`; with no System (an Organization-level Nonconformity) it is the
 * `RISK_STATUS_CHANGED` event it always was, `legacyDetail` unchanged.
 */
export function logAutoOpenedRisk(
  client: Client,
  input: { systemId: string | null; title: string; severity: RiskSeverity; how: RiskOpening; legacyDetail: string },
) {
  if (input.systemId === null) return logChangeEvent(null, "RISK_STATUS_CHANGED", input.legacyDetail, SYSTEM_ACTOR, client);
  return logChangeEvent(input.systemId, "RISK_LOGGED", riskLoggedDetail(input), AUTO_OPENED_RISK_ACTOR, client);
}
