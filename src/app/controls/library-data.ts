import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { canEditControlLibrary } from "@/lib/control-library";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { canBeControlOwner } from "@/lib/system-permissions";
import type { LibraryMapping, LibraryRow, LibrarySource, LibraryView } from "./library-types";

const collator = new Intl.Collator("en", { numeric: true });

/**
 * Everything the Control Library page shows for the acting user (design proposal A "Workbench", issue #313):
 * every Control, base and Supplementary, with its scoping, Control Owner, the Requirements it satisfies, the
 * Organization status of an Organizational or Both Control, and how many Systems a Per-System or Both Control
 * applies to. For a Compliance Manager or an Admin it also carries the Users who may be made Control Owner.
 *
 * The Draft rule is the one `GET /api/controls` applies: `controlIncludeFor` leaves out mappings into a Draft
 * Framework for a user who can't see Drafts and `redactDraftOrigin` hides a Draft origin, so no Draft Framework's
 * name is read out at all. A Supplementary Control with a hidden origin reads as plain "Supplementary".
 *
 * One RepeatableRead transaction, every query on `tx`, and a constant number of queries however many Controls
 * and Systems there are (the nested include is a fixed set of statements): a Requirement deleted between the
 * statements of the nested read would otherwise leave a mapping whose Requirement is gone (#279).
 */
export async function loadControlLibraryView(user: { id: string; name: string; role: UserRole }): Promise<LibraryView> {
  const showDrafts = canSeeDraftFrameworks(user);
  const canEdit = canEditControlLibrary(user);

  return prisma.$transaction(
    async (tx) => {
      const controls = await tx.control.findMany({ orderBy: { code: "asc" }, include: controlIncludeFor(user) });
      const frameworks = await tx.framework.findMany({ select: { id: true, name: true, version: true, status: true, isBase: true } });
      const implementations = await tx.organizationControlImplementation.findMany({ select: { controlId: true, status: true } });
      const systems = await tx.system.findMany({
        select: {
          id: true,
          sensitivityLevel: true,
          integrityImpactLevel: true,
          availabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          frameworkScopes: { select: { id: true } },
        },
      });
      const users = canEdit ? await tx.user.findMany({ select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }) : [];

      const frameworkById = new Map(frameworks.map((framework) => [framework.id, framework]));
      const baseFramework = frameworks.find((framework) => framework.isBase && (framework.status === "PUBLISHED" || showDrafts));
      const statusByControl = new Map(implementations.map((implementation) => [implementation.controlId, implementation.status]));

      const rows = controls
        .map((control) => redactDraftOrigin(user, control))
        .map((control): LibraryRow => {
          const origin = control.originFramework;
          const originIsBase = control.originFrameworkId !== null && frameworkById.get(control.originFrameworkId)?.isBase === true;
          let source: LibrarySource;
          if (control.originFrameworkId === null || originIsBase) {
            source = {
              key: "base",
              label: baseFramework ? `Base · ${frameworkLabel(baseFramework)}` : "Base",
              kind: "base",
              draft: false,
            };
          } else if (origin) {
            source = {
              key: `fw:${origin.id}`,
              label: `Supplementary · ${frameworkLabel(origin)}`,
              kind: "supplementary",
              draft: origin.status === "DRAFT",
            };
          } else {
            source = { key: "sup", label: "Supplementary", kind: "supplementary", draft: false };
          }

          const mappings: LibraryMapping[] = control.mappings
            .map((mapping) => ({
              id: mapping.id,
              coverage: mapping.coverage,
              requirementCode: mapping.requirement.code,
              requirementTitle: mapping.requirement.title,
              framework: { id: mapping.requirement.framework.id, label: frameworkLabel(mapping.requirement.framework) },
              draft: mapping.requirement.framework.status === "DRAFT",
            }))
            .sort(
              (a, b) =>
                collator.compare(a.framework.label, b.framework.label) ||
                collator.compare(a.requirementCode, b.requirementCode) ||
                (a.id < b.id ? -1 : 1),
            );

          const hasOrganizationStatus = control.applicability !== "PER_SYSTEM";
          const reachesSystems = control.applicability !== "ORGANIZATIONAL";
          // controlAppliesToSystem reads the Frameworks of the mappings: only Published ones count, so the mappings
          // a Draft-blind viewer doesn't get change nothing. `isBase` comes from the Frameworks read above.
          const classified = reachesSystems
            ? {
                ...control,
                mappings: control.mappings.map((mapping) => ({
                  requirement: {
                    framework: {
                      id: mapping.requirement.framework.id,
                      status: mapping.requirement.framework.status,
                      isBase: frameworkById.get(mapping.requirement.framework.id)?.isBase === true,
                    },
                  },
                })),
              }
            : null;

          return {
            id: control.id,
            code: control.code,
            title: control.title,
            description: control.description,
            category: control.category,
            mandatory: control.mandatory,
            applicability: control.applicability,
            question: control.question,
            intent: control.intent,
            examples: control.examples,
            deploymentFacets: control.deploymentFacets.map((facet) => facet.name).sort((a, b) => collator.compare(a, b)),
            minSensitivityLevel: control.minSensitivityLevel,
            minSensitivityLabel: control.minSensitivity?.label ?? null,
            minIntegrityImpactLevel: control.minIntegrityImpactLevel,
            minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
            ownerId: control.owner?.id ?? null,
            ownerName: control.owner?.name ?? null,
            source,
            orgStatus: hasOrganizationStatus ? (statusByControl.get(control.id) ?? "NOT_STARTED") : null,
            systemCount: classified ? systems.filter((system) => controlAppliesToSystem(classified, system)).length : 0,
            mappings,
          };
        });

      return {
        userId: user.id,
        userName: user.name,
        role: user.role,
        roleLabel: roleLabel(user.role),
        canEdit,
        owners: users.filter((candidate) => canBeControlOwner(candidate)).map(({ id, name }) => ({ id, name })),
        rows,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
