import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/app/organization/controls/controls-logic";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { canEditControlLibrary } from "@/lib/control-library";
import {
  effectiveNote,
  effectiveSourceDetails,
  effectiveSourceLabel,
  inheritanceSourcesFor,
  resolveEffectiveStatus,
} from "@/lib/effective-status";
import { loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { classifiedForApplicability, libraryRowOf } from "../library-data";
import type { ControlPageView, PageOrganization, PageSystem, PageSystems } from "./control-page-types";

const collator = new Intl.Collator("en", { numeric: true });

/** The Control code in a URL segment: percent-decoded once, whichever way the framework hands it over. */
export function decodeControlCode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Everything one Control's page shows for the acting user (design proposal B "Side rail and tabs", issue #314),
 * or null when no Control has this code. The Control comes shaped like a Control Library row, with the same Draft
 * rules as `GET /api/controls` (`controlIncludeFor`, `redactDraftOrigin`): a user who can't see Draft Frameworks
 * gets no Draft mapping and no Draft origin name, and a Control mapped only to Drafts reads as not mapped.
 *
 * - Organization (Organizational and Both Controls): the Organization Control Implementation, Not Started while
 *   it has no row.
 * - Systems (Per-System and Both Controls): the counts are over every System the Control applies to; the list is
 *   only the Systems the user can see (`visibleSystemsWhere`). Each System's status is the effective status the
 *   System page shows for the Control: the System's own Assessment, the Organization (Both) and the Provider
 *   Offerings the System depends on, through `resolveEffectiveStatus`.
 *
 * One RepeatableRead transaction with every query on `tx`, so a Control, Requirement or System deleted halfway can't
 * leave a half-read page, and a constant number of queries however many Systems there are.
 */
export async function loadControlPageView(user: { id: string; name: string; role: UserRole }, code: string): Promise<ControlPageView | null> {
  const showDrafts = canSeeDraftFrameworks(user);

  return prisma.$transaction(
    async (tx) => {
      const found = await tx.control.findUnique({ where: { code }, include: controlIncludeFor(user) });
      if (!found) return null;
      const control = redactDraftOrigin(user, found);

      const frameworks = await tx.framework.findMany({ select: { id: true, name: true, version: true, status: true, isBase: true } });
      const frameworkById = new Map(frameworks.map((framework) => [framework.id, framework]));
      const baseFramework = frameworks.find((framework) => framework.isBase && (framework.status === "PUBLISHED" || showDrafts));

      const hasOrganization = control.applicability !== "PER_SYSTEM";
      const reachesSystems = control.applicability !== "ORGANIZATIONAL";

      let organization: PageOrganization | null = null;
      let organizationStatus: ControlAssessmentStatus | undefined;
      if (hasOrganization) {
        const implementation = await tx.organizationControlImplementation.findUnique({
          where: { controlId: control.id },
          select: { status: true, description: true, updatedAt: true, updatedBy: { select: { name: true } } },
        });
        organizationStatus = implementation?.status;
        // A row nobody edited carries only the date a migration created it, which is not an update (as the register shows it).
        const edited = implementation !== null && implementation.updatedBy !== null;
        organization = {
          status: implementation?.status ?? "NOT_STARTED",
          description: implementation?.description ?? null,
          updatedOn: edited ? formatDate(implementation.updatedAt.toISOString()) : null,
          updatedByName: implementation?.updatedBy?.name ?? null,
        };
      }

      // First round (#319): the Frameworks that mark this Control, still mapped to it, as visible to this user.
      const marks = await tx.frameworkFirstRoundControl.findMany({ where: { controlId: control.id }, select: { frameworkId: true } });
      const mappedFrameworkIds = new Set(
        (await tx.controlMapping.findMany({ where: { controlId: control.id }, select: { requirement: { select: { frameworkId: true } } } })).map(
          (mapping) => mapping.requirement.frameworkId,
        ),
      );
      const firstRoundFor = marks
        .map((mark) => frameworkById.get(mark.frameworkId))
        .filter((framework): framework is NonNullable<typeof framework> => !!framework && mappedFrameworkIds.has(framework.id))
        .filter((framework) => framework.status === "PUBLISHED" || showDrafts)
        .map((framework) => ({ id: framework.id, label: frameworkLabel(framework), draft: framework.status === "DRAFT" }))
        .sort((a, b) => collator.compare(a.label, b.label));

      let systems: PageSystems | null = null;
      if (reachesSystems) {
        const classified = classifiedForApplicability(control, frameworkById);
        const all = await tx.system.findMany({
          select: {
            id: true,
            name: true,
            sensitivityLevel: true,
            integrityImpactLevel: true,
            availabilityImpactLevel: true,
            deploymentFacets: { select: { id: true } },
            frameworkScopes: { select: { id: true } },
            owner: { select: { name: true } },
            businessUnits: { select: { name: true } },
          },
        });
        const applying = all.filter((system) => controlAppliesToSystem(classified, system));
        const applyingIds = applying.map((system) => system.id);

        const visible =
          applyingIds.length === 0
            ? []
            : await tx.system.findMany({
                where: { ...(await visibleSystemsWhere(user, tx)), id: { in: applyingIds } },
                select: { id: true },
              });
        const visibleIds = new Set(visible.map((system) => system.id));

        const assessments =
          applyingIds.length === 0
            ? []
            : await tx.controlAssessment.findMany({
                where: { controlId: control.id, systemId: { in: applyingIds } },
                select: { systemId: true, status: true, assessedById: true },
              });
        const assessmentBySystem = new Map(assessments.map((assessment) => [assessment.systemId, assessment]));
        const providerSources = await loadProviderSources(applyingIds, [control.id], tx);

        const counts: Record<ControlAssessmentStatus, number> = { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, WAIVED: 0, NOT_APPLICABLE: 0 };
        const list: PageSystem[] = [];
        for (const system of applying) {
          const own = assessmentBySystem.get(system.id);
          const effective = resolveEffectiveStatus(
            own ? toOwnAssessment(own) : null,
            inheritanceSourcesFor(control, organizationStatus, providerSources.get(system.id)?.get(control.id)),
          );
          counts[effective.status] += 1;
          if (!visibleIds.has(system.id)) continue;
          list.push({
            id: system.id,
            name: system.name,
            ownerName: system.owner.name,
            businessUnits: system.businessUnits.map((unit) => unit.name).sort((a, b) => collator.compare(a, b)),
            status: effective.status,
            sourceLabel: effectiveSourceLabel(effective),
            sourceDetails: effectiveSourceDetails(effective),
            note: effectiveNote(effective),
          });
        }
        list.sort((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
        systems = { total: applying.length, counts, list };
      }

      return {
        userId: user.id,
        userName: user.name,
        canEdit: canEditControlLibrary(user),
        control: libraryRowOf(control, {
          frameworkById,
          baseFramework,
          orgStatus: organization?.status ?? null,
          systemCount: systems?.total ?? 0,
        }),
        firstRoundFor,
        organization,
        systems,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
