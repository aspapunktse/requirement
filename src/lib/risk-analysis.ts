import { RiskSeverity, type Prisma, type UserRole } from "@prisma/client";
import { z } from "zod";
import { ROLES_ALLOWED_TO_RECORD_RISK_ANALYSIS } from "@/lib/risk-roles";

/**
 * Risk Analysis meetings (#325, PRD 0002 F-RA.2-3; CONTEXT.md "Risk Analysis"). Holds the rules and shapes the routes and
 * the System page share. It never touches the global Prisma client: every function that reads takes one as a parameter, so a
 * caller inside `prisma.$transaction` passes its `tx`.
 */

/**
 * Who may record, edit and complete a Risk Analysis on a System: a Risk Owner, a Risk Facilitator (#362) or an Admin who isn't the
 * System's owner. An Admin who owns the System is refused too ("who isn't the System's owner"), and so is a Risk Owner or Risk Facilitator who owns it.
 */
export function canRecordRiskAnalysis(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return ROLES_ALLOWED_TO_RECORD_RISK_ANALYSIS.includes(user.role) && user.id !== system.ownerId;
}

export const RISK_ANALYSIS_REFUSED = "Only a Risk Owner, a Risk Facilitator or an Admin who isn't the System's owner can record a Risk Analysis";

/**
 * "Open" means the same as everywhere else in the app (the Open Risks count, `src/lib/dashboard.ts`): status OPEN.
 */
export const OPEN_RISK_STATUS = "OPEN" as const;

/**
 * The Risk statuses that must have an owner before a Risk Analysis can be completed (product-owner decision, #325): Open Risks, and
 * Accepted ones, so the app records who accepted a Risk. Mitigated, Transferred and Closed Risks don't block completion.
 */
export const OWNER_REQUIRED_RISK_STATUSES = ["OPEN", "ACCEPTED"] as const;

type AnalysisClient = Pick<Prisma.TransactionClient, "riskAnalysis">;

/**
 * Does System `systemId` have a completed Risk Analysis since `since`? True when one was completed at or after that moment.
 * An analysis still being recorded never counts. The stage tickets call this (with their transaction's `tx`) to decide whether
 * a System may move on; which stage needs one isn't decided here.
 */
export async function hasCompletedRiskAnalysisSince(client: AnalysisClient, systemId: string, since: Date): Promise<boolean> {
  const found = await client.riskAnalysis.findFirst({
    where: { systemId, completedAt: { gte: since } },
    select: { id: true },
  });
  return found !== null;
}

/** The Open and Accepted Risks on a System that have no owner: what stops an analysis from being completed. */
export function findRisksBlockingCompletion(client: Pick<Prisma.TransactionClient, "risk">, systemId: string) {
  return client.risk.findMany({
    where: { systemId, status: { in: [...OWNER_REQUIRED_RISK_STATUSES] }, ownerId: null },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });
}

/** The 409 message for a refused completion: names every open Risk without an owner. */
export function ownerlessRisksMessage(risks: { title: string }[]) {
  const names = risks.map((risk) => `"${risk.title}"`).join(", ");
  return `Every open or accepted Risk needs an owner before the Risk Analysis can be completed. Without an owner: ${names}.`;
}

export const ANALYSIS_ALREADY_COMPLETED = "This Risk Analysis is completed and can no longer be changed";

export const MAX_OUTSIDERS = 30;

const newRiskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  severity: z.enum(RiskSeverity),
  likelihood: z.enum(RiskSeverity),
  /** Who acts on the Risk: any User (#360). Absent or null leaves it without an owner. */
  ownerId: z.string().min(1).nullable().optional(),
});

/** An owner for a Risk already on the System: a reviewed Risk, or one raised earlier in this analysis. `ownerId: null` clears it. */
const riskOwnerSchema = z.object({ riskId: z.string().min(1), ownerId: z.string().min(1).nullable() });

const fields = {
  // A calendar day, `YYYY-MM-DD`.
  heldOn: z.iso.date(),
  notes: z.string().max(20000),
  participantIds: z.array(z.string().min(1)).max(100),
  // Named outsiders such as the vendor, free text.
  outsiders: z.array(z.string().trim().min(1).max(120)).max(MAX_OUTSIDERS),
  reviewedRiskIds: z.array(z.string().min(1)).max(500),
  // Risks raised in the meeting, logged from the same form. Their `source` is the server's to set (ad hoc), never the body's.
  newRisks: z.array(newRiskSchema).max(50),
  // Owners saved with the analysis, in the same transaction (#360). Only for Risks reviewed in, or raised in, this analysis.
  riskOwners: z.array(riskOwnerSchema).max(500),
};

export const createRiskAnalysisSchema = z.object({
  heldOn: fields.heldOn,
  notes: fields.notes.default(""),
  participantIds: fields.participantIds.default([]),
  outsiders: fields.outsiders.default([]),
  reviewedRiskIds: fields.reviewedRiskIds.default([]),
  newRisks: fields.newRisks.default([]),
  riskOwners: fields.riskOwners.default([]),
});

/** An edit replaces the fields it names; `newRisks` are added to those already raised (a raised Risk is a Risk, and stays). */
export const updateRiskAnalysisSchema = z
  .object({
    heldOn: fields.heldOn,
    notes: fields.notes,
    participantIds: fields.participantIds,
    outsiders: fields.outsiders,
    reviewedRiskIds: fields.reviewedRiskIds,
    newRisks: fields.newRisks,
    riskOwners: fields.riskOwners,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" });

export type CreateRiskAnalysisInput = z.infer<typeof createRiskAnalysisSchema>;

const PERSON = { select: { id: true, name: true } } as const;
const RISK_BRIEF = { select: { id: true, title: true, severity: true, status: true, ownerId: true } } as const;

export const RISK_ANALYSIS_SELECT = {
  id: true,
  heldOn: true,
  notes: true,
  outsiders: true,
  createdAt: true,
  completedAt: true,
  participants: { ...PERSON, orderBy: { name: "asc" } },
  reviewedRisks: { ...RISK_BRIEF, orderBy: { createdAt: "asc" } },
  raisedRisks: { ...RISK_BRIEF, orderBy: { createdAt: "asc" } },
  recordedBy: PERSON,
  completedBy: PERSON,
} satisfies Prisma.RiskAnalysisSelect;

type Row = Prisma.RiskAnalysisGetPayload<{ select: typeof RISK_ANALYSIS_SELECT }>;

export type RiskAnalysisBriefRisk = { id: string; title: string; severity: RiskSeverity; status: string; ownerId: string | null };

export type RiskAnalysisView = {
  id: string;
  /** `YYYY-MM-DD`. */
  heldOn: string;
  notes: string;
  participants: { id: string; name: string }[];
  outsiders: string[];
  reviewedRisks: RiskAnalysisBriefRisk[];
  raisedRisks: RiskAnalysisBriefRisk[];
  recordedBy: { id: string; name: string } | null;
  createdAt: string;
  completedAt: string | null;
  completedBy: { id: string; name: string } | null;
};

/** The JSON a route answers with: dates as ISO text, `heldOn` as the plain day. */
export function toRiskAnalysisView(row: Row): RiskAnalysisView {
  return {
    id: row.id,
    heldOn: row.heldOn.toISOString().slice(0, 10),
    notes: row.notes,
    participants: row.participants,
    outsiders: row.outsiders,
    reviewedRisks: row.reviewedRisks,
    raisedRisks: row.raisedRisks,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
  };
}

/** `Risk Analysis held 2026-11-09 completed (3 Risks reviewed, 1 raised)`: the detail of the `RISK_ANALYSIS_COMPLETED` event. */
export function riskAnalysisCompletedDetail({ heldOn, reviewed, raised }: { heldOn: Date; reviewed: number; raised: number }) {
  const plural = (count: number) => (count === 1 ? "Risk" : "Risks");
  return `Risk Analysis held ${heldOn.toISOString().slice(0, 10)} completed (${reviewed} ${plural(reviewed)} reviewed, ${raised} raised)`;
}
