/**
 * The floor an Information Type sets for a System's Sensitivity Level (ADR 0012), pure and Prisma-free so the
 * server (the System route, submit, the System page) and the browser (the pickers) apply the same rule. The server is
 * the authority; the browser uses this only to show what the server will accept.
 *
 * The rule, in one place:
 * - the floor is the highest Sensitivity Level among the System's Information Types; no types, no floor;
 * - a level meets the floor when it is a level and at or above it (higher is fine);
 * - a System with no level declared never meets a floor, but is not "below its Information Types": that flag is for
 *   a System whose level was declared and has since been outrun by a curator raising a type.
 */

/** An Information Type as the floor rule needs it. */
export type FloorType = { id: string; name: string; sensitivityLevel: number };

/** The highest level among `types`, or null when there are none. */
export function informationTypeFloor(types: readonly Pick<FloorType, "sensitivityLevel">[]): number | null {
  return types.length === 0 ? null : Math.max(...types.map((type) => type.sensitivityLevel));
}

/** The types that set the floor, highest level first, then by name: the ones to name when a level is too low. */
export function floorSettingTypes<T extends FloorType>(types: readonly T[]): T[] {
  const floor = informationTypeFloor(types);
  return types.filter((type) => type.sensitivityLevel === floor).sort((a, b) => a.name.localeCompare(b.name));
}

/** Does `level` meet the floor of `types`? True with no types; false for no level when there are types. */
export function meetsInformationTypeFloor(level: number | null, types: readonly FloorType[]): boolean {
  const floor = informationTypeFloor(types);
  if (floor === null) return true;
  return level !== null && level >= floor;
}

/**
 * "Below its Information Types" (CONTEXT.md): a level is declared and is lower than the highest level among the
 * types. A System with no level is not below them; it simply has no level, which has its own refusal.
 */
export function isBelowInformationTypes(level: number | null, types: readonly FloorType[]): boolean {
  return level !== null && !meetsInformationTypeFloor(level, types);
}

/**
 * The type to name when a level is too low: among the types that set the floor, the one ticked last if it is one of
 * them, else the first by name. Null with no types.
 */
export function floorCulprit<T extends FloorType>(types: readonly T[], lastAddedId?: string | null): T | null {
  const setters = floorSettingTypes(types);
  return setters.find((type) => type.id === lastAddedId) ?? setters[0] ?? null;
}
