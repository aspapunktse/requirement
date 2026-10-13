import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { ORGANIZATION_IMPLEMENTED_APPLICABILITIES } from "@/lib/organization-implementation-rules";
import { STRICTLY_READ_ONLY_ROLES } from "@/lib/system-permissions";

/** Where a Control Owner's task rows lead: the Organization's Controls, narrowed to the ones they own. */
export const CONTROL_OWNER_TASKS_HREF = "/organization/controls?mine=1";

/** An implementation in one of these statuses is still the Control Owner's to move. */
export const OPEN_IMPLEMENTATION_STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS"];

/**
 * The "My tasks" rows a user has as the Control Owner (#119) of Organizational
 * and Both Controls (#120): one per Control they own whose Organization Control
 * Implementation is Not Started or In Progress. A Control with no implementation
 * row counts as Not Started. Keyed on `ownerId` alone, whatever the user's role,
 * a Compliance Manager included: this is not System ownership, so the rule that a
 * Compliance Manager gets no System owner tasks (#71, #98) does not apply. A
 * Per-System Control has no implementation, so it never produces a task. A
 * strictly read-only role (the Internal Auditor, #147) gets none either: it may
 * not edit the implementation, so a task would lead nowhere.
 */
export async function getControlOwnerTasks(user: { id: string; role?: UserRole }): Promise<TaskRow[]> {
  if (user.role && STRICTLY_READ_ONLY_ROLES.includes(user.role)) return [];
  const controls = await prisma.control.findMany({
    where: {
      ownerId: user.id,
      applicability: { in: ORGANIZATION_IMPLEMENTED_APPLICABILITIES },
      OR: [
        { organizationImplementation: { is: null } },
        { organizationImplementation: { is: { status: { in: OPEN_IMPLEMENTATION_STATUSES } } } },
      ],
    },
    select: {
      id: true,
      code: true,
      title: true,
      organizationImplementation: { select: { status: true, updatedAt: true } },
    },
    orderBy: { code: "asc" },
  });

  return controls.map((control): TaskRow => {
    const status = control.organizationImplementation?.status ?? "NOT_STARTED";
    return {
      id: `${control.id}:implementation`,
      kind: "Control",
      title: `${control.code} — ${control.title}`,
      subtitle: "Organization Control Implementation",
      tone: controlAssessmentStatusTone(status),
      status: CONTROL_ASSESSMENT_STATUS_LABEL[status],
      ...(control.organizationImplementation && { updatedAt: control.organizationImplementation.updatedAt }),
      href: CONTROL_OWNER_TASKS_HREF,
    };
  });
}
