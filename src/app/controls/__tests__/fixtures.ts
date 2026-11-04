import type { LibraryRow, LibraryView } from "../library-types";

/** Rows for the Control Library's unit and component tests: plain data, no database. */

export function libraryRow(code: string, over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: `id-${code}`,
    code,
    title: `Title of ${code}`,
    description: `Description of ${code}`,
    category: "A.5 Organizational controls",
    mandatory: true,
    applicability: "ORGANIZATIONAL",
    question: null,
    intent: null,
    examples: [],
    deploymentFacets: [],
    minSensitivityLevel: null,
    minSensitivityLabel: null,
    minIntegrityImpactLevel: null,
    minAvailabilityImpactLevel: null,
    ownerId: null,
    ownerName: null,
    source: { key: "base", label: "Base · ISO/IEC 27001:2022", kind: "base", draft: false },
    orgStatus: "NOT_STARTED",
    systemCount: 0,
    mappings: [mapping(`R-${code}`, "FULL")],
    ...over,
  };
}

export function mapping(requirementCode: string, coverage: "FULL" | "PARTIAL", over: Partial<LibraryRow["mappings"][number]> = {}) {
  return {
    id: `m-${requirementCode}`,
    coverage,
    requirementCode,
    requirementTitle: `Requirement ${requirementCode}`,
    framework: { id: "fw-iso", label: "ISO/IEC 27001:2022" },
    draft: false,
    ...over,
  };
}

export const OLIVE = "u-olive";
export const PAT = "u-pat";
export const olive = { ownerId: OLIVE, ownerName: "Olive Owner" };
export const pat = { ownerId: PAT, ownerName: "Pat Peer" };

export const CCM = { key: "fw:ccm", label: "Supplementary · CSA CCM:4.1", kind: "supplementary", draft: false } as const;

/**
 * Eight Controls, the user being Olive:
 *   A.5.1  Org, Olive, Fulfilled, 1 mapping            A.5.2  Org, Pat, In Progress, 2 mappings (one Partial)
 *   A.5.3  Both, nobody, Not Started, 4 Systems, Facet "Cloud", From Level 3, no mapping
 *   A.6.1  Org, Pat, Waived                            A.8.1  Per-System, Olive, 3 Systems, Facet "On-premises" and "Cloud"
 *   4.1    Org, Olive, Not Started, clause             CCM-1  Supplementary Both, Olive, Fulfilled, no mapping
 *   CCM-2  Supplementary with a hidden Draft origin ("Supplementary"), Pat, Not Applicable
 * Organizational and Both: 7 Controls; Fulfilled 2, In Progress 1, Not Started 2, Waived 1, Not Applicable 1.
 */
export const ROWS: LibraryRow[] = [
  libraryRow("A.5.1", { ...olive, orgStatus: "FULFILLED" }),
  libraryRow("A.5.2", { ...pat, orgStatus: "IN_PROGRESS", mappings: [mapping("R-A52-1", "FULL"), mapping("R-A52-2", "PARTIAL", { framework: { id: "fw-ccm", label: "CSA CCM:4.1" } })] }),
  libraryRow("A.5.3", {
    applicability: "BOTH",
    systemCount: 4,
    deploymentFacets: ["Cloud"],
    minSensitivityLevel: 3,
    minSensitivityLabel: "Sensitive",
    minIntegrityImpactLevel: "HIGH",
    mappings: [],
  }),
  libraryRow("A.6.1", { ...pat, category: "A.6 People controls", orgStatus: "WAIVED" }),
  libraryRow("A.8.1", { ...olive, applicability: "PER_SYSTEM", category: "A.8 Technological controls", orgStatus: null, systemCount: 3, deploymentFacets: ["Cloud", "On-premises"] }),
  libraryRow("4.1", { ...olive, category: "4 Context of the organization" }),
  libraryRow("CCM-1", { ...olive, applicability: "BOTH", category: "A.8 Technological controls", orgStatus: "FULFILLED", systemCount: 2, source: CCM, mappings: [] }),
  libraryRow("CCM-2", { ...pat, category: "A.8 Technological controls", orgStatus: "NOT_APPLICABLE", source: { key: "sup", label: "Supplementary", kind: "supplementary", draft: false } }),
];

export function libraryView(over: Partial<LibraryView> = {}): LibraryView {
  return { userId: OLIVE, userName: "Olive Owner", role: "SYSTEM_OWNER", roleLabel: "System Owner", canEdit: false, owners: [], rows: ROWS, ...over };
}
