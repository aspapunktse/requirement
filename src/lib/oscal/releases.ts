/**
 * OSCAL Releases (#453, ADR 0018): a System's OSCAL Package as of one moment, stored and never changed. `createOscalRelease` is
 * the one way to make one; the manual route calls it, and the audit-close trigger of #454 will too. There is no update or delete.
 *
 * A release is the live package built with `metadata.version` = its number (1, 2, 3 ... per System) and every earlier release in
 * `metadata.revisions`, zipped together with `manifest.json`: the SHA-256 of each document in the zip, and the SHA-256 of each
 * evidence file the SSP references. Evidence files themselves are not copied (product owner, #453).
 */
import { createHash } from "node:crypto";
import { Prisma, type OnboardingStatus, type OscalReleaseTrigger } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { logChangeEvent } from "@/lib/change-events";
import { buildOscalPackage, loadOscalSnapshot, type OscalSnapshot } from "@/lib/oscal/package-builder";
import { jsonBytes, packageFileBytes, zipFiles } from "@/lib/oscal/package-zip";

export const MANIFEST_FILE = "manifest.json";

export type OscalReleaseManifest = {
  /** The release number, as `metadata.version` of each document. */
  release: number;
  /** SHA-256 (hex) of every other file in the zip. */
  files: { name: string; sha256: string }[];
  /** Each evidence file (a DOCUMENT Evidence record with a stored file) the SSP references, by hash only. `sha256` is null for a file uploaded before digests were recorded. */
  evidence: { title: string; fileName: string; sha256: string | null }[];
};

/** What lists and pages show of a release (never its bytes). */
export type OscalReleaseSummary = {
  id: string;
  systemId: string;
  number: number;
  trigger: OscalReleaseTrigger;
  internalAuditId: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string } | null;
  sha256: string;
};

export type CreateOscalReleaseResult =
  | { kind: "ok"; release: OscalReleaseSummary }
  | { kind: "not-found" }
  | { kind: "closed"; status: OnboardingStatus };

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** The Evidence files the SSP references: DOCUMENT Evidence with a stored file, on Controls applicable to the System, in the SSP's order. */
function evidenceFiles(snapshot: OscalSnapshot): OscalReleaseManifest["evidence"] {
  const applicable = new Set(snapshot.applicableControlIds);
  const byControl = new Map(snapshot.assessments.map((a) => [a.controlId, a]));
  return snapshot.controls
    .filter((c) => applicable.has(c.id))
    .flatMap((c) => byControl.get(c.id)?.evidenceItems ?? [])
    .flatMap((e) => (e.kind === "DOCUMENT" && e.document?.file ? [{ title: e.title?.trim() || e.url || "Evidence", fileName: e.document.file.fileName, sha256: e.document.file.sha256 }] : []));
}

const SELECT_SUMMARY = {
  id: true,
  systemId: true,
  number: true,
  trigger: true,
  internalAuditId: true,
  createdAt: true,
  sha256: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.OscalReleaseSelect;

async function createIn(tx: Prisma.TransactionClient, input: CreateOscalReleaseInput): Promise<CreateOscalReleaseResult> {
  // Makers of the same System's release queue here (a lock on the System id, released at commit); the unique index on
  // (systemId, number) is the backstop when the snapshot of a RepeatableRead transaction was taken before the lock was won.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"oscal-release:" + input.systemId}, 0))`;
  const actor = await tx.user.findUnique({ where: { id: input.actorId }, select: { id: true, role: true } });
  if (!actor) throw new Error("createOscalRelease: unknown actor");
  // The caller decided who may make a release; the actor is recorded as the exporter and the creator.
  const snapshot = await loadOscalSnapshot(tx, input.systemId, actor, { skipVisibility: true });
  if (snapshot === null) return { kind: "not-found" };
  if ("closed" in snapshot) return { kind: "closed", status: snapshot.closed };

  const earlier = await tx.oscalRelease.findMany({ where: { systemId: input.systemId }, select: { number: true, createdAt: true }, orderBy: { number: "asc" } });
  const number = (earlier.at(-1)?.number ?? 0) + 1;
  const now = new Date();
  const pkg = buildOscalPackage(snapshot, now, undefined, {
    version: String(number),
    published: now,
    previous: earlier.map((r) => ({ version: String(r.number), published: r.createdAt, lastModified: r.createdAt })),
  });

  const documents = packageFileBytes(pkg);
  const manifest: OscalReleaseManifest = {
    release: number,
    files: Object.entries(documents).map(([name, bytes]) => ({ name, sha256: sha256Hex(bytes) })),
    evidence: evidenceFiles(snapshot),
  };
  const zip = zipFiles({ ...documents, [MANIFEST_FILE]: jsonBytes(manifest) });

  const created = await tx.oscalRelease.create({
    data: {
      systemId: input.systemId,
      number,
      trigger: input.trigger,
      internalAuditId: input.internalAuditId ?? null,
      createdAt: now,
      createdById: actor.id,
      data: new Uint8Array(zip),
      sha256: sha256Hex(zip),
      manifest,
    },
    select: SELECT_SUMMARY,
  });
  await logChangeEvent(
    input.systemId,
    "OSCAL_RELEASE_MADE",
    `OSCAL Release ${number} made (${input.trigger === "MANUAL" ? "by hand" : "when an Internal Audit closed"})`,
    actor.id,
    tx,
  );
  return { kind: "ok", release: created };
}

export type CreateOscalReleaseInput = {
  systemId: string;
  actorId: string;
  trigger: OscalReleaseTrigger;
  /** The Internal Audit whose closing made the release (#454). */
  internalAuditId?: string | null;
};

/**
 * Makes the System's next OSCAL Release: loads one snapshot, builds the package at version N with the earlier releases in
 * `revisions`, adds `manifest.json`, stores the zip and writes an `OSCAL_RELEASE_MADE` Change Event, all in one transaction.
 * Who may make one is the caller's check (the route: the System's owner or an Admin); this does not check visibility. A closed
 * System (Rejected or Not selected) makes none.
 *
 * Pass `tx` to join the caller's transaction (the audit close of #454); its isolation level is the caller's, so a concurrent
 * maker of the same System's release either waits on the lock or hits the unique index and the caller's transaction fails.
 * Without `tx` it runs its own RepeatableRead transaction and retries a few times when another release took the number.
 */
export async function createOscalRelease(input: CreateOscalReleaseInput, tx?: Prisma.TransactionClient): Promise<CreateOscalReleaseResult> {
  if (tx) return createIn(tx, input);
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction((t) => createIn(t, input), READ_SNAPSHOT);
    } catch (error) {
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
      if (!raced || attempt >= 5) throw error;
    }
  }
}

/** The System's releases, newest first, without their bytes. */
export function listOscalReleases(systemId: string): Promise<OscalReleaseSummary[]> {
  return prisma.oscalRelease.findMany({ where: { systemId }, select: SELECT_SUMMARY, orderBy: { number: "desc" } });
}
