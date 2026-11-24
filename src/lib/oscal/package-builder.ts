/**
 * The OSCAL Package builder (#442, PRD #440, ADR 0017). Two halves:
 *
 * - `loadOscalPackage(systemId, user)` reads one consistent snapshot (a single RepeatableRead transaction, every query on `tx`)
 *   and applies the System visibility rule; it is the only part that knows the data model.
 * - `buildOscalPackage(snapshot, now)` turns plain rows into the three documents (Catalog, OSCAL Profile, System Security Plan)
 *   as plain objects. Pure apart from `randomUUID` for the document UUIDs, which a caller can replace.
 *
 * This first slice has no inheritance (#443): each requirement carries the System's OWN Control Assessment status.
 * People do not appear yet (#444); when they do, by name and role only, never by email.
 */
import { randomUUID } from "node:crypto";
import type { ControlAssessmentStatus, OnboardingStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { EFFECTIVE_SCOPE_SELECT, withEffectiveScope } from "@/lib/effective-framework-scope";
import { getApplicableControls } from "@/lib/control-assessments";
import { controlId, oscalUuid } from "@/lib/oscal/ids";
import appPackage from "../../../package.json";

export const OSCAL_VERSION = "1.2.3";
/**
 * Where the documents sit in the zip, and what they call each other (relative, no `./`). The validator's in-package href
 * convention (`PACKAGE_FILES` in validate.ts) is the same; it is not imported here because it pulls in ajv, a dev dependency.
 */
export const PACKAGE_FILES = { catalog: "catalog.json", profile: "profile.json", ssp: "ssp.json" } as const;
/** The URI the app's own props and its system identifier type live under. Chosen once; never change it. */
export const OSCAL_APP_NS = "https://requirement.example/ns/oscal";
export const NO_DESCRIPTION_TEXT = "No implementation description recorded.";
const PLACEHOLDER_BOUNDARY =
  "Placeholder: this boundary is not described yet. A later version generates it from the System's Deployment Facets, Data Locations and Provider dependencies.";


/** The rows the package is built from. */
export type OscalSnapshot = {
  system: {
    id: string;
    name: string;
    description: string | null;
    status: OnboardingStatus;
    informationTypes: { id: string; name: string; description: string | null; sensitivityLevel: number; sensitivityLabel: string }[];
  };
  /** Every Control in the Control Library. */
  controls: { id: string; code: string; title: string; description: string }[];
  /** The ids of the Controls applicable to the System (a subset of `controls`). */
  applicableControlIds: string[];
  /** The System's own Control Assessments. A Control without one reads as untouched Not Started. */
  assessments: { controlId: string; status: ControlAssessmentStatus; notes: string | null; evidence: string | null }[];
};

/** The three documents, as plain objects. */
export type OscalPackage = ReturnType<typeof buildOscalPackage>;

export type OscalPackageResult =
  | { kind: "ok"; system: { id: string; name: string }; pkg: OscalPackage }
  | { kind: "not-found" }
  | { kind: "closed"; status: OnboardingStatus };

/** OSCAL `implementation-status` per Control Assessment status; Not Started and Waived have none (never a claim that doesn't exist). */
export const IMPLEMENTATION_STATE: Record<ControlAssessmentStatus, string | null> = {
  FULFILLED: "implemented",
  IN_PROGRESS: "partial",
  NOT_APPLICABLE: "not-applicable",
  NOT_STARTED: null,
  WAIVED: null,
};

/** SSP `status.state`: Onboarded is operational; Draft, In Review and Approved are still under development. */
export function systemState(status: OnboardingStatus): "operational" | "under-development" {
  return status === "ONBOARDED" ? "operational" : "under-development";
}

const prop = (name: string, value: string) => ({ name, ns: OSCAL_APP_NS, value });

function metadata(title: string, now: Date) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  return {
    title,
    "last-modified": now.toISOString(),
    version: appPackage.version,
    "oscal-version": OSCAL_VERSION,
    props: [prop("exporter", "requirement"), prop("exporter-version", appPackage.version), ...(commit ? [prop("app-commit", commit)] : [])],
  };
}

function implementationText(a: OscalSnapshot["assessments"][number] | undefined): string {
  if (!a) return NO_DESCRIPTION_TEXT;
  // A Not Applicable Control's notes are its rationale: they go in remarks, not in the description.
  const parts = [a.status === "NOT_APPLICABLE" ? null : a.notes?.trim(), a.evidence?.trim() ? `Evidence: ${a.evidence.trim()}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : NO_DESCRIPTION_TEXT;
}

/** Row data to the three documents. */
export function buildOscalPackage(snapshot: OscalSnapshot, now: Date, newUuid: () => string = randomUUID) {
  const { system } = snapshot;
  const systemUuid = oscalUuid("System", system.id);
  const state = systemState(system.status);
  const byId = new Map(snapshot.controls.map((c) => [c.id, c]));
  const assessmentByControl = new Map(snapshot.assessments.map((a) => [a.controlId, a]));
  const applicable = snapshot.applicableControlIds.map((id) => byId.get(id)).filter((c): c is OscalSnapshot["controls"][number] => c !== undefined);

  const catalog = {
    catalog: {
      uuid: newUuid(),
      metadata: metadata("Control Library", now),
      controls: snapshot.controls.map((c) => ({
        id: controlId(c.code),
        title: c.title,
        props: [{ name: "label", value: c.code }],
        parts: [{ id: `${controlId(c.code)}_smt`, name: "statement", prose: c.description }],
      })),
    },
  };

  const profile = {
    profile: {
      uuid: newUuid(),
      metadata: metadata(`OSCAL Profile of ${system.name}`, now),
      imports: [{ href: PACKAGE_FILES.catalog, "include-controls": [{ "with-ids": applicable.map((c) => controlId(c.code)) }] }],
    },
  };

  const informationTypes =
    system.informationTypes.length > 0
      ? system.informationTypes.map((t) => ({
          uuid: oscalUuid("InformationType", t.id),
          title: t.name,
          description: t.description?.trim() || t.name,
          "confidentiality-impact": {
            props: [prop("sensitivity-label", t.sensitivityLabel)],
            base: `sensitivity-level-${t.sensitivityLevel}`,
          },
        }))
      : [
          {
            uuid: oscalUuid("SystemInformation", system.id),
            title: "No Information Type declared",
            description: "The System has not declared any Information Type.",
            "confidentiality-impact": { base: "not-classified" },
          },
        ];

  const ssp = {
    "system-security-plan": {
      uuid: newUuid(),
      metadata: metadata(`System Security Plan of ${system.name}`, now),
      "import-profile": { href: PACKAGE_FILES.profile },
      "system-characteristics": {
        "system-ids": [{ "identifier-type": OSCAL_APP_NS, id: systemUuid }],
        "system-name": system.name,
        description: system.description?.trim() || system.name,
        props: [prop("onboarding-status", system.status)],
        "system-information": { "information-types": informationTypes },
        status: { state },
        "authorization-boundary": { description: PLACEHOLDER_BOUNDARY },
      },
      "system-implementation": {
        components: [{ uuid: systemUuid, type: "this-system", title: system.name, description: system.description?.trim() || system.name, status: { state } }],
      },
      "control-implementation": {
        description: `Controls of the System's OSCAL Profile, with the System's own status for each.`,
        "implemented-requirements": applicable.map((c) => {
          const assessment = assessmentByControl.get(c.id);
          const status: ControlAssessmentStatus = assessment?.status ?? "NOT_STARTED";
          const implementation = IMPLEMENTATION_STATE[status];
          const remarks = status === "NOT_APPLICABLE" && assessment?.notes?.trim() ? assessment.notes.trim() : undefined;
          return {
            uuid: oscalUuid("ImplementedRequirement", system.id, c.id),
            "control-id": controlId(c.code),
            "by-components": [
              {
                "component-uuid": systemUuid,
                uuid: oscalUuid("ImplementedBy", system.id, c.id),
                description: implementationText(assessment),
                props: [prop("control-assessment-status", status)],
                ...(implementation && { "implementation-status": { state: implementation } }),
                ...(remarks && { remarks }),
              },
            ],
          };
        }),
      },
    },
  };

  return { catalog, profile, ssp };
}

/**
 * One System's package for `user`, from one RepeatableRead snapshot. `not-found` when the System doesn't exist or the user may
 * not see it (the same answer, so nothing reveals it); `closed` for a Rejected or Not selected System.
 */
export async function loadOscalPackage(systemId: string, user: { id: string; role: UserRole }, now: Date = new Date()): Promise<OscalPackageResult> {
  const snapshot = await prisma.$transaction(async (tx): Promise<OscalSnapshot | { closed: OnboardingStatus } | null> => {
    const where = await visibleSystemsWhere(user, tx);
    const row = await tx.system.findFirst({
      where: { id: systemId, ...where },
      include: {
        deploymentFacets: { select: { id: true } },
        ...EFFECTIVE_SCOPE_SELECT,
        informationTypes: { select: { id: true, name: true, description: true, sensitivityLevel: true, sensitivity: { select: { label: true } } }, orderBy: { name: "asc" } },
      },
    });
    if (!row) return null;
    if (row.status === "REJECTED" || row.status === "NOT_SELECTED" || row.evaluationClosedAt) return { closed: row.status };

    const classification = withEffectiveScope(row);
    const controls = await tx.control.findMany({ select: { id: true, code: true, title: true, description: true }, orderBy: { code: "asc" } });
    const applicable = await getApplicableControls(classification, {}, tx);
    const assessments = await tx.controlAssessment.findMany({ where: { systemId: row.id }, select: { controlId: true, status: true, notes: true, evidence: true } });
    return {
      system: {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        informationTypes: row.informationTypes.map((t) => ({ id: t.id, name: t.name, description: t.description, sensitivityLevel: t.sensitivityLevel, sensitivityLabel: t.sensitivity.label })),
      },
      controls,
      applicableControlIds: applicable.map((c) => c.id),
      assessments,
    };
  }, READ_SNAPSHOT);

  if (snapshot === null) return { kind: "not-found" };
  if ("closed" in snapshot) return { kind: "closed", status: snapshot.closed };
  return { kind: "ok", system: { id: snapshot.system.id, name: snapshot.system.name }, pkg: buildOscalPackage(snapshot, now) };
}
