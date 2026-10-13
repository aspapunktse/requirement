import type { ControlApplicability, ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { frameworkLabel } from "@/lib/framework-label";

/** One Control Mapping on a Control Library row: the Requirement it satisfies and how far. */
export type ControlLibraryMapping = {
  id: string;
  coverage: "FULL" | "PARTIAL";
  requirementCode: string;
  requirementTitle: string;
  framework: { id: string; label: string };
  /** True for a mapping into a Draft Framework; only a user who can see Drafts ever gets one. */
  draft: boolean;
};

/** One row of the read-only Control Library (#169): plain data, safe to hand to a client component. */
export type ControlLibraryRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  applicability: ControlApplicability;
  question: string | null;
  intent: string | null;
  examples: string[];
  deploymentFacets: string[];
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  /** The Control Owner's name; null while unassigned. */
  ownerName: string | null;
  /**
   * The origin Framework of a Supplementary Control; null for a base Control, and also for a
   * Supplementary Control whose origin is a Draft the viewer can't see (as in `GET /api/controls`).
   */
  origin: { id: string; label: string; draft: boolean } | null;
  mappings: ControlLibraryMapping[];
};

/**
 * Every Control with what the read-only Control Library page shows (PRD 0001 F-CL, #169),
 * for `user`, in a constant number of queries however many Controls there are (the nested
 * include is a fixed set of statements, not one per Control).
 *
 * The Draft rule is the one `GET /api/controls` applies: `controlIncludeFor` leaves out
 * mappings into a Draft Framework for a user who can't see Drafts and `redactDraftOrigin`
 * hides a Draft origin Framework, so no Draft Framework's name is read at all.
 */
export async function loadControlLibrary(user: { role: UserRole }): Promise<ControlLibraryRow[]> {
  // One REPEATABLE READ snapshot: the include nests mappings -> requirement -> framework, and a
  // Requirement deleted between Prisma's statements would otherwise leave a mapping whose required
  // Requirement is gone and throw. Read-only, so there is nothing to retry.
  const controls = await prisma.$transaction(
    (tx) => tx.control.findMany({ orderBy: { code: "asc" }, include: controlIncludeFor(user) }),
    { isolationLevel: "RepeatableRead" },
  );

  return controls
    .map((control) => redactDraftOrigin(user, control))
    .map((control): ControlLibraryRow => {
      const origin = control.originFramework;
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
        deploymentFacets: control.deploymentFacets.map((facet) => facet.name).sort((a, b) => a.localeCompare(b)),
        minConfidentialityImpactLevel: control.minConfidentialityImpactLevel,
        minIntegrityImpactLevel: control.minIntegrityImpactLevel,
        minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
        ownerName: control.owner?.name ?? null,
        origin: origin
          ? { id: origin.id, label: frameworkLabel(origin), draft: origin.status === "DRAFT" }
          : null,
        mappings: control.mappings
          .map((mapping) => ({
            id: mapping.id,
            coverage: mapping.coverage,
            requirementCode: mapping.requirement.code,
            requirementTitle: mapping.requirement.title,
            framework: { id: mapping.requirement.framework.id, label: frameworkLabel(mapping.requirement.framework) },
            draft: mapping.requirement.framework.status === "DRAFT",
          }))
          .sort((a, b) =>
            `${a.framework.label}\u0000${a.requirementCode}`.localeCompare(
              `${b.framework.label}\u0000${b.requirementCode}`,
              undefined,
              { numeric: true },
            ),
          ),
      };
    });
}

/** Whether `user` gets the link to the Control Library editor: those who can author Controls. */
export function canEditControlLibrary(user: { role: UserRole }): boolean {
  return ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(user.role);
}
