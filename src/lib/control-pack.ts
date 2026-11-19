import { z } from "zod";

/**
 * Control Packs (#394): the shapes and validation shared by the routes, the pages and the planner. Prisma-free.
 * Who may read and write them is in `internal-audit-rules.ts`. A pack is curation, not compliance evidence, so
 * nothing here writes a Change Event.
 */

export const MAX_CONTROL_PACK_NAME_LENGTH = 80;
export const MAX_CONTROL_PACK_NOTE_LENGTH = 200;
export const MAX_CONTROLS_PER_PACK = 500;

export type ControlPackRow = {
  id: string;
  name: string;
  note: string;
  /** The pack's Controls that still exist, in code order. A deleted Control has left the pack. */
  controlIds: string[];
};

const name = z
  .string({ error: "Give the Control Pack a name." })
  .trim()
  .min(1, "Give the Control Pack a name.")
  .max(MAX_CONTROL_PACK_NAME_LENGTH, `The name can be at most ${MAX_CONTROL_PACK_NAME_LENGTH} characters.`);

const note = z
  .string({ error: "The note must be text." })
  .trim()
  .max(MAX_CONTROL_PACK_NOTE_LENGTH, `The note can be at most ${MAX_CONTROL_PACK_NOTE_LENGTH} characters.`);

const controlIds = z
  .array(z.string({ error: "Choose Controls from the list." }).min(1, "Choose Controls from the list."), { error: "Choose Controls from the list." })
  .max(MAX_CONTROLS_PER_PACK, `A Control Pack holds at most ${MAX_CONTROLS_PER_PACK} Controls.`)
  .transform((ids) => [...new Set(ids)]);

export const createControlPackSchema = z.object({
  name,
  note: note.optional().default(""),
  controlIds: controlIds.optional().default([]),
});

/** Every field optional; `controlIds`, when sent, is the whole new list. */
export const updateControlPackSchema = z
  .object({ name: name.optional(), note: note.optional(), controlIds: controlIds.optional() })
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");

export const duplicateNameMessage = (existing: string) => `A Control Pack named "${existing}" already exists.`;
