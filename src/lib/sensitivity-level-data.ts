import { prisma } from "@/lib/prisma";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

/** The five Sensitivity Levels in order, 1 Public first. They come from a migration, so every database has them. */
export async function listSensitivityLevels(
  client: { sensitivityLevel: typeof prisma.sensitivityLevel } = prisma,
): Promise<SensitivityLevelInfo[]> {
  return client.sensitivityLevel.findMany({
    orderBy: { level: "asc" },
    select: { level: true, label: true, description: true, textColor: true, backgroundColor: true },
  });
}
