import type { ControlApplicability, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { InternalAuditError } from "@/lib/internal-audits";
import { internalAuditEditRefusal, formatCalendarDate } from "@/lib/internal-audit-rules";
import {
  launchSummaryText,
  planLaunch,
  validateQuestionList,
  type LaunchControl,
  type LaunchInputs,
  type LaunchPlan,
  type LaunchSystem,
} from "@/lib/check-up-rules";

/**
 * The draft's questions, the launch preview, the launch itself and the generated Check-ups
 * (PRD 0001 F-IA.2, F-IA.3, #154). Who may call these is decided by the routes and pages; the
 * draft-only rule and every launch rule are applied here, inside the write's transaction.
 *
 * Launching writes no Change Event (product-owner decision 12a of 2026-10-13, comment on #154): F-CE.1 lists a Check-up being evaluated (#156), not an audit
 * being launched. Nothing is notified: a Check-up exists, and the recipient is shown on the audit
 * page; recipients meet it in "My tasks" from #155.
 *
 * Every read a write depends on uses the transaction client, and the multi-statement readers run
 * in one REPEATABLE READ snapshot, so a Control deleted meanwhile can't leave a mapping or join
 * row pointing nowhere (see the supervised-workflow gotchas).
 */

const SNAPSHOT = { isolationLevel: "RepeatableRead" } as const;
const codeCollator = new Intl.Collator("en", { numeric: true });

/**
 * Replaces the draft's questions for one target Control with `questions`, in that order
 * (add, remove, edit and reorder are all this one write). Throws `InternalAuditError`: 404 if
 * there is no such audit or the Control isn't one of its targets, 409 if the audit isn't a draft
 * any more, 400 if the list is invalid. An empty list is allowed on a draft (launch refuses it).
 */
export async function setDraftQuestions(internalAuditId: string, controlId: string, questions: string[]) {
  const problems = validateQuestionList(questions);
  if (problems.length > 0) throw new InternalAuditError(400, problems.join("; "), problems);

  await prisma.$transaction(async (tx) => {
    const audit = await tx.internalAudit.findUnique({ where: { id: internalAuditId }, select: { status: true } });
    if (!audit) throw new InternalAuditError(404, "Internal Audit not found");
    const refusal = internalAuditEditRefusal(audit.status);
    if (refusal) throw new InternalAuditError(409, refusal);

    const row = await tx.internalAuditControl.findUnique({
      where: { internalAuditId_controlId: { internalAuditId, controlId } },
      select: { id: true },
    });
    if (!row) throw new InternalAuditError(404, "That Control is not a target of this Internal Audit");

    // Touching the audit under the status guard serialises with a concurrent launch: whichever
    // comes second sees the other's result (a launch makes this count 0, so a 409).
    const touched = await tx.internalAudit.updateMany({ where: { id: internalAuditId, status: "DRAFT" }, data: { updatedAt: new Date() } });
    if (touched.count === 0) throw new InternalAuditError(409, "Only a draft Internal Audit can be edited");

    await tx.internalAuditQuestion.deleteMany({ where: { internalAuditControlId: row.id } });
    await tx.internalAuditQuestion.createMany({
      data: questions.map((text, index) => ({ internalAuditControlId: row.id, position: index + 1, text: text.trim() })),
    });
  });
}

type AuditForLaunch = { title: string; dueDate: Date; includeOrganization: boolean };

/** Bulk-loads what `planLaunch` needs, in a constant number of queries, on the caller's transaction client. */
async function loadLaunchInputs(tx: Prisma.TransactionClient, internalAuditId: string, audit: AuditForLaunch): Promise<LaunchInputs> {
  const [controlRows, systemRows] = await Promise.all([
    tx.internalAuditControl.findMany({
      where: { internalAuditId },
      select: { controlId: true, questions: { orderBy: { position: "asc" }, select: { text: true } } },
    }),
    tx.internalAuditSystem.findMany({ where: { internalAuditId }, select: { systemId: true } }),
  ]);
  const questionsByControlId = new Map(controlRows.map((row) => [row.controlId, row.questions.map((q) => q.text)]));
  const controls = await tx.control.findMany({
    where: { id: { in: controlRows.map((row) => row.controlId) } },
    select: {
      id: true,
      code: true,
      title: true,
      applicability: true,
      ownerId: true,
      minConfidentialityImpactLevel: true,
      minIntegrityImpactLevel: true,
      minAvailabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      mappings: {
        select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } },
      },
    },
  });
  const systems = await tx.system.findMany({
    where: { id: { in: systemRows.map((row) => row.systemId) } },
    select: {
      id: true,
      name: true,
      confidentialityImpactLevel: true,
      integrityImpactLevel: true,
      availabilityImpactLevel: true,
      deploymentFacets: { select: { id: true } },
      frameworkScopes: { select: { id: true } },
    },
  });
  return {
    audit: { title: audit.title, dueDate: formatCalendarDate(audit.dueDate), includeOrganization: audit.includeOrganization },
    controls: controls.map((control): LaunchControl => ({ ...control, questions: questionsByControlId.get(control.id) ?? [] })),
    systems: systems satisfies LaunchSystem[],
  };
}

export type LaunchReport = {
  /** The counts as one sentence. */
  summary: string;
  systemCheckUpCount: number;
  organizationCheckUpCount: number;
  /** Skipped System and Control pairs, grouped by Control (by code). */
  skipped: { control: { id: string; code: string; title: string }; systems: { id: string; name: string }[] }[];
  skippedCount: number;
  blockers: { kind: string; message: string }[];
};

function describePlan(plan: LaunchPlan, inputs: LaunchInputs): LaunchReport {
  const controlById = new Map(inputs.controls.map((control) => [control.id, control]));
  const systemById = new Map(inputs.systems.map((system) => [system.id, system]));
  const grouped = new Map<string, { id: string; name: string }[]>();
  for (const pair of plan.skipped) {
    const systems = grouped.get(pair.controlId) ?? [];
    systems.push({ id: pair.systemId, name: systemById.get(pair.systemId)!.name });
    grouped.set(pair.controlId, systems);
  }
  const skipped = [...grouped.entries()]
    .map(([controlId, systems]) => {
      const { id, code, title } = controlById.get(controlId)!;
      return { control: { id, code, title }, systems };
    })
    .sort((a, b) => codeCollator.compare(a.control.code, b.control.code));
  return {
    summary: launchSummaryText(plan),
    systemCheckUpCount: plan.systemCheckUpCount,
    organizationCheckUpCount: plan.organizationCheckUpCount,
    skipped,
    skippedCount: plan.skipped.length,
    blockers: plan.blockers.map(({ kind, message }) => ({ kind, message })),
  };
}

/**
 * What launching the draft `internalAuditId` would create and skip, and what blocks it, computed
 * by the same `planLaunch` the launch uses. Null if there is no such audit or it isn't a draft.
 */
export async function getLaunchPreview(internalAuditId: string, now = new Date()): Promise<LaunchReport | null> {
  return prisma.$transaction(async (tx) => {
    const audit = await tx.internalAudit.findUnique({
      where: { id: internalAuditId },
      select: { status: true, title: true, dueDate: true, includeOrganization: true },
    });
    if (!audit || audit.status !== "DRAFT") return null;
    const inputs = await loadLaunchInputs(tx, internalAuditId, audit);
    return describePlan(planLaunch(inputs, now), inputs);
  }, SNAPSHOT);
}

/**
 * Launches a draft Internal Audit in one transaction: validates it, generates the Check-ups with
 * their own copies of the questions, and marks the audit LAUNCHED by `launchedById`. Throws
 * `InternalAuditError`: 404 if there is no such audit, 409 if it isn't a draft (so a second launch
 * is refused), 400 naming everything that blocks it (see `planLaunch`). Nothing is written unless
 * all of it succeeds. Returns the launch summary.
 */
export async function launchInternalAudit(internalAuditId: string, launchedById: string, now = new Date()): Promise<LaunchReport> {
  return prisma.$transaction(async (tx) => {
    const audit = await tx.internalAudit.findUnique({
      where: { id: internalAuditId },
      select: { status: true, title: true, dueDate: true, includeOrganization: true },
    });
    if (!audit) throw new InternalAuditError(404, "Internal Audit not found");
    if (audit.status !== "DRAFT") {
      throw new InternalAuditError(409, `This Internal Audit is already ${audit.status.toLowerCase()}: only a draft can be launched`);
    }

    // The status guard inside the write: an audit launched since the read above is not launched twice.
    const claimed = await tx.internalAudit.updateMany({
      where: { id: internalAuditId, status: "DRAFT" },
      data: { status: "LAUNCHED", launchedAt: now, launchedById },
    });
    if (claimed.count === 0) throw new InternalAuditError(409, "Only a draft Internal Audit can be launched");

    const inputs = await loadLaunchInputs(tx, internalAuditId, audit);
    const plan = planLaunch(inputs, now);
    if (plan.blockers.length > 0) {
      // Throwing rolls the claim back: a refused launch changes nothing.
      throw new InternalAuditError(
        400,
        `This Internal Audit can't be launched yet: ${plan.blockers.map((b) => b.message).join("; ")}`,
        plan.blockers.map((b) => b.message),
      );
    }

    const created = await tx.checkUp.createManyAndReturn({
      data: plan.checkUps.map(({ controlId, systemId }) => ({ internalAuditId, controlId, systemId })),
      select: { id: true, controlId: true, systemId: true },
    });
    const idByTarget = new Map(created.map((checkUp) => [`${checkUp.controlId}/${checkUp.systemId ?? ""}`, checkUp.id]));
    await tx.checkUpQuestion.createMany({
      data: plan.checkUps.flatMap(({ controlId, systemId, questions }) => {
        const checkUpId = idByTarget.get(`${controlId}/${systemId ?? ""}`)!;
        return questions.map((text, index) => ({ checkUpId, position: index + 1, text }));
      }),
    });
    // The draft's question rows are kept as the plan's record; each Check-up carries its own copy.
    return describePlan(plan, inputs);
  }, SNAPSHOT);
}

export type CheckUpRow = {
  id: string;
  control: { id: string; code: string; title: string; applicability: ControlApplicability };
  target: { kind: "system"; id: string; name: string } | { kind: "organization" };
  /** Who owns the target *now*: the System's owner, or the Control Owner; null if the Control has none. */
  recipient: { id: string; name: string } | null;
  questions: string[];
};

/**
 * The Check-ups of an Internal Audit, by Control code and then target (Systems by name, the
 * Organization last). The recipient is derived on every read, never stored, so it follows a change
 * of System owner or Control Owner (#155).
 */
export async function listCheckUps(internalAuditId: string): Promise<CheckUpRow[]> {
  return prisma.$transaction(async (tx) => {
    const checkUps = await tx.checkUp.findMany({
      where: { internalAuditId },
      select: { id: true, controlId: true, systemId: true, questions: { orderBy: { position: "asc" }, select: { text: true } } },
    });
    if (checkUps.length === 0) return [];
    const [controls, systems] = await Promise.all([
      tx.control.findMany({
        where: { id: { in: [...new Set(checkUps.map((c) => c.controlId))] } },
        select: { id: true, code: true, title: true, applicability: true, ownerId: true },
      }),
      tx.system.findMany({
        where: { id: { in: [...new Set(checkUps.flatMap((c) => (c.systemId ? [c.systemId] : [])))] } },
        select: { id: true, name: true, ownerId: true },
      }),
    ]);
    const owners = await tx.user.findMany({
      where: { id: { in: [...controls.flatMap((c) => (c.ownerId ? [c.ownerId] : [])), ...systems.map((s) => s.ownerId)] } },
      select: { id: true, name: true },
    });
    const controlById = new Map(controls.map((control) => [control.id, control]));
    const systemById = new Map(systems.map((system) => [system.id, system]));
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

    return checkUps
      .map((checkUp): CheckUpRow => {
        const { ownerId, ...control } = controlById.get(checkUp.controlId)!;
        const system = checkUp.systemId ? systemById.get(checkUp.systemId)! : null;
        const recipientId = system ? system.ownerId : ownerId;
        return {
          id: checkUp.id,
          control,
          target: system ? { kind: "system", id: system.id, name: system.name } : { kind: "organization" },
          recipient: recipientId ? (ownerById.get(recipientId) ?? null) : null,
          questions: checkUp.questions.map((q) => q.text),
        };
      })
      .sort(
        (a, b) =>
          codeCollator.compare(a.control.code, b.control.code) ||
          (a.target.kind === b.target.kind
            ? a.target.kind === "system" && b.target.kind === "system"
              ? a.target.name.localeCompare(b.target.name, "en")
              : 0
            : a.target.kind === "system"
              ? -1
              : 1),
      );
  }, SNAPSHOT);
}
