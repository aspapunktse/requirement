import { prisma } from "@/lib/prisma";
import { EVALUATION_TRACKS, type DocumentRequirementRow } from "@/lib/document-requirement";

export const DOCUMENT_REQUIREMENT_SELECT = { id: true, name: true, description: true, stage: true, tracks: true } as const;

/** One row as shown: Tracks in the fixed order (Self, Full) whatever order Postgres stored them in. */
export function toRow(row: DocumentRequirementRow): DocumentRequirementRow {
  return { ...row, tracks: EVALUATION_TRACKS.filter((track) => row.tracks.includes(track)) };
}

/** The whole catalogue, first documentation before second round and then by name. */
export async function listDocumentRequirements(client: { documentRequirement: typeof prisma.documentRequirement } = prisma): Promise<DocumentRequirementRow[]> {
  const rows = await client.documentRequirement.findMany({ select: DOCUMENT_REQUIREMENT_SELECT, orderBy: [{ stage: "asc" }, { name: "asc" }] });
  return rows.map(toRow);
}
