/**
 * The OSCAL Package builder (#442, PRD #440, ADR 0017). Two halves:
 *
 * - `loadOscalPackage(systemId, user)` reads one consistent snapshot (a single RepeatableRead transaction, every query on `tx`)
 *   and applies the System visibility rule; it is the only part that knows the data model.
 * - `buildOscalPackage(snapshot, now)` turns plain rows into the three documents (Catalog, OSCAL Profile, System Security Plan)
 *   as plain objects. Pure apart from `randomUUID` for the document UUIDs, which a caller can replace.
 *
 * Each requirement carries the Control's EFFECTIVE status (#443): the same `inheritanceSourcesFor` + `resolveEffectiveStatus`
 * the System page runs, over inputs read inside the same snapshot, so the SSP can never disagree with the page.
 * People (#444) appear by name and role only, never by email: the System's owner and Business System Owner, and the user who
 * exported. Their party UUIDs derive from the User's id (`oscalUuid("User", id)`, one party per User whatever the roles).
 *
 * Components (UUIDs derive from stable record ids, ADR 0017):
 * - `this-system`: `oscalUuid("System", systemId)`;
 * - the Organization (one, always present): `oscalUuid("Organization", "organization")`;
 * - one per Provider the System depends on: `oscalUuid("System", providerId)`, the Provider's own System UUID, so the same
 *   record keeps one identity whichever package it appears in. A Provider is shown by name only (all a dependent may know).
 */
import { randomUUID } from "node:crypto";
import type { ControlApplicability, ControlAssessmentStatus, DataLocation, ImpactLevel, OnboardingStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { EFFECTIVE_SCOPE_SELECT, withEffectiveScope } from "@/lib/effective-framework-scope";
import { getApplicableControls } from "@/lib/control-assessments";
import {
  inheritanceSourcesFor,
  isSharedSource,
  resolveEffectiveStatus,
  sourceHalfMissing,
  type ProviderSource,
  type ResolvedSource,
} from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { DATA_LOCATION_LABELS } from "@/lib/vendor-detail-labels";
import { controlId, oscalUuid } from "@/lib/oscal/ids";
import { effectiveExpiry, noteHasTextBeyondUrls } from "@/lib/evidence";
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
/** What the commit prop says when the build does not know its commit (a local run, a test). One place, so it is never invented elsewhere. */
export const UNKNOWN_COMMIT = "unknown";
/** Responsible-party role ids and titles (the app's own role names). */
const ROLE = {
  owner: { id: "system-owner", title: "System Owner" },
  businessOwner: { id: "business-system-owner", title: "Business System Owner" },
  exporter: { id: "exporting-user", title: "Exporting user" },
} as const;
const IMPACT_NAMES: Record<ImpactLevel, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };

/**
 * The authorization boundary text, generated from the System's record and saying so. Deployment Facets, Data Location and
 * Provider dependencies only; there is no stored boundary text.
 */
export function boundaryDescription(system: OscalSnapshot["system"], providers: { name: string }[]): string {
  const list = (items: string[], none: string) => (items.length > 0 ? items.join(", ") : none);
  const names = (xs: string[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [
    "Generated from the System's record, not written by hand:",
    `Deployment Facets: ${list(names(system.deploymentFacets), "none declared")}.`,
    `Data Location: ${system.dataLocation ? DATA_LOCATION_LABELS[system.dataLocation] : "not declared"}.`,
    `Provider dependencies: ${list(names(providers.map((p) => p.name)), "none")}.`,
  ].join(" ");
}


/** One Evidence record and, for a DOCUMENT, what the System's document holds (never its bytes). */
export type OscalEvidence = {
  id: string;
  kind: "LINK" | "DOCUMENT";
  url: string | null;
  title: string | null;
  description: string | null;
  collectedAt: Date;
  expiresAt: Date | null;
  /** DOCUMENT: null when the document was deleted since. */
  document: { documentRequirementId: string; link: string | null; file: { fileName: string; contentType: string; sha256: string | null } | null } | null;
};

/** The rows the package is built from. */
export type OscalSnapshot = {
  system: {
    id: string;
    name: string;
    description: string | null;
    status: OnboardingStatus;
    informationTypes: { id: string; name: string; description: string | null; sensitivityLevel: number; sensitivityLabel: string }[];
    /** The names of the Deployment Facets the System declares. */
    deploymentFacets: string[];
    dataLocation: DataLocation | null;
    integrityImpactLevel: ImpactLevel | null;
    availabilityImpactLevel: ImpactLevel | null;
    /** By id and name only; never an email. */
    owner: { id: string; name: string };
    businessSystemOwner: { id: string; name: string } | null;
  };
  /** The user who exports, by id and name only; null if the user row is gone. */
  exportedBy: { id: string; name: string } | null;
  /** Every Control in the Control Library. */
  controls: { id: string; code: string; title: string; description: string; applicability: ControlApplicability; /** Months Evidence on it stays valid (#455); null = never expires. */ evidenceValidityMonths?: number | null }[];
  /** The ids of the Controls applicable to the System (a subset of `controls`). */
  applicableControlIds: string[];
  /** The System's own Control Assessments. A Control without one reads as untouched Not Started. */
  assessments: {
    id: string;
    controlId: string;
    status: ControlAssessmentStatus;
    notes: string | null;
    evidence: string | null;
    /** The Assessment's Evidence records (#455). */
    evidenceItems?: OscalEvidence[];
    /** A person set it (`assessedById` is not null); decides whether an inherited status is overridden. */
    personSet: boolean;
  }[];
  /** The Organization's implementation of each Control it has recorded one for (a Control with no row reads as Not Started). */
  organizationImplementations: { controlId: string; status: ControlAssessmentStatus; description: string | null }[];
  /** The Providers the System depends on, by name only. */
  providers: { id: string; name: string; onboarded: boolean }[];
  /** The Offerings that reach the System, as `loadProviderSources` gives them. */
  providerSources: { controlId: string; source: ProviderSource }[];
  /** The Risks auto-opened from a Control Assessment of the System (`Risk.controlAssessmentId` set). */
  assessmentRisks: { id: string; controlAssessmentId: string; createdAt: Date }[];
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

type Person = { id: string; name: string; roles: (typeof ROLE)[keyof typeof ROLE][] };

/** Parties, roles and responsible parties for `people`: one party per User (UUID from the User's id), name only. Empty when nobody. */
function peopleMetadata(people: Person[]) {
  if (people.length === 0) return {};
  const roles = [...new Map(people.flatMap((p) => p.roles).map((r) => [r.id, r])).values()];
  return {
    roles: roles.map((r) => ({ id: r.id, title: r.title })),
    parties: people.map((p) => ({ uuid: oscalUuid("User", p.id), type: "person", name: p.name })),
    "responsible-parties": roles.map((r) => ({
      "role-id": r.id,
      "party-uuids": people.filter((p) => p.roles.some((x) => x.id === r.id)).map((p) => oscalUuid("User", p.id)),
    })),
  };
}

function metadata(title: string, now: Date, people: Person[]) {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || UNKNOWN_COMMIT;
  return {
    title,
    "last-modified": now.toISOString(),
    version: appPackage.version,
    "oscal-version": OSCAL_VERSION,
    props: [prop("exporter", "requirement"), prop("exporter-version", appPackage.version), prop("app-commit", commit)],
    ...peopleMetadata(people),
  };
}

/** What a Control Assessment says about the work: notes and evidence; null when it says nothing. A Not Applicable Control's notes are its rationale (remarks), not a description. */
function ownText(a: OscalSnapshot["assessments"][number] | undefined): string | null {
  if (!a) return null;
  // The Evidence note is printed only when it says something beyond URLs that are already Evidence records (those become
  // back-matter resources), so a backfilled link isn't printed twice.
  const note = a.evidence?.trim();
  const printsNote = note && noteHasTextBeyondUrls(note, (a.evidenceItems ?? []).flatMap((e) => (e.url ? [e.url] : [])));
  const parts = [a.status === "NOT_APPLICABLE" ? null : a.notes?.trim(), printsNote ? `Evidence: ${note}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/** The back-matter resource of one Evidence record: stable UUID, title, collected and expiry props, and its link (with media type and SHA-256 for a stored file). */
function evidenceResource(systemId: string, e: OscalEvidence, validityMonths: number | null) {
  const expiry = effectiveExpiry(e, validityMonths);
  const file = e.document?.file;
  const href =
    e.kind === "LINK" ? e.url : file ? `/api/systems/${systemId}/documents/${e.document!.documentRequirementId}/file` : (e.document?.link ?? null);
  return {
    uuid: oscalUuid("Evidence", e.id),
    title: e.title?.trim() || e.url || "Evidence",
    ...(e.description?.trim() && { description: e.description.trim() }),
    props: [prop("evidence-kind", e.kind), prop("collected", e.collectedAt.toISOString()), ...(expiry ? [prop("expires", expiry.toISOString())] : [])],
    ...(href && {
      rlinks: [
        {
          href,
          ...(file && { "media-type": file.contentType }),
          ...(file?.sha256 && { hashes: [{ algorithm: "SHA-256", value: file.sha256 }] }),
        },
      ],
    }),
  };
}

/** The Provider's half of an Offering as an OSCAL state: satisfied is implemented; a Fulfilled half that is pending (Provider not Onboarded, Control no longer applies) is only planned. */
function providerHalfState(source: ProviderSource): string | null {
  if (sourceHalfMissing(source) === null) return "implemented";
  const state = IMPLEMENTATION_STATE[source.status];
  return state === "implemented" ? "planned" : state;
}

/** The Risk of a Waived Control: of those linked to its Assessment the oldest (`createdAt`, then id), whatever its status. */
export function riskOfAssessment(risks: OscalSnapshot["assessmentRisks"], assessmentId: string): string | undefined {
  return risks
    .filter((r) => r.controlAssessmentId === assessmentId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.id;
}

/** Row data to the three documents. */
export function buildOscalPackage(snapshot: OscalSnapshot, now: Date, newUuid: () => string = randomUUID) {
  const { system } = snapshot;
  const systemUuid = oscalUuid("System", system.id);
  const state = systemState(system.status);
  const byId = new Map(snapshot.controls.map((c) => [c.id, c]));
  const assessmentByControl = new Map(snapshot.assessments.map((a) => [a.controlId, a]));
  const applicable = snapshot.applicableControlIds.map((id) => byId.get(id)).filter((c): c is OscalSnapshot["controls"][number] => c !== undefined);

  /** Merge a person into the list: the same User in two roles is one party with both. */
  const people: Person[] = [];
  const addPerson = (who: { id: string; name: string } | null, role: Person["roles"][number]) => {
    if (!who) return;
    const existing = people.find((p) => p.id === who.id);
    if (existing) existing.roles.push(role);
    else people.push({ id: who.id, name: who.name, roles: [role] });
  };
  addPerson(system.owner, ROLE.owner);
  addPerson(system.businessSystemOwner, ROLE.businessOwner);
  const exporter: Person[] = snapshot.exportedBy ? [{ ...snapshot.exportedBy, roles: [ROLE.exporter] }] : [];
  addPerson(snapshot.exportedBy, ROLE.exporter);

  const organizationUuid = oscalUuid("Organization", "organization");
  const organizationByControl = new Map(snapshot.organizationImplementations.map((o) => [o.controlId, o]));
  const providerSourcesByControl = new Map<string, ProviderSource[]>();
  for (const { controlId: id, source } of snapshot.providerSources) providerSourcesByControl.set(id, [...(providerSourcesByControl.get(id) ?? []), source]);
  const providers = [...snapshot.providers].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const components = [
    { uuid: systemUuid, type: "this-system", title: system.name, description: system.description?.trim() || system.name, status: { state } },
    {
      uuid: organizationUuid,
      type: "policy",
      title: "Organization",
      description: "The Organization's own implementation of Controls, inherited by every System the Control applies to.",
      status: { state: "operational" },
    },
    ...providers.map((p) => ({
      uuid: oscalUuid("System", p.id),
      type: "service",
      title: p.name,
      description: `Provider "${p.name}", a System this System depends on.`,
      status: { state: p.onboarded ? "operational" : "under-development" },
    })),
  ];

  /** One by-component entry; `key` keeps its UUID stable per (System, Control, component). */
  const entry = (c: { id: string }, componentUuid: string, key: string | null, description: string, state: string | null, props: ReturnType<typeof prop>[], remarks?: string) => ({
    "component-uuid": componentUuid,
    uuid: oscalUuid("ImplementedBy", ...(key === null ? [system.id, c.id] : [system.id, c.id, key])),
    description,
    props,
    ...(state && { "implementation-status": { state } }),
    ...(remarks && { remarks }),
  });

  function implementedRequirement(c: OscalSnapshot["controls"][number]) {
    const assessment = assessmentByControl.get(c.id);
    const organization = organizationByControl.get(c.id);
    const effective = resolveEffectiveStatus(
      assessment ? toOwnAssessment({ status: assessment.status, assessedById: assessment.personSet ? "person" : null }) : null,
      inheritanceSourcesFor(c, organization?.status, providerSourcesByControl.get(c.id)),
    );
    const ownStatus: ControlAssessmentStatus = assessment?.status ?? "NOT_STARTED";
    const byComponents: ReturnType<typeof entry>[] = [];

    /** The System's own work: its Assessment's notes and evidence, else (a Shared half) what the Offering leaves to the customer. */
    const ownPart = (shared: (ResolvedSource & ProviderSource)[]) => {
      const responsibilities = shared.map((s) => s.customerResponsibility?.trim()).filter(Boolean);
      const fallback = responsibilities.length > 0 ? `Customer responsibility: ${responsibilities.join(" ")}` : null;
      const risk = effective.status === "WAIVED" && assessment ? riskOfAssessment(snapshot.assessmentRisks, assessment.id) : undefined;
      const remarks = ownStatus === "NOT_APPLICABLE" && assessment?.notes?.trim() ? assessment.notes.trim() : undefined;
      return entry(
        c,
        systemUuid,
        null,
        ownText(assessment) ?? fallback ?? NO_DESCRIPTION_TEXT,
        IMPLEMENTATION_STATE[ownStatus],
        [
          prop("control-assessment-status", ownStatus),
          ...(shared.length > 0 ? [prop("customer-half", ownStatus === "FULFILLED" ? "done" : "open")] : []),
          ...(risk ? [prop("risk", oscalUuid("Risk", risk))] : []),
        ],
        remarks,
      );
    };
    const providerPart = (s: ResolvedSource & ProviderSource) => {
      const reason = sourceHalfMissing(s);
      return entry(
        c,
        oscalUuid("System", s.provider.id),
        `provider:${s.provider.id}`,
        NO_DESCRIPTION_TEXT,
        providerHalfState(s),
        [prop("offering-type", s.type), prop("provider-status", s.status), ...(reason ? [prop("provider-half-missing", reason)] : [])],
      );
    };

    const decided = effective.source;
    const shared = effective.sources.filter(isSharedSource);
    if (decided.kind === "ORGANIZATION") {
      byComponents.push(
        entry(c, organizationUuid, "organization", organization?.description?.trim() || NO_DESCRIPTION_TEXT, IMPLEMENTATION_STATE[organization?.status ?? "NOT_STARTED"], [
          prop("organization-status", organization?.status ?? "NOT_STARTED"),
        ]),
      );
    } else if (decided.kind === "PROVIDER" && decided.type === "FULL") {
      byComponents.push(providerPart(decided as ResolvedSource & ProviderSource));
    } else if (shared.length > 0) {
      // A Shared Offering: the Provider's half and the System's own (customer) half, both visible; an open customer half stays owed.
      for (const s of shared) byComponents.push(providerPart(s));
      byComponents.push(ownPart(shared));
    } else {
      byComponents.push(ownPart([]));
    }

    const evidence = assessment?.evidenceItems ?? [];
    return {
      uuid: oscalUuid("ImplementedRequirement", system.id, c.id),
      "control-id": controlId(c.code),
      props: [
        prop("effective-status", effective.status),
        prop("effective-source", decided.kind === "ORGANIZATION_DIRECT" ? "ORGANIZATION" : decided.kind),
        ...(effective.overridesInherited ? [prop("overrides-inherited", "true")] : []),
      ],
      ...(evidence.length > 0 && { links: evidence.map((e) => ({ href: `#${oscalUuid("Evidence", e.id)}`, rel: "evidence" })) }),
      "by-components": byComponents,
    };
  }

  const catalog = {
    catalog: {
      uuid: newUuid(),
      metadata: metadata("Control Library", now, exporter),
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
      metadata: metadata(`OSCAL Profile of ${system.name}`, now, exporter),
      imports: [{ href: PACKAGE_FILES.catalog, "include-controls": [{ "with-ids": applicable.map((c) => controlId(c.code)) }] }],
    },
  };

  const informationTypes =
    system.informationTypes.length > 0
      ? system.informationTypes.map((t) => ({
          uuid: oscalUuid("InformationType", t.id),
          title: t.name,
          description: t.description?.trim() || t.name,
          // App naming throughout, never `fips-199-*`. Integrity and Availability are the System's own levels (the app records
          // them on the System, not per type), so every type carries the same; left out when the System has not set one.
          "confidentiality-impact": {
            props: [prop("sensitivity-level", String(t.sensitivityLevel))],
            base: t.sensitivityLabel,
          },
          ...(system.integrityImpactLevel && { "integrity-impact": { base: IMPACT_NAMES[system.integrityImpactLevel] } }),
          ...(system.availabilityImpactLevel && { "availability-impact": { base: IMPACT_NAMES[system.availabilityImpactLevel] } }),
        }))
      : [
          {
            uuid: oscalUuid("SystemInformation", system.id),
            title: "No Information Type declared",
            description: "The System has not declared any Information Type.",
            "confidentiality-impact": { base: "not-classified" },
          },
        ];

  // One resource per Evidence record of an applicable Control's Assessment, in Control order then collected date (a stable order).
  const evidenceResources = applicable.flatMap((c) =>
    (assessmentByControl.get(c.id)?.evidenceItems ?? []).map((e) => evidenceResource(system.id, e, c.evidenceValidityMonths ?? null)),
  );

  const ssp = {
    "system-security-plan": {
      uuid: newUuid(),
      metadata: metadata(`System Security Plan of ${system.name}`, now, people),
      "import-profile": { href: PACKAGE_FILES.profile },
      "system-characteristics": {
        "system-ids": [{ "identifier-type": OSCAL_APP_NS, id: systemUuid }],
        "system-name": system.name,
        description: system.description?.trim() || system.name,
        props: [prop("onboarding-status", system.status)],
        "system-information": { "information-types": informationTypes },
        status: { state },
        "authorization-boundary": { description: boundaryDescription(system, providers) },
        "responsible-parties": [ROLE.owner, ROLE.businessOwner].flatMap((r) => {
          const uuids = people.filter((p) => p.roles.some((x) => x.id === r.id)).map((p) => oscalUuid("User", p.id));
          return uuids.length > 0 ? [{ "role-id": r.id, "party-uuids": uuids }] : [];
        }),
      },
      "system-implementation": { components },
      "control-implementation": {
        description: `Controls of the System's OSCAL Profile, with the effective status of each (after inheritance from the Organization and Providers).`,
        "implemented-requirements": applicable.map((c) => implementedRequirement(c)),
      },
      ...(evidenceResources.length > 0 && { "back-matter": { resources: evidenceResources } }),
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
        deploymentFacets: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        businessSystemOwner: { select: { id: true, name: true } },
        ...EFFECTIVE_SCOPE_SELECT,
        informationTypes: { select: { id: true, name: true, description: true, sensitivityLevel: true, sensitivity: { select: { label: true } } }, orderBy: { name: "asc" } },
      },
    });
    if (!row) return null;
    if (row.status === "REJECTED" || row.status === "NOT_SELECTED" || row.evaluationClosedAt) return { closed: row.status };

    const classification = withEffectiveScope(row);
    const controls = await tx.control.findMany({ select: { id: true, code: true, title: true, description: true, applicability: true, evidenceValidityMonths: true }, orderBy: { code: "asc" } });
    const applicable = await getApplicableControls(classification, {}, tx);
    const assessmentRows = await tx.controlAssessment.findMany({ where: { systemId: row.id }, select: {
        id: true,
        controlId: true,
        status: true,
        notes: true,
        evidence: true,
        assessedById: true,
        evidenceItems: {
          select: {
            id: true,
            kind: true,
            url: true,
            title: true,
            description: true,
            collectedAt: true,
            expiresAt: true,
            systemDocument: { select: { documentRequirementId: true, link: true, file: { select: { fileName: true, contentType: true, sha256: true } } } },
          },
          orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
        },
      },
    });

    // The inheritance inputs, read the way the System page reads them (same loaders, same `tx`); sequential, a transaction has one connection.
    const bothIds = applicable.filter((c) => c.applicability === "BOTH").map((c) => c.id);
    const organizationStatuses = await loadOrganizationStatuses(bothIds, tx);
    const organizationRows = bothIds.length === 0 ? [] : await tx.organizationControlImplementation.findMany({ where: { controlId: { in: bothIds } }, select: { controlId: true, description: true } });
    const organizationDescriptions = new Map(organizationRows.map((o) => [o.controlId, o.description]));
    const providerSources = (await loadProviderSources([row.id], applicable.map((c) => c.id), tx)).get(row.id);
    const dependencies = await tx.providerDependency.findMany({
      where: { dependentId: row.id },
      select: { provider: { select: { id: true, name: true, status: true } } },
      orderBy: { id: "asc" },
    });
    const risks = await tx.risk.findMany({
      where: { systemId: row.id, controlAssessmentId: { not: null } },
      select: { id: true, controlAssessmentId: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const exportedBy = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, name: true } });
    return {
      exportedBy,
      system: {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        informationTypes: row.informationTypes.map((t) => ({ id: t.id, name: t.name, description: t.description, sensitivityLevel: t.sensitivityLevel, sensitivityLabel: t.sensitivity.label })),
        deploymentFacets: row.deploymentFacets.map((f) => f.name),
        dataLocation: row.dataLocation,
        integrityImpactLevel: row.integrityImpactLevel,
        availabilityImpactLevel: row.availabilityImpactLevel,
        owner: row.owner,
        businessSystemOwner: row.businessSystemOwner,
      },
      controls,
      applicableControlIds: applicable.map((c) => c.id),
      assessments: assessmentRows.map(({ assessedById, evidenceItems, ...a }) => ({ ...a, evidenceItems: evidenceItems.map(({ systemDocument, ...e }) => ({ ...e, document: systemDocument })), personSet: assessedById !== null })),
      organizationImplementations: [...organizationStatuses].map(([id, status]) => ({ controlId: id, status, description: organizationDescriptions.get(id) ?? null })),
      providers: dependencies.map((d) => ({ id: d.provider.id, name: d.provider.name, onboarded: d.provider.status === "ONBOARDED" })),
      providerSources: [...(providerSources ?? [])].flatMap(([id, sources]) => sources.map((source) => ({ controlId: id, source }))),
      assessmentRisks: risks.flatMap((r) => (r.controlAssessmentId === null ? [] : [{ id: r.id, controlAssessmentId: r.controlAssessmentId, createdAt: r.createdAt }])),
    };
  }, READ_SNAPSHOT);

  if (snapshot === null) return { kind: "not-found" };
  if ("closed" in snapshot) return { kind: "closed", status: snapshot.closed };
  return { kind: "ok", system: { id: snapshot.system.id, name: snapshot.system.name }, pkg: buildOscalPackage(snapshot, now) };
}
