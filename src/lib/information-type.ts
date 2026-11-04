import type { UserRole } from "@prisma/client";
import { z } from "zod";
import { MAX_SENSITIVITY_LEVEL, MIN_SENSITIVITY_LEVEL } from "@/lib/sensitivity-level";

/**
 * Information Types (#303, ADR 0012): a catalogue of kinds of information, each with one Sensitivity Level.
 * Everyone signed in reads it; the Compliance Manager and an Admin curate it (create, rename, describe, change the
 * level, delete). Catalogue edits are not Change Events, and changing a type's level changes nothing on any System.
 */
export const ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

export function canCurateInformationTypes(user: { role: UserRole } | null | undefined): boolean {
  return !!user && ROLES_ALLOWED_TO_CURATE_INFORMATION_TYPES.includes(user.role);
}

export const MAX_INFORMATION_TYPE_NAME_LENGTH = 80;
export const MAX_INFORMATION_TYPE_DESCRIPTION_LENGTH = 300;

const name = z
  .string({ error: "Give the Information Type a name." })
  .trim()
  .min(1, "Give the Information Type a name.")
  .max(MAX_INFORMATION_TYPE_NAME_LENGTH, `The name can be at most ${MAX_INFORMATION_TYPE_NAME_LENGTH} characters.`);

/** An empty description is the same as none. */
const description = z
  .string()
  .trim()
  .max(MAX_INFORMATION_TYPE_DESCRIPTION_LENGTH, `The description can be at most ${MAX_INFORMATION_TYPE_DESCRIPTION_LENGTH} characters.`)
  .nullable()
  .transform((value) => (value ? value : null));

const level = z
  .number({ error: "Choose a Sensitivity Level." })
  .int("Choose a Sensitivity Level.")
  .min(MIN_SENSITIVITY_LEVEL, "Choose a Sensitivity Level.")
  .max(MAX_SENSITIVITY_LEVEL, "Choose a Sensitivity Level.");

/** The Frameworks the type suggests (ADR 0013): the whole list, replacing the earlier one. Unknown ids and the base Framework are refused by the route. */
const frameworkIds = z
  .array(z.string({ error: "Choose Frameworks from the list." }).min(1, "Choose Frameworks from the list."), { error: "Choose Frameworks from the list." })
  .max(200, "Choose at most 200 Frameworks.")
  .transform((ids) => [...new Set(ids)]);

export const createInformationTypeSchema = z.object({
  name,
  description: description.optional().default(null),
  sensitivityLevel: level,
  frameworkIds: frameworkIds.optional().default([]),
});

export const updateInformationTypeSchema = z
  .object({ name: name.optional(), description: description.optional(), sensitivityLevel: level.optional(), frameworkIds: frameworkIds.optional() })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined || data.sensitivityLevel !== undefined || data.frameworkIds !== undefined,
    { message: "Provide at least one of name, description, sensitivityLevel or frameworkIds to update." },
  );

export const BASE_FRAMEWORK_NOT_SUGGESTED = "The base Framework is always in every System's Framework Scope and can't be suggested.";
export const UNKNOWN_SUGGESTED_FRAMEWORKS = "One or more Framework ids do not exist";

/** One Information Type as the page and the API show it. */
export type InformationTypeRow = {
  id: string;
  name: string;
  description: string | null;
  sensitivityLevel: number;
  /** How many Systems declare it, whether or not the viewer may see them. */
  systemCount: number;
  /** The Frameworks it suggests (ADR 0013), by name. A Draft one only for a viewer who may see Drafts; it suggests nothing until Published. */
  suggestedFrameworks: SuggestedFrameworkRef[];
};

export type SuggestedFrameworkRef = { id: string; name: string; version: string; status: "DRAFT" | "PUBLISHED" };

/** A System that declares a type, as the drawer lists it: only Systems the viewer may see. */
export type DeclaringSystem = { id: string; name: string; vendor: string | null; sensitivityLevel: number | null };

export const IN_USE_MESSAGE = (count: number) =>
  `This Information Type is declared by ${count} System${count === 1 ? "" : "s"} and can't be deleted. Remove it from ${count === 1 ? "that System" : "those Systems"} first.`;
