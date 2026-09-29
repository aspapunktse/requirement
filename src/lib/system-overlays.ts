import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getApplicableControls,
  diffApplicabilityOps,
  type SystemClassification,
} from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";

/**
 * Who may declare or undeclare a Regulatory Overlay on a System: ADMIN, or
 * the owning SYSTEM_OWNER — and only while the System is still Draft. Same
 * rule as Capability declaration (see canManageCapabilities) — these are
 * both System-Owner self-declarations, not admin-only edits. See ADR 0003.
 */
export function canManageRegulatoryOverlays(
  user: { id: string; role: UserRole },
  system: { ownerId: string; status: string },
) {
  if (system.status !== "DRAFT") return false;
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

export function getSystemRegulatoryOverlays(systemId: string) {
  return prisma.regulatoryOverlay.findMany({
    where: { systems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

type OverlaySystem = SystemClassification & { id: string };

/**
 * Declaring a Regulatory Overlay can widen the applicable Control set
 * (any Control scoped to this overlay). Syncs Assessment rows the same
 * way a Deployment Facet change does — see diffApplicabilityOps.
 */
export async function applyOverlayDeclared(system: OverlaySystem, overlayId: string, actorId: string) {
  const newOverlayIds = [...system.regulatoryOverlays.map((o) => o.id), overlayId];

  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableControls(system),
    getApplicableControls({ ...system, regulatoryOverlays: newOverlayIds.map((id) => ({ id })) }),
  ]);

  const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable);
  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: { regulatoryOverlays: { connect: { id: overlayId } } },
    }),
    deleteOp,
    createOp,
  ]);

  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Regulatory Overlay declared (+${added}/-${removed.count} Control Assessment(s))`,
    actorId,
  );

  return { added, removed: removed.count };
}

/**
 * Un-declaring a Regulatory Overlay can narrow the applicable Control
 * set. An untouched Assessment for a Control that's no longer
 * applicable is removed; one a human has already worked on is left in
 * place and surfaced via getStaleAssessments.
 */
export async function applyOverlayRemoved(system: OverlaySystem, overlayId: string, actorId: string) {
  const newOverlayIds = system.regulatoryOverlays.map((o) => o.id).filter((id) => id !== overlayId);

  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableControls(system),
    getApplicableControls({ ...system, regulatoryOverlays: newOverlayIds.map((id) => ({ id })) }),
  ]);

  const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable);
  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: { regulatoryOverlays: { disconnect: { id: overlayId } } },
    }),
    deleteOp,
    createOp,
  ]);

  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Regulatory Overlay removed (+${added}/-${removed.count} Control Assessment(s))`,
    actorId,
  );

  return { added, removed: removed.count };
}
