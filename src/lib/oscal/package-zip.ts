import { strToU8, zipSync } from "fflate";
import { PACKAGE_FILES, type OscalPackage } from "@/lib/oscal/package-builder";

/** A JSON document as the bytes the package carries: two-space indent and a trailing newline. */
export const jsonBytes = (doc: unknown): Uint8Array => strToU8(JSON.stringify(doc, null, 2) + "\n");

/** The three documents of a package as files by name, in the order the zip lists them. */
export function packageFileBytes(pkg: OscalPackage): Record<string, Uint8Array> {
  return {
    [PACKAGE_FILES.catalog]: jsonBytes(pkg.catalog),
    [PACKAGE_FILES.profile]: jsonBytes(pkg.profile),
    [PACKAGE_FILES.ssp]: jsonBytes(pkg.ssp),
  };
}

/** A zip of `files`. A release adds `manifest.json` to the three documents, so the live download and a release share this. */
export function zipFiles(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

const slugOf = (systemName: string) => systemName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "system";

/** `oscal-package-<system>-<yyyy-mm-dd>.zip` for the live download; `oscal-release-<n>-<system>-<yyyy-mm-dd>.zip` for a stored release. */
export function packageFileName(systemName: string, date: Date, releaseNumber?: number): string {
  const day = date.toISOString().slice(0, 10);
  return releaseNumber === undefined ? `oscal-package-${slugOf(systemName)}-${day}.zip` : `oscal-release-${releaseNumber}-${slugOf(systemName)}-${day}.zip`;
}
