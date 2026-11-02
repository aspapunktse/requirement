import { prisma } from "@/lib/prisma";
import { checkSensitivityLevelEdit, sensitivityLevelEditSchema, type SensitivityLevelInfo } from "@/lib/sensitivity-level";

/** The five Sensitivity Levels in order, 1 Public first. They come from a migration, so every database has them. */
export async function listSensitivityLevels(
  client: { sensitivityLevel: typeof prisma.sensitivityLevel } = prisma,
): Promise<SensitivityLevelInfo[]> {
  return client.sensitivityLevel.findMany({
    orderBy: { level: "asc" },
    select: { level: true, label: true, description: true, textColor: true, backgroundColor: true },
  });
}

export type SaveSensitivityLevelResult =
  | { ok: true; level: SensitivityLevelInfo }
  | { ok: false; status: 400 | 404; errors: string[] };

/**
 * Saves one level's label, description and colours (#291). Locks the five rows first (FOR NO KEY UPDATE, so System and Control writes that reference a level are not blocked), so two Admins saving at once
 * cannot both pass the unique-label check, then validates against the levels as stored. Not a Change Event.
 * Every query inside the transaction uses `tx`.
 */
export async function saveSensitivityLevel(input: unknown): Promise<SaveSensitivityLevelResult> {
  const parsed = sensitivityLevelEditSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, errors: parsed.error.issues.map((issue) => issue.message) };
  const edit = parsed.data;

  return prisma.$transaction(async (tx): Promise<SaveSensitivityLevelResult> => {
    await tx.$queryRaw`SELECT "level" FROM "SensitivityLevel" ORDER BY "level" FOR NO KEY UPDATE`;
    const all = await listSensitivityLevels(tx);
    if (!all.some((row) => row.level === edit.level)) return { ok: false, status: 404, errors: ["No such Sensitivity Level."] };
    const problems = checkSensitivityLevelEdit(edit, all);
    if (problems.length) return { ok: false, status: 400, errors: problems };
    const level = await tx.sensitivityLevel.update({
      where: { level: edit.level },
      data: { label: edit.label, description: edit.description, textColor: edit.textColor, backgroundColor: edit.backgroundColor },
      select: { level: true, label: true, description: true, textColor: true, backgroundColor: true },
    });
    return { ok: true, level };
  });
}
