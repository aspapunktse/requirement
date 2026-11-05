import type { ControlAssessmentStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roleLabel } from "@/app/home/role-label";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { canEditControlLibrary } from "@/lib/control-library";
import { frameworkLabel } from "@/lib/framework-label";
import { canSeeDraftFrameworks, controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { canBeControlOwner } from "@/lib/system-permissions";
import type { LibraryMapping, LibraryRow, LibrarySource, LibraryView } from "./library-types";

const collator = new Intl.Collator("en", { numeric: true });

/** The Framework columns the row builders read. */
export type FrameworkSummary = { id: string; name: string; version: string; status: "DRAFT" | "PUBLISHED"; isBase: boolean };

/** A Control read with `controlIncludeFor`, after `redactDraftOrigin`. */
export type ReadControl = Prisma.ControlGetPayload<{ include: ReturnType<typeof controlIncludeFor> }>;

/**
 * Where a Control comes from, as the library and the Control page show it. `control` has been through
 * `redactDraftOrigin`: a Supplementary Control whose Draft origin the viewer can't see reads as plain
 * "Supplementary" (decision of 2026-11-05 on #314). `baseFramework` is the base Framework the viewer can see.
 */
export function librarySourceOf(
  control: Pick<ReadControl, "originFrameworkId" | "originFramework">,
  frameworkById: Map<string, FrameworkSummary>,
  baseFramework: FrameworkSummary | undefined,
): LibrarySource {
  const origin = control.originFramework;
  const originIsBase = control.originFrameworkId !== null && frameworkById.get(control.originFrameworkId)?.isBase === true;
  if (control.originFrameworkId === null || originIsBase) {
    return { key: "base", label: baseFramework ? `Base · ${frameworkLabel(baseFramework)}` : "Base", kind: "base", draft: false };
  }
  if (origin) {
    return { key: `fw:${origin.id}`, label: `Supplementary · ${frameworkLabel(origin)}`, kind: "supplementary", draft: origin.status === "DRAFT" };
  }
  return { key: "sup", label: "Supplementary", kind: "supplementary", draft: false };
}

/** The Control Mappings `controlIncludeFor` let through, as rows in Framework then Requirement order. */
export function libraryMappingsOf(control: Pick<ReadControl, "mappings">): LibraryMapping[] {
  return control.mappings
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
}

/**
 * The Control shaped for `controlAppliesToSystem`: the Frameworks of its mappings with `isBase` filled in. Only
 * Published Frameworks count there, so the mappings a Draft-blind viewer doesn't get change nothing.
 */
export function classifiedForApplicability(control: ReadControl, frameworkById: Map<string, FrameworkSummary>) {
  return {
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
  };
}

/** One Control as a library row; the caller decides the Organization status and the number of Systems. */
export function libraryRowOf(
  control: ReadControl,
  parts: { frameworkById: Map<string, FrameworkSummary>; baseFramework: FrameworkSummary | undefined; orgStatus: ControlAssessmentStatus | null; systemCount: number },
): LibraryRow {
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
    source: librarySourceOf(control, parts.frameworkById, parts.baseFramework),
    orgStatus: parts.orgStatus,
    systemCount: parts.systemCount,
    mappings: libraryMappingsOf(control),
  };
}

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
          const hasOrganizationStatus = control.applicability !== "PER_SYSTEM";
          const classified = control.applicability !== "ORGANIZATIONAL" ? classifiedForApplicability(control, frameworkById) : null;
          return libraryRowOf(control, {
            frameworkById,
            baseFramework,
            orgStatus: hasOrganizationStatus ? (statusByControl.get(control.id) ?? "NOT_STARTED") : null,
            systemCount: classified ? systems.filter((system) => controlAppliesToSystem(classified, system)).length : 0,
          });
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
