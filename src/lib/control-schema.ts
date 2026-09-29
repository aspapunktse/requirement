import { z } from "zod";

/**
 * The body of a new Control: shared by `POST /api/controls` and the
 * "create a Supplementary Control from a gap" endpoint so the two can't drift.
 */
export const createControlSchema = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    category: z.string().min(1),
    mandatory: z.boolean().optional(),
    applicability: z.enum(["ORGANIZATIONAL", "PER_SYSTEM", "BOTH"]),
    question: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
  })
  .refine((data) => data.applicability === "ORGANIZATIONAL" || !!data.question, {
    message: "A PER_SYSTEM or BOTH Control needs a Self-Assessment Question",
    path: ["question"],
  });
