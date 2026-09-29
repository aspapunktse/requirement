// Pure display helpers (no Prisma), safe to import from client components.

/** How a Framework is named in the UI: "ISO/IEC 27001:2022". */
export function frameworkLabel(framework: { name: string; version?: string }): string {
  return framework.version ? `${framework.name}:${framework.version}` : framework.name;
}

/** What a Control's admin row shows, derived from its Control Mappings. */
export type ControlMappingForLabel = {
  coverage: "FULL" | "PARTIAL";
  requirement: { code: string; framework: { name: string; version: string } };
};

/**
 * One entry per Control Mapping, e.g. "ISO/IEC 27001:2022 A.8.24" (with
 * "(partial)" appended for Partial Coverage), sorted by Framework then code.
 */
export function satisfiesEntries(mappings: ControlMappingForLabel[]): string[] {
  return mappings
    .map((m) => ({
      sort: `${frameworkLabel(m.requirement.framework)}\u0000${m.requirement.code}`,
      text: `${frameworkLabel(m.requirement.framework)} ${m.requirement.code}${m.coverage === "PARTIAL" ? " (partial)" : ""}`,
    }))
    .sort((a, b) => a.sort.localeCompare(b.sort, undefined, { numeric: true }))
    .map((e) => e.text);
}

/**
 * The read-only "Satisfies: ISO/IEC 27001:2022 A.8.24, …" line for a Control,
 * derived from its Control Mappings (there is no direct Framework tag on a
 * Control — ADR 0005). Null when the Control satisfies nothing.
 */
export function satisfiesLabel(mappings: ControlMappingForLabel[]): string | null {
  if (mappings.length === 0) return null;
  return `Satisfies: ${satisfiesEntries(mappings).join(", ")}`;
}
