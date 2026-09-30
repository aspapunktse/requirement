import type { ControlAssessmentStatus, SelfAssessmentAnswer, UserRole } from "@prisma/client";

/**
 * Who may change what on a System they can see (#78). Seeing a System (see
 * `visibleSystemsWhere`) never implies writing to it: each action below has
 * its own rule, and anyone not named is refused (403), including roles added
 * in future. Pure and Prisma-free so client components could share it.
 *
 * - Edit a Control Assessment / answer a Self-Assessment Question: the
 *   System's owner or an ADMIN. A RISK_OWNER additionally, but only for the
 *   Waived / Not Applicable transitions that go through the waive gate
 *   (`checkWaiveGate`).
 * - Submit for review: the System's owner or an ADMIN.
 * - Every other owner action (change classification, declare Regulatory
 *   Overlays / Capabilities / Business Units / Framework Scope, log a Risk,
 *   mark Onboarded): the System's owner or an ADMIN too, through the
 *   `canX` helpers next to each feature, which all delegate to
 *   `isSystemOwnerOrAdmin` (#91), so there is one definition of "owner".
 * - Create a System: SYSTEM_OWNER, RISK_OWNER or ADMIN only (`canCreateSystem`);
 *   the creator becomes the System's owner.
 *
 * "The System's owner" is `system.ownerId`, whatever the owner's role — a
 * RISK_OWNER who owns the System is simply its owner. The one exception is
 * COMPLIANCE_MANAGER, which is strictly read-only on Systems (#71).
 */

type Actor = { id: string; role: UserRole };
type OwnedSystem = { ownerId: string };

/** Statuses that only go through the waive gate (mirrors `checkWaiveGate`). */
export const WAIVE_GATED_STATUSES: ControlAssessmentStatus[] = ["WAIVED", "NOT_APPLICABLE"];

/** How far a user's edit rights on a System's Control Assessments reach. */
export type AssessmentEditAccess = "full" | "waive-only" | "none";

/** Roles that may create a System (#91): the creator becomes its owner. */
export const ROLES_ALLOWED_TO_CREATE_SYSTEM: UserRole[] = ["SYSTEM_OWNER", "RISK_OWNER", "ADMIN"];

/** May `user` create a System? Anyone not named (VIEWER, REVIEWER, ...) is refused. */
export function canCreateSystem(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_CREATE_SYSTEM.includes(user.role);
}

/**
 * The System's owner, or an ADMIN (a COMPLIANCE_MANAGER is never either).
 * "Owner" means `ownerId` alone, whatever the user's role (#91): the one rule
 * every owner action goes through.
 */
export function isSystemOwnerOrAdmin(user: Actor, system: OwnedSystem) {
  if (user.role === "ADMIN") return true;
  if (user.role === "COMPLIANCE_MANAGER") return false;
  return system.ownerId === user.id;
}

/**
 * The reach of `user`'s rights to edit Assessments / answer Self-Assessment
 * Questions on `system`: everything (owner/ADMIN), only the waive-gated
 * Waived / Not Applicable transitions (a non-owner RISK_OWNER), or nothing.
 */
export function assessmentEditAccess(user: Actor, system: OwnedSystem): AssessmentEditAccess {
  if (isSystemOwnerOrAdmin(user, system)) return "full";
  if (user.role === "RISK_OWNER") return "waive-only";
  return "none";
}

/** May `user` set a Control Assessment on `system` to `targetStatus`? */
export function canEditAssessment(user: Actor, system: OwnedSystem, targetStatus: ControlAssessmentStatus) {
  const access = assessmentEditAccess(user, system);
  if (access === "full") return true;
  return access === "waive-only" && WAIVE_GATED_STATUSES.includes(targetStatus);
}

/** May `user` record `answer` to a Self-Assessment Question on `system`? */
export function canAnswerSelfAssessment(user: Actor, system: OwnedSystem, answer: SelfAssessmentAnswer) {
  const access = assessmentEditAccess(user, system);
  if (access === "full") return true;
  return access === "waive-only" && answer === "NA";
}

/** May `user` submit `system` for review? */
export function canSubmit(user: Actor, system: OwnedSystem) {
  return isSystemOwnerOrAdmin(user, system);
}
