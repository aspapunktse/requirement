import { z } from "zod";
import {
  controlFieldsSchema,
  hasRequiredQuestion,
  isScopedOrganizationalControl,
  ORGANIZATIONAL_SCOPING_ERROR,
  QUESTION_REQUIRED_ISSUE,
} from "./control-schema";

/**
 * The Framework import format (PRD 0001 F-IMP.1, #144): one JSON file per
 * Framework version, holding the Framework's metadata, the Supplementary
 * Controls it introduces and its Requirements with their Control Mappings.
 * This module is pure (no Prisma, no I/O) so a file can be checked without a
 * database; what needs the database (does a mapped Control exist?) is
 * `checkImportReferences`, which takes the existing codes as input. The format
 * is documented in `prisma/seed-data/frameworks/README.md`.
 *
 * Unknown keys are rejected, so a typo like `licencing` is a problem instead of
 * a setting that is silently ignored. An omitted optional field means "leave
 * as it is" on an existing row (and the default on a new one); write `null` to
 * clear a nullable one.
 */

const text = z.string().trim().min(1);
const impactLevel = z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]);

const supplementaryControlSchema = z
  .strictObject({
    ...controlFieldsSchema.shape,
    /** Deployment Facets by name; they must already exist (the loader never creates a Facet). */
    deploymentFacets: z.array(text).optional(),
    minConfidentialityImpactLevel: impactLevel.nullable().optional(),
    minIntegrityImpactLevel: impactLevel.nullable().optional(),
    minAvailabilityImpactLevel: impactLevel.nullable().optional(),
  })
  .refine(hasRequiredQuestion, QUESTION_REQUIRED_ISSUE)
  .refine(
    (control) =>
      !isScopedOrganizationalControl(control.applicability, {
        deploymentFacetCount: control.deploymentFacets?.length,
        minConfidentialityImpactLevel: control.minConfidentialityImpactLevel,
        minIntegrityImpactLevel: control.minIntegrityImpactLevel,
        minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
      }),
    { message: ORGANIZATIONAL_SCOPING_ERROR, path: ["applicability"] },
  );

const mappingSchema = z.strictObject({
  /** The Control's code: a base Control already in the database, or one of the file's Supplementary Controls. */
  control: text,
  coverage: z.enum(["FULL", "PARTIAL"]),
  rationale: text.nullable().optional(),
});

const requirementSchema = z.strictObject({
  code: text,
  section: text,
  title: text,
  text,
  mappings: z.array(mappingSchema).default([]),
});

const frameworkSchema = z.strictObject({
  name: text,
  version: text,
  description: z.string().nullable().optional(),
  /** The earlier version this Framework replaces, by name and version; it must already exist. */
  supersedes: z.strictObject({ name: text, version: text }).nullable().optional(),
  /** The enum spelling only; the PRD sketch's "paraphrase-only" is not accepted. */
  licensing: z.enum(["PARAPHRASE_ONLY", "QUOTABLE"]).optional(),
  strictComplianceRequired: z.boolean().optional(),
  /** Never creates or changes the base Framework: only accepted when it matches the existing base by name and version. */
  isBase: z.boolean().optional(),
});

export const frameworkImportSchema = z.strictObject({
  framework: frameworkSchema,
  supplementaryControls: z.array(supplementaryControlSchema).default([]),
  requirements: z.array(requirementSchema).default([]),
});

export type FrameworkImport = z.output<typeof frameworkImportSchema>;
export type ImportSupplementaryControl = FrameworkImport["supplementaryControls"][number];
export type ImportRequirement = FrameworkImport["requirements"][number];

export type ParseResult = { ok: true; data: FrameworkImport } | { ok: false; problems: string[] };

/** `requirements[2].mappings[0].coverage` from a zod issue path. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${String(part)}` : String(part)),
    "",
  );
}

/** Parses and checks a file's content: the shape, then duplicate codes. Needs no database. */
export function parseFrameworkImport(raw: unknown): ParseResult {
  const parsed = frameworkImportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => {
        const where = formatPath(issue.path);
        return where ? `${where}: ${issue.message}` : issue.message;
      }),
    };
  }

  const data = parsed.data;
  const problems: string[] = [];

  const seenControls = new Map<string, number>();
  data.supplementaryControls.forEach((control, index) => {
    const first = seenControls.get(control.code);
    if (first === undefined) seenControls.set(control.code, index);
    else {
      problems.push(
        `supplementaryControls[${index}]: duplicate Supplementary Control code "${control.code}" (first at supplementaryControls[${first}])`,
      );
    }
  });

  const seenRequirements = new Map<string, number>();
  data.requirements.forEach((requirement, index) => {
    const first = seenRequirements.get(requirement.code);
    if (first === undefined) seenRequirements.set(requirement.code, index);
    else {
      problems.push(
        `requirements[${index}]: duplicate Requirement code "${requirement.code}" (first at requirements[${first}])`,
      );
    }

    const seenMapped = new Map<string, number>();
    requirement.mappings.forEach((mapping, mappingIndex) => {
      const firstMapping = seenMapped.get(mapping.control);
      if (firstMapping === undefined) seenMapped.set(mapping.control, mappingIndex);
      else {
        problems.push(
          `requirements[${index}].mappings[${mappingIndex}]: Control "${mapping.control}" is mapped more than once in Requirement "${requirement.code}" (first at mappings[${firstMapping}])`,
        );
      }
    });
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, data };
}

export type KnownReferences = {
  /** Codes of the Controls that exist in the database. */
  controlCodes: ReadonlySet<string>;
  /** Names of the Deployment Facets that exist in the database. */
  facetNames: ReadonlySet<string>;
};

/**
 * The checks that need the database's contents, given as input: every mapping
 * must point at an existing Control or one of the file's Supplementary
 * Controls, and every Deployment Facet must exist.
 */
export function checkImportReferences(data: FrameworkImport, known: KnownReferences): string[] {
  const problems: string[] = [];
  const own = new Set(data.supplementaryControls.map((control) => control.code));

  data.supplementaryControls.forEach((control, index) => {
    for (const facet of control.deploymentFacets ?? []) {
      if (!known.facetNames.has(facet)) {
        problems.push(
          `supplementaryControls[${index}]: Deployment Facet "${facet}" does not exist (Supplementary Control "${control.code}")`,
        );
      }
    }
  });

  data.requirements.forEach((requirement, index) => {
    requirement.mappings.forEach((mapping, mappingIndex) => {
      if (!known.controlCodes.has(mapping.control) && !own.has(mapping.control)) {
        problems.push(
          `requirements[${index}].mappings[${mappingIndex}]: Control "${mapping.control}" (mapped from Requirement "${requirement.code}") does not exist and is not a Supplementary Control in this file`,
        );
      }
    });
  });

  return problems;
}
