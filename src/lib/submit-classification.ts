import type { Prisma } from "@prisma/client";
import { floorSettingTypes, informationTypeFloor } from "@/lib/information-type-floor";

/** The refusal text of a submit (classic, or the first round of staged evaluation) for a System with no Sensitivity Level (ADR 0011). */
export const NO_SENSITIVITY_LEVEL =
  "Cannot submit: set the System's Sensitivity Level first. It decides which Controls apply, so the review needs it.";

/** The text when a System's level is below the highest of its Information Types (ADR 0012): names the types and the level to raise to. */
export async function belowInformationTypesMessage(
  db: Pick<Prisma.TransactionClient, "sensitivityLevel">,
  types: Parameters<typeof floorSettingTypes>[0],
): Promise<string> {
  const floor = informationTypeFloor(types)!;
  const row = await db.sensitivityLevel.findUnique({ where: { level: floor }, select: { label: true } });
  const label = row?.label ?? String(floor);
  const names = floorSettingTypes(types).map((type) => type.name).join(", ");
  return `Cannot submit: the System's Sensitivity Level is below its Information Types (${names} is ${label}). Raise the level to ${label} or higher first.`;
}
