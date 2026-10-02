import type { ControlAssessmentStatus, ControlOfferingType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { getApplicableControl, getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import {
  controlOfferingRefusal,
  describeOfferingAdded,
  describeOfferingChanged,
  describeOfferingRemoved,
  describeProviderMarked,
  NOT_A_PROVIDER_REFUSAL,
  offeringValuesDiffer,
  resultingOfferingValues,
  UNMARK_PROVIDER_REFUSAL,
} from "@/lib/control-offering-rules";

/**
 * Providers and their Control Offerings (PRD 0001 F-IN.2, ADR 0008, #123): the
 * data side. The rules (who may, what an Offering must contain, the Change Event
 * wording) are pure and live in `control-offering-rules.ts`. Nothing reads an
 * Offering to change any System's status yet (dependencies are #124).
 */

/** The System as the Offering code needs it: its classification (for applicability) and id. */
type ProviderSystem = SystemClassification & { id: string };

/**
 * One Offering as shown to everyone who can see the Provider. `applies` is
 * whether the Control still applies to the Provider (an Offering is kept when
 * it stops, and gets no credit once #124 lands). `providerStatus` is the
 * Provider's OWN Control Assessment status for the Control, Not Started when it
 * has no row: what dependents will read in #124, not the Provider's effective
 * status (product-owner decision: no chains through the Provider's own sources).
 */
export type ControlOfferingRow = {
  id: string;
  control: { id: string; code: string; title: string };
  type: ControlOfferingType;
  customerResponsibility: string | null;
  applies: boolean;
  providerStatus: ControlAssessmentStatus;
};

/** A Control the Provider could still offer: it applies to the Provider and isn't offered yet. */
export type OfferableControl = { id: string; code: string; title: string };

const OFFERING_INCLUDE = { control: { select: { id: true, code: true, title: true } } } satisfies Prisma.ControlOfferingInclude;

type OfferingWithControl = Prisma.ControlOfferingGetPayload<{ include: typeof OFFERING_INCLUDE }>;

/**
 * The stored status of `systemId`'s own Control Assessment of each Control, in
 * one query. A Control with no row is absent from the map (it reads as Not
 * Started). This is the Provider's own status, never an effective status.
 */
export async function loadOwnAssessmentStatuses(systemId: string, controlIds: string[], client: Pick<Prisma.TransactionClient, "controlAssessment"> = prisma) {
  if (controlIds.length === 0) return new Map<string, ControlAssessmentStatus>();
  const rows = await client.controlAssessment.findMany({
    where: { systemId, controlId: { in: controlIds } },
    select: { controlId: true, status: true },
  });
  return new Map(rows.map((row) => [row.controlId, row.status]));
}

/** Builds the rows for already-loaded Offerings of one Provider with two bulk queries, however many there are. */
async function toOfferingRows(provider: ProviderSystem, offerings: OfferingWithControl[]): Promise<ControlOfferingRow[]> {
  const controlIds = offerings.map((offering) => offering.controlId);
  const [applicable, statuses] = await Promise.all([
    controlIds.length > 0 ? getApplicableControls(provider, { controlIds }) : Promise.resolve([]),
    loadOwnAssessmentStatuses(provider.id, controlIds),
  ]);
  const applicableIds = new Set(applicable.map((control) => control.id));
  return offerings.map((offering) => ({
    id: offering.id,
    control: offering.control,
    type: offering.type,
    customerResponsibility: offering.customerResponsibility,
    applies: applicableIds.has(offering.controlId),
    providerStatus: statuses.get(offering.controlId) ?? "NOT_STARTED",
  }));
}

/** Every Offering of the Provider, by Control code. Empty for a System that isn't a Provider. */
export async function listControlOfferings(provider: ProviderSystem): Promise<ControlOfferingRow[]> {
  const offerings = await prisma.controlOffering.findMany({
    where: { providerId: provider.id },
    include: OFFERING_INCLUDE,
    orderBy: { control: { code: "asc" } },
  });
  return toOfferingRows(provider, offerings);
}

/** One of the Provider's Offerings as `listControlOfferings` shows it, or null if it isn't the Provider's. */
export async function getControlOfferingRow(provider: ProviderSystem, offeringId: string): Promise<ControlOfferingRow | null> {
  const offering = await prisma.controlOffering.findFirst({
    where: { id: offeringId, providerId: provider.id },
    include: OFFERING_INCLUDE,
  });
  if (!offering) return null;
  const [row] = await toOfferingRows(provider, [offering]);
  return row;
}

/**
 * The Controls the Provider could offer right now: the ones that apply to it
 * (a Provider can only offer a Control it is itself assessed on) minus the ones
 * it already offers. For the picker on the System page.
 */
export async function listOfferableControls(provider: ProviderSystem): Promise<OfferableControl[]> {
  const [applicable, offered] = await Promise.all([
    getApplicableControls(provider),
    prisma.controlOffering.findMany({ where: { providerId: provider.id }, select: { controlId: true } }),
  ]);
  const offeredIds = new Set(offered.map((offering) => offering.controlId));
  return applicable
    .filter((control) => !offeredIds.has(control.id))
    .map((control) => ({ id: control.id, code: control.code, title: control.title }));
}

export type OfferingResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * One transaction per Provider at a time: marking, unmarking, adding and
 * removing Offerings all take this lock first, so an unmark can't slip in
 * between an Offering being checked and written (and the events stay in order).
 */
async function lockProvider(tx: Prisma.TransactionClient, providerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${providerId}))`;
}

/**
 * Marks or unmarks the System as a Provider. Already in that state: nothing is
 * written (`changed: false`, no event). Unmarking is refused (409) while the
 * System has Offerings. Otherwise one `CLASSIFICATION_CHANGED` event by the
 * acting User, in the same transaction.
 */
export async function setSystemProvider(
  systemId: string,
  isProvider: boolean,
  actorId: string,
): Promise<OfferingResult<{ isProvider: boolean; changed: boolean }>> {
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, systemId);
    const current = await tx.system.findUnique({ where: { id: systemId }, select: { isProvider: true } });
    if (!current) return { ok: false, status: 404, error: "System not found" } as const;
    if (current.isProvider === isProvider) return { ok: true, value: { isProvider, changed: false } } as const;

    if (!isProvider && (await tx.controlOffering.count({ where: { providerId: systemId } })) > 0) {
      return { ok: false, status: 409, error: UNMARK_PROVIDER_REFUSAL } as const;
    }

    await tx.system.update({ where: { id: systemId }, data: { isProvider } });
    await logChangeEvent(systemId, "CLASSIFICATION_CHANGED", describeProviderMarked(isProvider), actorId, tx);
    return { ok: true, value: { isProvider, changed: true } } as const;
  });
}

/**
 * Adds an Offering. Checks, in order: Shared needs a text (400); the System is
 * a Provider (409); the Control exists (404) and applies to the Provider (409);
 * it isn't offered yet (409). A Full Offering stores no text. One
 * `CONTROL_OFFERING_CHANGED` event, in the same transaction.
 */
export async function createControlOffering(
  provider: ProviderSystem,
  input: { controlId: string; type: ControlOfferingType; customerResponsibility?: string | null },
  actorId: string,
): Promise<OfferingResult<{ offeringId: string }>> {
  const values = resultingOfferingValues(null, input);
  const refusal = controlOfferingRefusal(values.type, values.customerResponsibility);
  if (refusal) return { ok: false, status: 400, error: refusal };

  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, provider.id);
    const current = await tx.system.findUnique({ where: { id: provider.id }, select: { isProvider: true } });
    if (!current) return { ok: false, status: 404, error: "System not found" } as const;
    if (!current.isProvider) return { ok: false, status: 409, error: NOT_A_PROVIDER_REFUSAL } as const;

    const control = await tx.control.findUnique({ where: { id: input.controlId }, select: { id: true, code: true } });
    if (!control) return { ok: false, status: 404, error: "Control not found" } as const;
    if (!(await getApplicableControl(provider, control.id))) {
      return { ok: false, status: 409, error: "A Provider can only offer a Control that applies to it" } as const;
    }
    if (await tx.controlOffering.findUnique({ where: { providerId_controlId: { providerId: provider.id, controlId: control.id } }, select: { id: true } })) {
      return { ok: false, status: 409, error: "This Provider already offers that Control" } as const;
    }

    const offering = await tx.controlOffering.create({
      data: { providerId: provider.id, controlId: control.id, ...values },
      select: { id: true },
    });
    await logChangeEvent(provider.id, "CONTROL_OFFERING_CHANGED", describeOfferingAdded(control.code, values.type), actorId, tx);
    return { ok: true, value: { offeringId: offering.id } } as const;
  });
}

/**
 * Changes an Offering's type and/or text. The rule is judged on the resulting
 * values (so a Shared Offering can't lose its text, and Shared to Full clears
 * it). The Offering of another Provider, or none, is 404. A change that leaves
 * the values as they are writes nothing and no event (`changed: false`). It
 * works whether or not the Control still applies to the Provider.
 */
export async function updateControlOffering(
  provider: ProviderSystem,
  offeringId: string,
  patch: { type?: ControlOfferingType; customerResponsibility?: string | null },
  actorId: string,
): Promise<OfferingResult<{ changed: boolean }>> {
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, provider.id);
    const offering = await tx.controlOffering.findFirst({
      where: { id: offeringId, providerId: provider.id },
      include: OFFERING_INCLUDE,
    });
    if (!offering) return { ok: false, status: 404, error: "Control Offering not found" } as const;

    const before = { type: offering.type, customerResponsibility: offering.customerResponsibility };
    const after = resultingOfferingValues(before, patch);
    const refusal = controlOfferingRefusal(after.type, after.customerResponsibility);
    if (refusal) return { ok: false, status: 400, error: refusal } as const;
    if (!offeringValuesDiffer(before, after)) return { ok: true, value: { changed: false } } as const;

    await tx.controlOffering.update({ where: { id: offering.id }, data: after });
    const detail = describeOfferingChanged(offering.control.code, before, after);
    if (detail) await logChangeEvent(provider.id, "CONTROL_OFFERING_CHANGED", detail, actorId, tx);
    return { ok: true, value: { changed: true } } as const;
  });
}

/** Removes an Offering (404 if it isn't this Provider's), with one `CONTROL_OFFERING_CHANGED` event recording what it was. */
export async function removeControlOffering(provider: ProviderSystem, offeringId: string, actorId: string): Promise<OfferingResult<null>> {
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, provider.id);
    const offering = await tx.controlOffering.findFirst({
      where: { id: offeringId, providerId: provider.id },
      include: OFFERING_INCLUDE,
    });
    if (!offering) return { ok: false, status: 404, error: "Control Offering not found" } as const;

    await tx.controlOffering.delete({ where: { id: offering.id } });
    await logChangeEvent(provider.id, "CONTROL_OFFERING_CHANGED", describeOfferingRemoved(offering.control.code, offering.type), actorId, tx);
    return { ok: true, value: null } as const;
  });
}
