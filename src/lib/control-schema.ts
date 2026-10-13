import { z } from "zod";

/**
 * The fields of a new Control, without the cross-field rule below. Exported so
 * the Framework import (`framework-import-schema.ts`) can extend it with the
 * scoping fields and share the same field rules as `POST /api/controls`.
 */
export const controlFieldsSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  mandatory: z.boolean().optional(),
  applicability: z.enum(["ORGANIZATIONAL", "PER_SYSTEM", "BOTH"]),
  question: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  examples: z.array(z.string()).optional(),
});

/** A PER_SYSTEM or BOTH Control is assessed per System, so it needs a question to ask. */
export function hasRequiredQuestion(control: { applicability: string; question?: string | null }): boolean {
  return control.applicability === "ORGANIZATIONAL" || !!control.question;
}

export const QUESTION_REQUIRED_ISSUE = {
  message: "A PER_SYSTEM or BOTH Control needs a Self-Assessment Question",
  path: ["question"],
};

/**
 * The body of a new Control: shared by `POST /api/controls` and the
 * "create a Supplementary Control from a gap" endpoint so the two can't drift.
 */
export const createControlSchema = controlFieldsSchema.refine(hasRequiredQuestion, QUESTION_REQUIRED_ISSUE);

export const ORGANIZATIONAL_SCOPING_ERROR = "ORGANIZATIONAL controls cannot be scoped to Deployment Facets or Impact Level";

/** An ORGANIZATIONAL Control is never assessed per System, so it can't carry Deployment Facets or Impact Level thresholds. */
export function isScopedOrganizationalControl(
  applicability: string,
  scoping: {
    deploymentFacetCount?: number;
    minConfidentialityImpactLevel?: string | null;
    minIntegrityImpactLevel?: string | null;
    minAvailabilityImpactLevel?: string | null;
  },
): boolean {
  return (
    applicability === "ORGANIZATIONAL" &&
    ((scoping.deploymentFacetCount ?? 0) > 0 ||
      scoping.minConfidentialityImpactLevel != null ||
      scoping.minIntegrityImpactLevel != null ||
      scoping.minAvailabilityImpactLevel != null)
  );
}
