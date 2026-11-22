import type { CheckUpAnswer, CheckUpOutcome, RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readInternalAudit, type InternalAuditDetail } from "@/lib/internal-audits";
import { previewAuditPlanOn, type PlanPreview } from "@/lib/check-ups";
import { checkUpRecipientId, safeHttpUrl } from "@/lib/check-up-response-rules";
import {
  addCheckUpState,
  checkUpState,
  emptyCheckUpFindings,
  emptyCheckUpStateCounts,
  type CheckUpFindings,
  type CheckUpStateCounts,
  type CheckUpStateKey,
} from "@/lib/check-up-states";
import { calendarDaysUntil } from "@/lib/internal-audit-rules";

/**
 * Everything the single Internal Audit page shows (#399), read in one RepeatableRead snapshot in a constant number of
 * queries however many Check-ups there are: the audit with its Controls and Systems, the Check-ups with their questions,
 * answers, response, evaluation, withdrawal and Risk (nested selects, which Prisma sends as one query per relation), the
 * Controls, Systems and owners behind them, and, for a draft, the launch preview with who would receive the Check-ups
 * (`previewAuditPlanOn`, the planner's and the launch's `planLaunch`). The state of each Check-up comes from
 * `check-up-states.ts`, the rules of the Internal Audits list. Dates leave as strings so the result can go to a client
 * component, and the panel needs nothing more to show a Check-up.
 */

export type AuditCheckUp = {
  id: string;
  control: { id: string; code: string; title: string };
  target: { kind: "system"; id: string; name: string } | { kind: "organization" };
  /** Who owns the target now (derived on every read), or null: an Organization-level Check-up whose Control has no Control Owner. */
  recipient: { id: string; name: string } | null;
  state: CheckUpStateKey;
  questions: { id: string; position: number; text: string; guidance: string | null; answer: { answer: CheckUpAnswer; description: string } | null }[];
  response: { respondedAt: string; respondedByName: string; evidenceLinks: string[] } | null;
  evaluation: { outcome: CheckUpOutcome; comment: string; evaluatedByName: string; evaluatedAt: string } | null;
  withdrawal: { reason: string; withdrawnByName: string; withdrawnAt: string } | null;
  /** The Risk a Nonconformity opened. */
  risk: { id: string; title: string; status: RiskStatus; systemId: string | null } | null;
};

export type InternalAuditPage = {
  audit: InternalAuditDetail;
  /** Calendar days from today to the due date when the page was read (negative once past). */
  daysUntilDue: number | null;
  /** Launched and closed audits: by Control code, then Systems by name, the Organization last. Empty for a draft. */
  checkUps: AuditCheckUp[];
  /** The Check-ups per state (all zero for a draft). */
  counts: CheckUpStateCounts;
  /** Closed audits: the evaluations by outcome and the Risks opened. Null otherwise. */
  findings: CheckUpFindings | null;
  /** Drafts: each target Control's Audit Questions (#404) with their guidance notes (#405) by Control id, for the draft editor's "From the bank" picker. Empty otherwise. */
  auditQuestions: Record<string, { text: string; guidance: string | null }[]>;
  /** Drafts: what launching would send and be blocked by, and who would receive it. Null otherwise. */
  plan: PlanPreview | null;
};

const codeCollator = new Intl.Collator("en", { numeric: true });
const nameCollator = new Intl.Collator("en");

export async function loadInternalAuditPage(id: string, now: Date = new Date()): Promise<InternalAuditPage | null> {
  return prisma.$transaction(
    async (tx) => {
      const audit = await readInternalAudit(tx, id);
      if (!audit) return null;
      const daysUntilDue = calendarDaysUntil(audit.dueDate, now);

      if (audit.status === "DRAFT") {
        const plan = await previewAuditPlanOn(
          tx,
          {
            internalAuditId: audit.id,
            title: audit.title,
            dueDate: audit.dueDate,
            includeOrganization: audit.includeOrganization,
            controlIds: audit.controls.map((control) => control.id),
            systemIds: audit.systems.map((system) => system.id),
          },
          now,
        );
        const bank = await tx.controlAuditQuestion.findMany({
          where: { controlId: { in: audit.controls.map((control) => control.id) } },
          orderBy: { position: "asc" },
          select: { controlId: true, text: true, guidance: true },
        });
        const auditQuestions: InternalAuditPage["auditQuestions"] = {};
        for (const row of bank) (auditQuestions[row.controlId] ??= []).push({ text: row.text, guidance: row.guidance });
        return { audit, daysUntilDue, checkUps: [], counts: emptyCheckUpStateCounts(), findings: null, plan, auditQuestions };
      }

      const rows = await tx.checkUp.findMany({
        where: { internalAuditId: id },
        select: {
          id: true,
          controlId: true,
          systemId: true,
          questions: { orderBy: { position: "asc" }, select: { id: true, position: true, text: true, guidance: true, answer: { select: { answer: true, description: true } } } },
          response: { select: { respondedAt: true, evidenceLinks: true, respondedBy: { select: { name: true } } } },
          evaluation: { select: { outcome: true, comment: true, evaluatedAt: true, evaluatedBy: { select: { name: true } } } },
          withdrawal: { select: { reason: true, withdrawnAt: true, withdrawnBy: { select: { name: true } } } },
          risk: { select: { id: true, title: true, status: true, systemId: true } },
        },
      });
      const [controls, systems] = await Promise.all([
        tx.control.findMany({
          where: { id: { in: [...new Set(rows.map((row) => row.controlId))] } },
          select: { id: true, code: true, title: true, ownerId: true },
        }),
        tx.system.findMany({
          where: { id: { in: [...new Set(rows.flatMap((row) => (row.systemId ? [row.systemId] : [])))] } },
          select: { id: true, name: true, ownerId: true },
        }),
      ]);
      const owners = await tx.user.findMany({
        where: { id: { in: [...new Set([...controls.flatMap((c) => (c.ownerId ? [c.ownerId] : [])), ...systems.map((s) => s.ownerId)])] } },
        select: { id: true, name: true },
      });
      const controlById = new Map(controls.map((control) => [control.id, control]));
      const systemById = new Map(systems.map((system) => [system.id, system]));
      const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

      const counts = emptyCheckUpStateCounts();
      const findings = emptyCheckUpFindings();
      const checkUps = rows
        .map((row): AuditCheckUp => {
          const { ownerId, ...control } = controlById.get(row.controlId)!;
          const system = row.systemId ? systemById.get(row.systemId)! : null;
          const recipientId = checkUpRecipientId({ system, control: { ownerId } });
          const state = checkUpState(
            { answered: row.response !== null, evaluated: row.evaluation !== null, withdrawn: row.withdrawal !== null },
            { status: audit.status, dueDate: audit.dueDate },
            now,
          );
          addCheckUpState(counts, state);
          if (row.evaluation) {
            findings[row.evaluation.outcome] += 1;
            if (row.risk) findings.risksOpened += 1;
          }
          return {
            id: row.id,
            control,
            target: system ? { kind: "system", id: system.id, name: system.name } : { kind: "organization" },
            recipient: recipientId ? (ownerById.get(recipientId) ?? null) : null,
            state,
            questions: row.questions,
            response: row.response && {
              respondedAt: row.response.respondedAt.toISOString(),
              respondedByName: row.response.respondedBy.name,
              evidenceLinks: row.response.evidenceLinks.flatMap((link) => {
                const safe = safeHttpUrl(link);
                return safe ? [safe] : [];
              }),
            },
            evaluation: row.evaluation && {
              outcome: row.evaluation.outcome,
              comment: row.evaluation.comment,
              evaluatedByName: row.evaluation.evaluatedBy.name,
              evaluatedAt: row.evaluation.evaluatedAt.toISOString(),
            },
            withdrawal: row.withdrawal && {
              reason: row.withdrawal.reason,
              withdrawnByName: row.withdrawal.withdrawnBy.name,
              withdrawnAt: row.withdrawal.withdrawnAt.toISOString(),
            },
            risk: row.risk,
          };
        })
        .sort((a, b) => {
          const byControl = codeCollator.compare(a.control.code, b.control.code);
          if (byControl !== 0) return byControl;
          if (a.target.kind !== b.target.kind) return a.target.kind === "system" ? -1 : 1;
          return a.target.kind === "system" && b.target.kind === "system" ? nameCollator.compare(a.target.name, b.target.name) : 0;
        });

      return { audit, daysUntilDue, checkUps, counts, findings: audit.status === "CLOSED" ? findings : null, plan: null, auditQuestions: {} };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
