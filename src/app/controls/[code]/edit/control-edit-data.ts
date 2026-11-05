import type { ControlApplicability, ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { frameworkLabel } from "@/lib/framework-label";
import { listSensitivityLevels } from "@/lib/sensitivity-level-data";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";
import { canBeControlOwner } from "@/lib/system-permissions";

const collator = new Intl.Collator("en", { numeric: true });

/** What the single-Control editor starts from (issue #314, decision 3). Plain data, so it crosses to the client as props. */
export type ControlEditView = {
  control: {
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
    deploymentFacetIds: string[];
    minSensitivityLevel: number | null;
    minIntegrityImpactLevel: ImpactLevel | null;
    minAvailabilityImpactLevel: ImpactLevel | null;
    ownerId: string | null;
    ownerName: string | null;
  };
  /** Every Deployment Facet, for the scoping checkboxes. */
  deploymentFacets: { id: string; name: string }[];
  /** The Users who may be made Control Owner (not a strictly read-only role). */
  owners: { id: string; name: string }[];
  sensitivityLevels: SensitivityLevelInfo[];
  /** The Frameworks this Control is mapped into (the Control Mappings are edited on their own editor). */
  mappedFrameworks: { id: string; label: string }[];
};

/**
 * The Control with this code and the choices its editor offers, or null when no Control has the code. Only called
 * for a user who may edit Controls (the page checks the role first), so Draft Frameworks are not hidden here. One
 * RepeatableRead transaction with every query on `tx`.
 */
export async function loadControlEditView(code: string): Promise<ControlEditView | null> {
  return prisma.$transaction(
    async (tx) => {
      const control = await tx.control.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          category: true,
          mandatory: true,
          applicability: true,
          question: true,
          intent: true,
          examples: true,
          deploymentFacets: { select: { id: true } },
          minSensitivityLevel: true,
          minIntegrityImpactLevel: true,
          minAvailabilityImpactLevel: true,
          owner: { select: { id: true, name: true } },
        },
      });
      if (!control) return null;

      const deploymentFacets = await tx.deploymentFacet.findMany({ select: { id: true, name: true } });
      const users = await tx.user.findMany({ select: { id: true, name: true, role: true } });
      const sensitivityLevels = await listSensitivityLevels(tx);
      const mappings = await tx.controlMapping.findMany({
        where: { controlId: control.id },
        select: { requirement: { select: { framework: { select: { id: true, name: true, version: true } } } } },
      });
      const frameworks = new Map(mappings.map((mapping) => [mapping.requirement.framework.id, mapping.requirement.framework]));

      return {
        control: {
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
          deploymentFacetIds: control.deploymentFacets.map((facet) => facet.id),
          minSensitivityLevel: control.minSensitivityLevel,
          minIntegrityImpactLevel: control.minIntegrityImpactLevel,
          minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
          ownerId: control.owner?.id ?? null,
          ownerName: control.owner?.name ?? null,
        },
        deploymentFacets: deploymentFacets.sort((a, b) => collator.compare(a.name, b.name)),
        owners: users
          .filter((candidate) => canBeControlOwner(candidate))
          .map(({ id, name }) => ({ id, name }))
          .sort((a, b) => collator.compare(a.name, b.name)),
        sensitivityLevels,
        mappedFrameworks: [...frameworks.values()]
          .map((framework) => ({ id: framework.id, label: frameworkLabel(framework) }))
          .sort((a, b) => collator.compare(a.label, b.label)),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
