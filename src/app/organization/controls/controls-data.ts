import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import {
  ORGANIZATION_IMPLEMENTATION_CHANGE_MARKER,
  parseOrganizationImplementationChange,
} from "@/lib/effective-status";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks } from "@/lib/frameworks";
import {
  ORGANIZATION_IMPLEMENTED_APPLICABILITIES,
  canEditOrganizationImplementation,
} from "@/lib/organization-implementation-rules";
import type { OrgControlRow, OrgHistoryEntry, OrgView } from "./controls-types";

const collator = new Intl.Collator("en", { numeric: true });

/** How many history entries a Control keeps on the page (the newest). */
export const HISTORY_LIMIT = 20;

/**
 * Everything the Organization Control Implementations page shows for the acting user (design proposal A
 * "Implementation register", issue #284): every Organizational and Both Control with its Control Owner and
 * implementation, whether the user may edit it, how many Systems a Both Control reaches, the Published
 * Frameworks it maps to, and its history.
 *
 * History: the System-less ORGANIZATION_IMPLEMENTATION_CHANGED events carry no Control id, so they are read
 * in one query by their action and the wording `describeOrganizationImplementationChange` writes, and
 * matched to the Controls by code in memory (`parseOrganizationImplementationChange`). A Control's history
 * starts when it first changed status (no backfill: a Both Control's starts at #284).
 *
 * One RepeatableRead transaction, every query on `tx`, a constant number of queries however many Controls
 * and Systems there are. A Draft Framework's name is read out only to those who can see Drafts.
 */
export async function loadOrganizationControlsView(user: { id: string; name: string; role: UserRole }): Promise<OrgView> {
  const showDrafts = canSeeDraftFrameworks(user);
  return prisma.$transaction(
    async (tx) => {
      const controls = await tx.control.findMany({
        where: { applicability: { in: ORGANIZATION_IMPLEMENTED_APPLICABILITIES } },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          category: true,
          applicability: true,
          ownerId: true,
          owner: { select: { name: true } },
          minConfidentialityImpactLevel: true,
          minIntegrityImpactLevel: true,
          minAvailabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          originFramework: { select: { id: true, name: true, version: true, status: true } },
          organizationImplementation: { select: { status: true, description: true, updatedAt: true, updatedBy: { select: { name: true } } } },
          mappings: {
            select: {
              requirement: { select: { framework: { select: { id: true, name: true, version: true, status: true, isBase: true } } } },
            },
          },
        },
      });
      const systems = await tx.system.findMany({
        select: {
          id: true,
          confidentialityImpactLevel: true,
          integrityImpactLevel: true,
          availabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          frameworkScopes: { select: { id: true } },
        },
      });
      const events = await tx.changeEvent.findMany({
        where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", systemId: null, detail: { contains: ORGANIZATION_IMPLEMENTATION_CHANGE_MARKER } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { detail: true, actorId: true, createdAt: true },
      });
      const actorIds = [...new Set(events.map((event) => event.actorId).filter((id) => id !== SYSTEM_ACTOR))];
      const actors = actorIds.length === 0 ? [] : await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
      const actorName = new Map(actors.map((actor) => [actor.id, actor.name]));

      const historyByCode = new Map<string, OrgHistoryEntry[]>();
      for (const event of events) {
        const change = parseOrganizationImplementationChange(event.detail);
        if (!change) continue;
        const entries = historyByCode.get(change.controlCode) ?? [];
        if (entries.length >= HISTORY_LIMIT) continue;
        entries.push({
          at: event.createdAt.toISOString(),
          by: event.actorId === SYSTEM_ACTOR ? "System" : (actorName.get(event.actorId) ?? "Unknown user"),
          from: change.before,
          to: change.after,
        });
        historyByCode.set(change.controlCode, entries);
      }

      const rows = controls.map((control): OrgControlRow => {
        const implementation = control.organizationImplementation;
        const origin = control.originFramework;
        const frameworks = new Map<string, string>();
        for (const { requirement } of control.mappings) {
          if (requirement.framework.status !== "PUBLISHED") continue;
          frameworks.set(requirement.framework.id, frameworkLabel(requirement.framework));
        }
        return {
          id: control.id,
          code: control.code,
          title: control.title,
          applicability: control.applicability as OrgControlRow["applicability"],
          category: control.category,
          summary: control.description,
          ownerId: control.ownerId,
          ownerName: control.owner?.name ?? null,
          status: implementation?.status ?? "NOT_STARTED",
          description: implementation?.description ?? null,
          updatedAt: implementation?.updatedAt.toISOString() ?? null,
          updatedByName: implementation?.updatedBy?.name ?? null,
          canEdit: canEditOrganizationImplementation(user, { ownerId: control.ownerId }),
          systemCount: control.applicability === "BOTH" ? systems.filter((system) => controlAppliesToSystem(control, system)).length : 0,
          frameworks: [...frameworks.values()].sort((a, b) => collator.compare(a, b)),
          origin: origin
            ? { key: origin.id, label: origin.status === "PUBLISHED" || showDrafts ? frameworkLabel(origin) : "Draft Framework" }
            : null,
          history: historyByCode.get(control.code) ?? [],
        };
      });

      return { userId: user.id, userName: user.name, role: user.role, roleLabel: roleLabel(user.role), rows };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
