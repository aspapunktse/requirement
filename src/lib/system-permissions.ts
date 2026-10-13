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
 *   (`checkWaiveGate`, built on `canWaiveControl`). A RISK_OWNER who owns
 *   the System can't waive its *mandatory* Controls (#97): another Risk Owner
 *   or an ADMIN has to.
 * - Submit for review: the System's owner or an ADMIN.
 * - Every other owner action (change classification, declare
 *   Business Units / Framework Scope, log a Risk,
 *   mark Onboarded): the System's owner or an ADMIN too, through the
 *   `canX` helpers next to each feature, which all delegate to
 *   `isSystemOwnerOrAdmin` (#91), so there is one definition of "owner".
 * - Create a System: SYSTEM_OWNER, RISK_OWNER or ADMIN only (`canCreateSystem`);
 *   the creator becomes the System's owner.
 *
 * "The System's owner" is `system.ownerId`, whatever the owner's role — a
 * RISK_OWNER who owns the System is simply its owner. The exceptions are the
 * read-only System roles (`READ_ONLY_SYSTEM_ROLES`): COMPLIANCE_MANAGER (#71)
 * and INTERNAL_AUDITOR (#147) never write to a System, even as its recorded
 * owner. That is the one place the guarantee lives: every owner rule below
 * and in the `canX` helpers goes through `isSystemOwnerOrAdmin`.
 */

type Actor = { id: string; role: UserRole };
type OwnedSystem = { ownerId: string };

/**
 * Roles that see Systems purely to read them: they may never create or change
 * a System, its lifecycle, classification, Control Assessments, Risks or
 * Assessment Queries, not even as the System's recorded owner. The
 * COMPLIANCE_MANAGER reads them to curate applicability and coverage (#71);
 * the INTERNAL_AUDITOR to audit them, independently of what it audits (#147).
 */
export const READ_ONLY_SYSTEM_ROLES: UserRole[] = ["COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"];

/** Is `user` a role that may only read Systems (see READ_ONLY_SYSTEM_ROLES)? */
export function isReadOnlySystemRole(user: { role: UserRole }) {
  return READ_ONLY_SYSTEM_ROLES.includes(user.role);
}

/**
 * Roles that never write anywhere outside their own work, so being recorded as
 * a Control's Control Owner (#119) gives them no right to edit its Organization
 * Control Implementation (#120). The COMPLIANCE_MANAGER is not here: it curates
 * the requirement database, so it may edit any implementation.
 */
export const STRICTLY_READ_ONLY_ROLES: UserRole[] = ["INTERNAL_AUDITOR"];

/** Statuses that only go through the waive gate (mirrors `checkWaiveGate`). */
export const WAIVE_GATED_STATUSES: ControlAssessmentStatus[] = ["WAIVED", "NOT_APPLICABLE"];

/** Only these roles may set a Control Assessment to Waived or Not Applicable. */
export const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

/** How far a user's edit rights on a System's Control Assessments reach. */
export type AssessmentEditAccess = "full" | "waive-only" | "none";

/** Roles that may create a System (#91): the creator becomes its owner. */
export const ROLES_ALLOWED_TO_CREATE_SYSTEM: UserRole[] = ["SYSTEM_OWNER", "RISK_OWNER", "ADMIN"];

/** May `user` create a System? Anyone not named (VIEWER, REVIEWER, ...) is refused. */
export function canCreateSystem(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_CREATE_SYSTEM.includes(user.role);
}

/**
 * The System's owner, or an ADMIN (a read-only System role is never either).
 * "Owner" means `ownerId` alone, whatever the user's role (#91): the one rule
 * every owner action goes through.
 */
export function isSystemOwnerOrAdmin(user: Actor, system: OwnedSystem) {
  if (user.role === "ADMIN") return true;
  if (isReadOnlySystemRole(user)) return false;
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

/** Why `user` may not waive a Control on a System (see `waiveRefusal`). */
export type WaiveRefusal = "role" | "owns-system";

/**
 * Why `user` may NOT waive (set Waived / Not Applicable, or answer N/A to the
 * Self-Assessment Question of) `control` on `system`, or null if they may. The
 * one definition of the waive rule, shared by the routes (`checkWaiveGate`)
 * and the UI:
 * - "role": only ADMIN and RISK_OWNER may waive at all.
 * - "owns-system" (#97): a RISK_OWNER who owns the System can't waive its
 *   *mandatory* Controls; another Risk Owner or an ADMIN has to. They may
 *   still waive its non-mandatory Controls, and an ADMIN may waive anything,
 *   including on a System they own.
 * It doesn't cover the justification note a mandatory Control also needs
 * (`checkWaiveGate`), which is a data check rather than a permission.
 */
export function waiveRefusal(user: Actor, system: OwnedSystem, control: { mandatory: boolean }): WaiveRefusal | null {
  if (!ROLES_ALLOWED_TO_WAIVE.includes(user.role)) return "role";
  if (user.role === "RISK_OWNER" && system.ownerId === user.id && control.mandatory) return "owns-system";
  return null;
}

/** May `user` waive `control` on `system`? */
export function canWaiveControl(user: Actor, system: OwnedSystem, control: { mandatory: boolean }) {
  return waiveRefusal(user, system, control) === null;
}
