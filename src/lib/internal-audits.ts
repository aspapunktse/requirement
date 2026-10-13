import type { ControlApplicability, InternalAuditStatus, OnboardingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultQuestionsFor } from "@/lib/check-up-rules";
import {
  dueDateRefusal,
  formatCalendarDate,
  internalAuditEditRefusal,
  parseCalendarDate,
  validateInternalAudit,
} from "@/lib/internal-audit-rules";
import { matchesSystemFilter, type SystemFilter } from "@/lib/internal-audit-system-filter";

/**
 * Reading and writing Internal Audits (PRD 0001 F-IA.1, #152). Who may call these is
 * decided by the routes and pages (`internal-audit-rules.ts`); the validity rules and the
 * draft-only rule are applied here, inside the write's transaction, so no caller can skip
 * them. No Change Event is written: drafting an audit isn't a compliance-relevant change.
 * Dates leave as "YYYY-MM-DD" / ISO strings so a result can be passed to a client component.
 */

export type InternalAuditSummary = {
  id: string;
  title: string;
  dueDate: string;
  status: InternalAuditStatus;
  includeOrganization: boolean;
  controlCount: number;
  systemCount: number;
  createdBy: { id: string; name: string };
};

export type InternalAuditDetail = {
  id: string;
  title: string;
  scopeDescription: string;
  dueDate: string;
  status: InternalAuditStatus;
  includeOrganization: boolean;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  /** Set once launched (#154). */
  launchedAt: string | null;
  launchedBy: { id: string; name: string } | null;
  /** `questions`: the draft's questions for the Control, in order (empty once launched: each Check-up has its own copy). */
  controls: { id: string; code: string; title: string; applicability: ControlApplicability; questions: string[] }[];
  systems: { id: string; name: string; status: OnboardingStatus }[];
};

export type ControlChoice = { id: string; code: string; title: string; applicability: ControlApplicability };
export type SystemChoice = { id: string; name: string; vendor: string | null; status: OnboardingStatus };

// Control codes sort numerically (A.5.2 before A.5.10), as elsewhere in the app (the Statement of Applicability).
const codeCollator = new Intl.Collator("en", { numeric: true });
const byCode = (a: { code: string }, b: { code: string }) => codeCollator.compare(a.code, b.code);

/** A refusal with the HTTP status the route answers with. */
export class InternalAuditError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message);
  }
}

// A reader that fetches rows and then their Controls or Systems must see one snapshot: a
// Control deleted between the statements would otherwise leave a join row pointing nowhere
// and Prisma throws on the missing required relation (see the supervised-workflow gotchas).
const SNAPSHOT = { isolationLevel: "RepeatableRead" } as const;

/** Every Internal Audit, soonest due date first, with its Control and System counts. */
export async function listInternalAudits(): Promise<InternalAuditSummary[]> {
  return prisma.$transaction(async (tx) => {
    const audits = await tx.internalAudit.findMany({
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        includeOrganization: true,
        createdBy: { select: { id: true, name: true } },
        _count: { select: { controls: true, systems: true } },
      },
    });
    return audits.map((audit) => ({
      id: audit.id,
      title: audit.title,
      dueDate: formatCalendarDate(audit.dueDate),
      status: audit.status,
      includeOrganization: audit.includeOrganization,
      controlCount: audit._count.controls,
      systemCount: audit._count.systems,
      createdBy: audit.createdBy,
    }));
  }, SNAPSHOT);
}

/** One Internal Audit with its target Controls and selected Systems, or null. */
export async function getInternalAudit(id: string): Promise<InternalAuditDetail | null> {
  return prisma.$transaction(async (tx) => {
    const audit = await tx.internalAudit.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } }, launchedBy: { select: { id: true, name: true } } },
    });
    if (!audit) return null;
    const [controlRows, systemRows] = await Promise.all([
      tx.internalAuditControl.findMany({
        where: { internalAuditId: id },
        select: { controlId: true, questions: { orderBy: { position: "asc" }, select: { text: true } } },
      }),
      tx.internalAuditSystem.findMany({ where: { internalAuditId: id }, select: { systemId: true } }),
    ]);
    const [controls, systems] = await Promise.all([
      tx.control.findMany({
        where: { id: { in: controlRows.map((row) => row.controlId) } },
        select: { id: true, code: true, title: true, applicability: true },
      }),
      tx.system.findMany({
        where: { id: { in: systemRows.map((row) => row.systemId) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true },
      }),
    ]);
    const questionsByControlId = new Map(controlRows.map((row) => [row.controlId, row.questions.map((q) => q.text)]));
    return {
      id: audit.id,
      title: audit.title,
      scopeDescription: audit.scopeDescription,
      dueDate: formatCalendarDate(audit.dueDate),
      status: audit.status,
      includeOrganization: audit.includeOrganization,
      createdBy: audit.createdBy,
      createdAt: audit.createdAt.toISOString(),
      updatedAt: audit.updatedAt.toISOString(),
      launchedAt: audit.launchedAt?.toISOString() ?? null,
      launchedBy: audit.launchedBy,
      controls: controls.sort(byCode).map((control) => ({ ...control, questions: questionsByControlId.get(control.id) ?? [] })),
      systems,
    };
  }, SNAPSHOT);
}

/** Every Control and every System (any status) the Internal Auditor can pick for an audit. */
export async function listAuditChoices(): Promise<{ controls: ControlChoice[]; systems: SystemChoice[] }> {
  const [controls, systems] = await Promise.all([
    prisma.control.findMany({
      select: { id: true, code: true, title: true, applicability: true },
    }),
    prisma.system.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, vendor: true, status: true },
    }),
  ]);
  return { controls: controls.sort(byCode), systems };
}

export type SystemFilterOptions = {
  /** Published Frameworks only: a Draft Framework is not visible to the Internal Auditor, so it is never offered. */
  frameworks: { id: string; name: string; version: string }[];
  deploymentFacets: { id: string; name: string }[];
  businessUnits: { id: string; name: string }[];
};

/** The choices for the "Select Systems by filter" panel. */
export async function listSystemFilterOptions(): Promise<SystemFilterOptions> {
  const [frameworks, deploymentFacets, businessUnits] = await Promise.all([
    prisma.framework.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ name: "asc" }, { version: "asc" }],
      select: { id: true, name: true, version: true },
    }),
    prisma.deploymentFacet.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.businessUnit.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { frameworks, deploymentFacets, businessUnits };
}

export type SystemFilterMatch = SystemChoice & { deploymentFacets: string[]; businessUnits: string[] };

/**
 * The Systems (any status) matching `filter`, by name, resolved now. Nothing is stored: the form adds
 * the result to the draft's picked Systems, and the audit keeps only those. Loads every System once and
 * applies the pure rule (`matchesSystemFilter`), so there is no second, database-side definition to keep
 * in step. A Framework that doesn't exist or is a Draft is refused with the same 400, so the response
 * doesn't reveal a Draft Framework.
 */
export async function resolveSystemFilter(filter: SystemFilter): Promise<SystemFilterMatch[]> {
  const framework = filter.frameworkId
    ? await prisma.framework.findFirst({
        where: { id: filter.frameworkId, status: "PUBLISHED" },
        select: { id: true, status: true, isBase: true },
      })
    : null;
  if (filter.frameworkId && !framework) throw new InternalAuditError(400, "That Framework doesn't exist");

  const systems = await prisma.system.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      vendor: true,
      status: true,
      deploymentFacets: { select: { id: true, name: true } },
      businessUnits: { select: { id: true, name: true } },
      frameworkScopes: { select: { id: true } },
    },
  });
  return systems
    .filter((system) => matchesSystemFilter(filter, system, framework))
    .map((system) => ({
      id: system.id,
      name: system.name,
      vendor: system.vendor,
      status: system.status,
      deploymentFacets: system.deploymentFacets.map((facet) => facet.name),
      businessUnits: system.businessUnits.map((unit) => unit.name),
    }));
}

export type InternalAuditInput = {
  title?: string;
  scopeDescription?: string;
  dueDate?: string | null;
  includeOrganization?: boolean;
  controlIds?: string[];
  systemIds?: string[];
};

const unique = (ids: string[]) => [...new Set(ids)];

/**
 * Gives each of `controlIds`, newly a target of draft `internalAuditId`, its starting question
 * list: the Control's Self-Assessment Question as it is now (#154). It is a copy, taken once: the
 * draft's question does not follow later edits to the Control. A Control without a question
 * starts with none, and must be given one before launch.
 */
async function seedDefaultQuestions(tx: Prisma.TransactionClient, internalAuditId: string, controlIds: string[]) {
  if (controlIds.length === 0) return;
  const [rows, controls] = await Promise.all([
    tx.internalAuditControl.findMany({ where: { internalAuditId, controlId: { in: controlIds } }, select: { id: true, controlId: true } }),
    tx.control.findMany({ where: { id: { in: controlIds } }, select: { id: true, question: true } }),
  ]);
  const questionByControlId = new Map(controls.map((control) => [control.id, control.question]));
  await tx.internalAuditQuestion.createMany({
    data: rows.flatMap((row) =>
      defaultQuestionsFor(questionByControlId.get(row.controlId)).map((text, index) => ({
        internalAuditControlId: row.id,
        position: index + 1,
        text,
      })),
    ),
  });
}

async function requireExisting(tx: Prisma.TransactionClient, controlIds: string[], systemIds: string[]) {
  const [controls, systems] = await Promise.all([
    tx.control.count({ where: { id: { in: controlIds } } }),
    tx.system.count({ where: { id: { in: systemIds } } }),
  ]);
  if (controls !== controlIds.length) throw new InternalAuditError(400, "One or more of the Controls don't exist");
  if (systems !== systemIds.length) throw new InternalAuditError(400, "One or more of the Systems don't exist");
}

function refuseInvalid(draft: Parameters<typeof validateInternalAudit>[0]) {
  const problems = validateInternalAudit(draft);
  if (problems.length > 0) throw new InternalAuditError(400, problems.join("; "), problems);
}

function refuseDueDate(dueDate: string, now: Date) {
  const refusal = dueDateRefusal(dueDate, now);
  if (refusal) throw new InternalAuditError(400, refusal);
}

/** Creates a draft Internal Audit by `createdById`, or throws an `InternalAuditError` (400). */
export async function createInternalAudit(input: InternalAuditInput, createdById: string, now = new Date()) {
  const draft = {
    title: input.title ?? "",
    controlIds: unique(input.controlIds ?? []),
    systemIds: unique(input.systemIds ?? []),
    includeOrganization: input.includeOrganization ?? false,
    dueDate: input.dueDate ?? null,
  };
  refuseInvalid(draft);
  refuseDueDate(draft.dueDate!, now);

  return prisma.$transaction(async (tx) => {
    await requireExisting(tx, draft.controlIds, draft.systemIds);
    const audit = await tx.internalAudit.create({
      data: {
        title: draft.title.trim(),
        scopeDescription: (input.scopeDescription ?? "").trim(),
        dueDate: parseCalendarDate(draft.dueDate!)!,
        includeOrganization: draft.includeOrganization,
        createdById,
        controls: { create: draft.controlIds.map((controlId) => ({ controlId })) },
        systems: { create: draft.systemIds.map((systemId) => ({ systemId })) },
      },
      select: { id: true },
    });
    await seedDefaultQuestions(tx, audit.id, draft.controlIds);
    return audit.id;
  });
}

/**
 * Edits a draft. A field that is absent is left alone; `controlIds` / `systemIds`, when
 * present, replace the set (rows for ones that stay are kept, so anything #154 hangs off
 * an audit-Control pair survives an edit). The edited audit must still be valid; the due
 * date is checked for the past only when it changes. 404 if there is no such audit, 409 if
 * it isn't a draft any more.
 */
export async function updateInternalAudit(id: string, input: InternalAuditInput, now = new Date()) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.internalAudit.findUnique({
      where: { id },
      include: { controls: { select: { controlId: true } }, systems: { select: { systemId: true } } },
    });
    if (!current) throw new InternalAuditError(404, "Internal Audit not found");
    const refusal = internalAuditEditRefusal(current.status);
    if (refusal) throw new InternalAuditError(409, refusal);

    const draft = {
      title: input.title ?? current.title,
      controlIds: unique(input.controlIds ?? current.controls.map((row) => row.controlId)),
      systemIds: unique(input.systemIds ?? current.systems.map((row) => row.systemId)),
      includeOrganization: input.includeOrganization ?? current.includeOrganization,
      dueDate: input.dueDate === undefined ? formatCalendarDate(current.dueDate) : input.dueDate,
    };
    refuseInvalid(draft);
    if (draft.dueDate !== formatCalendarDate(current.dueDate)) refuseDueDate(draft.dueDate!, now);
    await requireExisting(tx, draft.controlIds, draft.systemIds);

    // Guarded by the status as well, so an audit launched since the read above is not touched.
    const updated = await tx.internalAudit.updateMany({
      where: { id, status: "DRAFT" },
      data: {
        title: draft.title.trim(),
        scopeDescription: input.scopeDescription === undefined ? undefined : input.scopeDescription.trim(),
        dueDate: parseCalendarDate(draft.dueDate!)!,
        includeOrganization: draft.includeOrganization,
      },
    });
    if (updated.count === 0) throw new InternalAuditError(409, "Only a draft Internal Audit can be edited");

    const keptControls = new Set(current.controls.map((row) => row.controlId));
    await tx.internalAuditControl.deleteMany({ where: { internalAuditId: id, controlId: { notIn: draft.controlIds } } });
    const newControlIds = draft.controlIds.filter((controlId) => !keptControls.has(controlId));
    await tx.internalAuditControl.createMany({
      data: newControlIds.map((controlId) => ({ internalAuditId: id, controlId })),
    });
    await seedDefaultQuestions(tx, id, newControlIds);
    const keptSystems = new Set(current.systems.map((row) => row.systemId));
    await tx.internalAuditSystem.deleteMany({ where: { internalAuditId: id, systemId: { notIn: draft.systemIds } } });
    await tx.internalAuditSystem.createMany({
      data: draft.systemIds.filter((systemId) => !keptSystems.has(systemId)).map((systemId) => ({ internalAuditId: id, systemId })),
    });
  });
}

/** Deletes a draft (its Control and System rows go with it). 404 if missing, 409 if not a draft. */
export async function deleteInternalAudit(id: string) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.internalAudit.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new InternalAuditError(404, "Internal Audit not found");
    const refusal = internalAuditEditRefusal(current.status);
    if (refusal) throw new InternalAuditError(409, refusal);
    const deleted = await tx.internalAudit.deleteMany({ where: { id, status: "DRAFT" } });
    if (deleted.count === 0) throw new InternalAuditError(409, "Only a draft Internal Audit can be deleted");
  });
}
