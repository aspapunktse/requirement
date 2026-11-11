import type { Prisma } from "@prisma/client";
import { logChangeEvent } from "@/lib/change-events";
import { riskLoggedDetail } from "@/lib/risk-logged-event";
import type { CreateRiskAnalysisInput } from "@/lib/risk-analysis";

/**
 * The writes a Risk Analysis route makes inside its transaction (#325). Every query goes through the `tx` the route
 * passes, never the global client (CI's pool is three connections).
 */

/** The request named a participant or a reviewed Risk that doesn't exist (or isn't on this System): answered 400, rolls the transaction back. */
export class RiskAnalysisInputError extends Error {}

/** The Users and Risks a body names, checked: every participant exists and every reviewed Risk belongs to `systemId`. */
export async function resolveLinks(
  tx: Prisma.TransactionClient,
  systemId: string,
  input: { participantIds?: string[]; reviewedRiskIds?: string[] },
) {
  const participantIds = input.participantIds === undefined ? undefined : [...new Set(input.participantIds)];
  const reviewedRiskIds = input.reviewedRiskIds === undefined ? undefined : [...new Set(input.reviewedRiskIds)];
  if (participantIds && participantIds.length > 0) {
    const found = await tx.user.count({ where: { id: { in: participantIds } } });
    if (found !== participantIds.length) throw new RiskAnalysisInputError("A participant is not a known User");
  }
  if (reviewedRiskIds && reviewedRiskIds.length > 0) {
    const found = await tx.risk.count({ where: { id: { in: reviewedRiskIds }, systemId } });
    if (found !== reviewedRiskIds.length) throw new RiskAnalysisInputError("A reviewed Risk does not belong to this System");
  }
  return { participantIds, reviewedRiskIds };
}

/**
 * Applies the owners a body names (#360) and checks them: every owner is an existing User (a `null` clears the owner), and every Risk is
 * one this analysis reviews or raised (`allowedRiskIds`), which also puts it on `systemId`. Runs before anything else is written,
 * inside the route's transaction, so a bad entry rolls the whole request back. A Risk named twice takes the last entry.
 */
export async function applyRiskOwners(
  tx: Prisma.TransactionClient,
  { systemId, owners, newRiskOwnerIds, allowedRiskIds }: {
    systemId: string;
    owners: { riskId: string; ownerId: string | null }[];
    newRiskOwnerIds: (string | null | undefined)[];
    allowedRiskIds: Iterable<string>;
  },
) {
  const ownerIds = [...new Set([...owners.map((entry) => entry.ownerId), ...newRiskOwnerIds].filter((id): id is string => typeof id === "string"))];
  if (ownerIds.length > 0) {
    const found = await tx.user.count({ where: { id: { in: ownerIds } } });
    if (found !== ownerIds.length) throw new RiskAnalysisInputError("The owner must be an existing User");
  }
  const allowed = new Set(allowedRiskIds);
  const latest = new Map<string, string | null>();
  for (const entry of owners) {
    if (!allowed.has(entry.riskId)) throw new RiskAnalysisInputError("An owner was given for a Risk that this Risk Analysis neither reviews nor raised");
    latest.set(entry.riskId, entry.ownerId);
  }
  for (const [riskId, ownerId] of latest) {
    // `systemId` in the filter keeps a Risk from another System out, whatever `allowedRiskIds` held.
    const { count } = await tx.risk.updateMany({ where: { id: riskId, systemId }, data: { ownerId } });
    if (count !== 1) throw new RiskAnalysisInputError("A Risk does not belong to this System");
  }
}

/** Logs each Risk raised in the meeting on the System, ad hoc by the server's choice, each with its own `RISK_LOGGED` Change Event. */
export async function raiseRisks(
  tx: Prisma.TransactionClient,
  { systemId, analysisId, actorId, risks }: { systemId: string; analysisId: string; actorId: string; risks: CreateRiskAnalysisInput["newRisks"] },
) {
  for (const risk of risks) {
    const created = await tx.risk.create({
      data: { ...risk, ownerId: risk.ownerId ?? null, systemId, source: "AD_HOC", raisedInAnalysisId: analysisId },
    });
    await logChangeEvent(
      systemId,
      "RISK_LOGGED",
      riskLoggedDetail({ title: created.title, severity: created.severity, how: { kind: "manual" } }),
      actorId,
      tx,
    );
  }
}
