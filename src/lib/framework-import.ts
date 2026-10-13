import type { ControlCoverage, ImpactLevel, Prisma, PrismaClient } from "@prisma/client";
import { SYSTEM_ACTOR } from "./change-events";
import { clearGapAcceptance } from "./framework-coverage";
import { frameworkLabel } from "./framework-label";
import { checkImportReferences, type FrameworkImport, type ImportRequirement, type ImportSupplementaryControl } from "./framework-import-schema";
import { logMappingChange, wouldCreateSupersedesCycle } from "./frameworks";
import { createOrganizationImplementationFor } from "./organization-implementation";
import {
  finishRecompute,
  prepareRecompute,
  scopeForControl,
  scopeForMappedControls,
  type PendingRecompute,
  type RecomputeSummary,
} from "./applicability-recompute";

/**
 * The idempotent Framework loader (PRD 0001 F-IMP.2, #144). Takes a parsed
 * import (`framework-import-schema.ts`) and makes the database match it, keyed
 * on Framework name + version, Requirement code and Control code.
 *
 * - A new Framework is created as Draft; an existing Draft is updated in place.
 *   Loading into a Draft writes no Change Events and triggers no recompute (a
 *   Draft is inert, ADR 0007), with one exception: changing the Deployment
 *   Facets or Impact Level thresholds of an existing Supplementary Control that
 *   is also mapped to a Published Framework recomputes the Systems it reaches,
 *   as editing a Control does.
 * - A Published Framework is refused unless `allowPublished` is set. With the
 *   flag it is updated through the same paths as the UI: each Control Mapping
 *   added, removed or changed in Coverage is logged with `logMappingChange`, a
 *   Full mapping clears a gap acceptance (`clearGapAcceptance`), and the
 *   Systems that have the Framework in scope are recomputed
 *   (`prepareRecompute` / `finishRecompute`). The actor of those events is
 *   `SYSTEM_ACTOR`, and the detail names the file the load came from.
 * - Nothing is written until the file is valid against the database too; all
 *   writes of one file are one transaction, so an invalid or refused file
 *   changes nothing. The recompute of a Published Framework runs after the
 *   commit, like the UI's, with the "before" snapshot taken first.
 * - A second run of an unchanged file writes nothing at all.
 *
 * What the file owns: the Framework's metadata (an omitted optional field is
 * left as it is), each listed Requirement's section/title/text and its set of
 * Control Mappings (a mapping missing from the file is removed), and its
 * Supplementary Controls. What it does not: a Requirement or Supplementary
 * Control missing from the file is kept and reported, never deleted;
 * `isBase` and `status` are never changed.
 *
 * Reads for the plan use `db`; the recompute helpers use the shared client
 * (like the routes), which is the same database in the CLI and the tests.
 */

export type LoadOptions = {
  /** Explicit permission to change a Published Framework (the CLI's `--allow-published`). */
  allowPublished?: boolean;
  /** The file the import came from; goes into the detail of the Change Events a Published load writes. */
  source?: string;
};

export type LoadSummary = {
  framework: "created" | "updated" | "unchanged";
  requirements: { created: number; updated: number; unchanged: number; notInFile: string[] };
  mappings: { created: number; updated: number; removed: number; unchanged: number };
  supplementaryControls: { created: number; updated: number; unchanged: number };
  /** CONTROL_MAPPING_CHANGED events written (always 0 for a Draft). */
  changeEvents: number;
  /** Totals of the recomputes a Published load ran; null for a Draft or when nothing needed one. */
  recompute: RecomputeSummary | null;
  /** True if anything was written. */
  changed: boolean;
};

export type LoadResult =
  | { status: "loaded"; framework: { name: string; version: string; status: "DRAFT" | "PUBLISHED" }; summary: LoadSummary }
  | { status: "refused"; reason: string }
  | { status: "invalid"; problems: string[] };

type Db = PrismaClient;

const TRANSACTION_OPTIONS = { timeout: 300_000, maxWait: 30_000 };

type ControlRow = Prisma.ControlGetPayload<{
  include: { deploymentFacets: { select: { name: true } }; originFramework: { select: { name: true; version: true } } };
}>;

type MappingCreate = { requirementCode: string; controlCode: string; coverage: ControlCoverage; rationale: string | null };
type MappingUpdate = {
  id: string;
  requirementId: string;
  requirementCode: string;
  controlCode: string;
  from: ControlCoverage;
  to: ControlCoverage;
  rationale: string | null | undefined;
};
type MappingRemoval = {
  id: string;
  requirementCode: string;
  controlId: string;
  controlCode: string;
  coverage: ControlCoverage;
};

type ControlWrite = {
  file: ImportSupplementaryControl;
  existing: ControlRow | null;
  data: Prisma.ControlUncheckedUpdateInput;
  facetNames: string[] | undefined;
  scopingChanged: boolean;
};

const sameSet = (a: readonly string[], b: readonly string[]) => new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The fields of an existing Supplementary Control the file would change (an omitted optional field is left alone). */
function diffControl(file: ImportSupplementaryControl, existing: ControlRow): ControlWrite {
  const data: Prisma.ControlUncheckedUpdateInput = {};
  if (file.title !== existing.title) data.title = file.title;
  if (file.description !== existing.description) data.description = file.description;
  if (file.category !== existing.category) data.category = file.category;
  if (file.mandatory !== undefined && file.mandatory !== existing.mandatory) data.mandatory = file.mandatory;
  if (file.question !== undefined && file.question !== existing.question) data.question = file.question;
  if (file.intent !== undefined && file.intent !== existing.intent) data.intent = file.intent;
  if (file.examples !== undefined && !sameList(file.examples, existing.examples)) data.examples = file.examples;

  let scopingChanged = false;
  const levels = [
    ["minConfidentialityImpactLevel", file.minConfidentialityImpactLevel],
    ["minIntegrityImpactLevel", file.minIntegrityImpactLevel],
    ["minAvailabilityImpactLevel", file.minAvailabilityImpactLevel],
  ] as const;
  for (const [field, value] of levels) {
    if (value !== undefined && value !== existing[field]) {
      data[field] = value as ImpactLevel | null;
      scopingChanged = true;
    }
  }
  const facetNames =
    file.deploymentFacets !== undefined &&
    !sameSet(
      file.deploymentFacets,
      existing.deploymentFacets.map((f) => f.name),
    )
      ? file.deploymentFacets
      : undefined;
  if (facetNames) scopingChanged = true;
  return { file, existing, data, facetNames, scopingChanged };
}

const hasWrites = (write: ControlWrite) => Object.keys(write.data).length > 0 || write.facetNames !== undefined;

function addSummaries(a: RecomputeSummary | null, b: RecomputeSummary | null): RecomputeSummary | null {
  if (!a || !b) return a ?? b;
  return {
    systems: Math.max(a.systems, b.systems),
    changed: a.changed + b.changed,
    added: a.added + b.added,
    removed: a.removed + b.removed,
    stale: a.stale + b.stale,
  };
}

export async function loadFramework(db: Db, data: FrameworkImport, options: LoadOptions = {}): Promise<LoadResult> {
  const { framework: file } = data;
  const label = frameworkLabel(file);

  const existing = await db.framework.findUnique({
    where: { name_version: { name: file.name, version: file.version } },
    include: {
      requirements: { include: { mappings: { include: { control: { select: { id: true, code: true } } } } } },
    },
  });

  if (existing?.status === "PUBLISHED" && !options.allowPublished) {
    return {
      status: "refused",
      reason: `Framework ${label} is Published. Nothing was changed; pass --allow-published to update a Published Framework.`,
    };
  }

  // --- Validate against the database: nothing is written until this passes. ---
  const problems: string[] = [];

  const wantsBase = file.isBase ?? false;
  if (existing && wantsBase !== existing.isBase) {
    problems.push(
      existing.isBase
        ? `framework: ${label} is the base Framework, so the file must say "isBase": true; the loader never changes isBase`
        : `framework: the file says "isBase": true but ${label} is not the base Framework; the loader never changes isBase`,
    );
  } else if (!existing && wantsBase) {
    problems.push(`framework: the loader never creates the base Framework, but the file says "isBase": true for new ${label}`);
  }

  let supersedesId: string | null | undefined;
  if (file.supersedes === null) supersedesId = null;
  else if (file.supersedes) {
    const target = await db.framework.findUnique({
      where: { name_version: { name: file.supersedes.name, version: file.supersedes.version } },
      select: { id: true },
    });
    if (!target) {
      problems.push(`framework.supersedes: Framework ${frameworkLabel(file.supersedes)} does not exist`);
    } else if (existing && (await wouldCreateSupersedesCycle(existing.id, target.id, db))) {
      problems.push(`framework.supersedes: ${label} can't supersede itself, directly or indirectly`);
    } else {
      supersedesId = target.id;
    }
  }

  const supplementaryCodes = data.supplementaryControls.map((control) => control.code);
  const mappedCodes = data.requirements.flatMap((requirement) => requirement.mappings.map((mapping) => mapping.control));
  const controlRows: ControlRow[] = await db.control.findMany({
    where: { code: { in: [...new Set([...supplementaryCodes, ...mappedCodes])] } },
    include: { deploymentFacets: { select: { name: true } }, originFramework: { select: { name: true, version: true } } },
  });
  const controlByCode = new Map(controlRows.map((control) => [control.code, control]));

  const facetNamesWanted = [...new Set(data.supplementaryControls.flatMap((control) => control.deploymentFacets ?? []))];
  const facetRows = facetNamesWanted.length
    ? await db.deploymentFacet.findMany({ where: { name: { in: facetNamesWanted } }, select: { id: true, name: true } })
    : [];
  const facetIdByName = new Map(facetRows.map((facet) => [facet.name, facet.id]));

  problems.push(
    ...checkImportReferences(data, { controlCodes: new Set(controlByCode.keys()), facetNames: new Set(facetIdByName.keys()) }),
  );

  const controlWrites: ControlWrite[] = [];
  data.supplementaryControls.forEach((control, index) => {
    const row = controlByCode.get(control.code);
    if (!row) {
      controlWrites.push({ file: control, existing: null, data: {}, facetNames: undefined, scopingChanged: false });
      return;
    }
    if (!existing || row.originFrameworkId !== existing.id) {
      const where = row.originFramework ? `a Supplementary Control of ${frameworkLabel(row.originFramework)}` : "a base Control";
      problems.push(
        `supplementaryControls[${index}]: Control "${control.code}" already exists as ${where}; a file can only create or update its own Supplementary Controls`,
      );
      return;
    }
    if (row.applicability !== control.applicability) {
      problems.push(
        `supplementaryControls[${index}]: Control "${control.code}" is ${row.applicability} in the database; the loader doesn't change a Control's applicability`,
      );
      return;
    }
    controlWrites.push(diffControl(control, row));
  });

  if (problems.length > 0) return { status: "invalid", problems };

  // --- Plan the writes. ---
  const isPublished = existing?.status === "PUBLISHED";
  const existingRequirements = new Map((existing?.requirements ?? []).map((requirement) => [requirement.code, requirement]));
  const fileRequirementCodes = new Set(data.requirements.map((requirement) => requirement.code));

  const frameworkData = {
    ...(file.description !== undefined && (!existing || file.description !== existing.description) && { description: file.description }),
    ...(file.licensing !== undefined && (!existing || file.licensing !== existing.licensing) && { licensing: file.licensing }),
    ...(file.strictComplianceRequired !== undefined &&
      (!existing || file.strictComplianceRequired !== existing.strictComplianceRequired) && {
        strictComplianceRequired: file.strictComplianceRequired,
      }),
    ...(supersedesId !== undefined && (!existing || supersedesId !== existing.supersedesId) && { supersedesId }),
  };

  const requirementCreates: ImportRequirement[] = [];
  const requirementUpdates: { id: string; code: string; data: { section?: string; title?: string; text?: string } }[] = [];
  const mappingCreates: MappingCreate[] = [];
  const mappingUpdates: MappingUpdate[] = [];
  const mappingRemovals: MappingRemoval[] = [];
  let requirementsUnchanged = 0;
  let mappingsUnchanged = 0;

  for (const requirement of data.requirements) {
    const row = existingRequirements.get(requirement.code);
    if (!row) {
      requirementCreates.push(requirement);
      for (const mapping of requirement.mappings) {
        mappingCreates.push({
          requirementCode: requirement.code,
          controlCode: mapping.control,
          coverage: mapping.coverage,
          rationale: mapping.rationale ?? null,
        });
      }
      continue;
    }

    const changes: { section?: string; title?: string; text?: string } = {};
    if (requirement.section !== row.section) changes.section = requirement.section;
    if (requirement.title !== row.title) changes.title = requirement.title;
    if (requirement.text !== row.text) changes.text = requirement.text;
    if (Object.keys(changes).length > 0) requirementUpdates.push({ id: row.id, code: row.code, data: changes });
    else requirementsUnchanged += 1;

    const currentByControl = new Map(row.mappings.map((mapping) => [mapping.control.code, mapping]));
    for (const mapping of requirement.mappings) {
      const current = currentByControl.get(mapping.control);
      if (!current) {
        mappingCreates.push({
          requirementCode: requirement.code,
          controlCode: mapping.control,
          coverage: mapping.coverage,
          rationale: mapping.rationale ?? null,
        });
        continue;
      }
      const coverageChanged = mapping.coverage !== current.coverage;
      const rationaleChanged = mapping.rationale !== undefined && mapping.rationale !== current.rationale;
      if (coverageChanged || rationaleChanged) {
        mappingUpdates.push({
          id: current.id,
          requirementId: row.id,
          requirementCode: row.code,
          controlCode: mapping.control,
          from: current.coverage,
          to: mapping.coverage,
          rationale: rationaleChanged ? mapping.rationale : undefined,
        });
      } else {
        mappingsUnchanged += 1;
      }
    }
    const wanted = new Set(requirement.mappings.map((mapping) => mapping.control));
    for (const current of row.mappings) {
      if (!wanted.has(current.control.code)) {
        mappingRemovals.push({
          id: current.id,
          requirementCode: row.code,
          controlId: current.control.id,
          controlCode: current.control.code,
          coverage: current.coverage,
        });
      }
    }
  }

  const notInFile = [...existingRequirements.keys()].filter((code) => !fileRequirementCodes.has(code));
  const writableControls = controlWrites.filter((write) => !write.existing || hasWrites(write));
  const frameworkAction: LoadSummary["framework"] = !existing
    ? "created"
    : Object.keys(frameworkData).length > 0
      ? "updated"
      : "unchanged";

  const summary: LoadSummary = {
    framework: frameworkAction,
    requirements: {
      created: requirementCreates.length,
      updated: requirementUpdates.length,
      unchanged: requirementsUnchanged,
      notInFile,
    },
    mappings: {
      created: mappingCreates.length,
      updated: mappingUpdates.length,
      removed: mappingRemovals.length,
      unchanged: mappingsUnchanged,
    },
    supplementaryControls: {
      created: controlWrites.filter((write) => !write.existing).length,
      updated: controlWrites.filter((write) => write.existing && hasWrites(write)).length,
      unchanged: controlWrites.filter((write) => write.existing && !hasWrites(write)).length,
    },
    changeEvents: 0,
    recompute: null,
    changed: false,
  };
  summary.changed =
    frameworkAction !== "unchanged" ||
    requirementCreates.length > 0 ||
    requirementUpdates.length > 0 ||
    mappingCreates.length + mappingUpdates.length + mappingRemovals.length > 0 ||
    writableControls.length > 0;

  const done = (status: "DRAFT" | "PUBLISHED"): LoadResult => ({
    status: "loaded",
    framework: { name: file.name, version: file.version, status },
    summary,
  });
  if (!summary.changed) return done(existing?.status ?? "DRAFT");

  // --- Published: take the "before" snapshots of what the load can narrow. ---
  const note = options.source ? `loaded from ${options.source}` : undefined;
  const trigger = `Framework "${label}" loaded${options.source ? ` from ${options.source}` : ""}`;
  const pendings: PendingRecompute[] = [];
  const afterWriteControlCodes = new Set<string>();
  if (isPublished && existing) {
    const known = (code: string) => controlByCode.get(code)?.id;
    const beforeIds = new Set<string>();
    for (const removal of mappingRemovals) beforeIds.add(removal.controlId);
    for (const creation of mappingCreates) {
      const id = known(creation.controlCode);
      if (id) beforeIds.add(id);
      else afterWriteControlCodes.add(creation.controlCode); // a Supplementary Control the load creates
    }
    const narrowing = await prepareRecompute(scopeForMappedControls(existing, [...beforeIds]), { snapshot: true });
    if (narrowing) pendings.push(narrowing);
  }
  // A scoping change moves applicability wherever the Control is mapped to a Published Framework, even
  // when its own Framework is a Draft (like PATCH /api/controls/[id]). `scopeForControl` is null when it
  // is mapped to no Published Framework, so an ordinary Draft load still recomputes nothing.
  for (const write of controlWrites) {
    if (write.existing && write.scopingChanged) {
      const scoped = await prepareRecompute(await scopeForControl(write.existing.id, db), { snapshot: true });
      if (scoped) pendings.push(scoped);
    }
  }

  // --- Write everything for this file in one transaction. ---
  const written = await db.$transaction(async (tx) => {
    let createdFramework: { id: string } | null = null;
    if (!existing) {
      createdFramework = await tx.framework.create({
        data: { name: file.name, version: file.version, ...frameworkData },
        select: { id: true },
      });
    } else if (frameworkAction === "updated") {
      await tx.framework.update({ where: { id: existing.id }, data: frameworkData });
    }
    const frameworkId = (existing?.id ?? createdFramework?.id)!;

    const controlIdByCode = new Map<string, string>(controlRows.map((control) => [control.code, control.id]));
    for (const write of writableControls) {
      const facets = (write.facetNames ?? write.file.deploymentFacets ?? []).map((name) => ({ id: facetIdByName.get(name)! }));
      if (!write.existing) {
        const c = write.file;
        const created = await tx.control.create({
          data: {
            code: c.code,
            title: c.title,
            description: c.description,
            category: c.category,
            mandatory: c.mandatory ?? true,
            applicability: c.applicability,
            question: c.question ?? null,
            intent: c.intent ?? null,
            examples: c.examples ?? [],
            minConfidentialityImpactLevel: c.minConfidentialityImpactLevel ?? null,
            minIntegrityImpactLevel: c.minIntegrityImpactLevel ?? null,
            minAvailabilityImpactLevel: c.minAvailabilityImpactLevel ?? null,
            originFrameworkId: frameworkId,
            deploymentFacets: { connect: facets },
          },
        });
        await createOrganizationImplementationFor(tx, created);
        controlIdByCode.set(created.code, created.id);
      } else {
        await tx.control.update({
          where: { id: write.existing.id },
          data: { ...write.data, ...(write.facetNames !== undefined && { deploymentFacets: { set: facets } }) },
        });
      }
    }

    // Requirements: new ones in one statement, changed ones one by one.
    const requirementIdByCode = new Map(existingRequirements.size ? [...existingRequirements].map(([code, row]) => [code, row.id]) : []);
    if (requirementCreates.length > 0) {
      await tx.requirement.createMany({
        data: requirementCreates.map((r) => ({ frameworkId, code: r.code, section: r.section, title: r.title, text: r.text })),
      });
      const created = await tx.requirement.findMany({
        where: { frameworkId, code: { in: requirementCreates.map((r) => r.code) } },
        select: { id: true, code: true },
      });
      for (const row of created) requirementIdByCode.set(row.code, row.id);
    }
    for (const update of requirementUpdates) {
      await tx.requirement.update({ where: { id: update.id }, data: update.data });
    }

    const frameworkRef = { name: file.name, version: file.version };
    if (mappingRemovals.length > 0) {
      await tx.controlMapping.deleteMany({ where: { id: { in: mappingRemovals.map((m) => m.id) } } });
    }
    if (mappingCreates.length > 0) {
      await tx.controlMapping.createMany({
        data: mappingCreates.map((m) => ({
          requirementId: requirementIdByCode.get(m.requirementCode)!,
          controlId: controlIdByCode.get(m.controlCode)!,
          coverage: m.coverage,
          rationale: m.rationale,
        })),
      });
    }
    for (const update of mappingUpdates) {
      await tx.controlMapping.update({
        where: { id: update.id },
        data: { coverage: update.to, ...(update.rationale !== undefined && { rationale: update.rationale }) },
      });
    }

    // A Full mapping makes a Requirement covered, so a gap acceptance on an existing Requirement no longer applies.
    const fullOnExisting = new Set<string>();
    for (const creation of mappingCreates) {
      if (creation.coverage === "FULL" && existingRequirements.has(creation.requirementCode)) {
        fullOnExisting.add(existingRequirements.get(creation.requirementCode)!.id);
      }
    }
    for (const update of mappingUpdates) if (update.to === "FULL") fullOnExisting.add(update.requirementId);
    for (const requirementId of fullOnExisting) await clearGapAcceptance(tx, requirementId);

    // Published: the same Change Events as a UI edit (a rationale-only edit is not logged, like the UI).
    let events = 0;
    if (isPublished) {
      for (const removal of mappingRemovals) {
        await logMappingChange(
          { change: "removed", framework: frameworkRef, requirementCode: removal.requirementCode, controlCode: removal.controlCode, from: removal.coverage, to: null, note },
          SYSTEM_ACTOR,
          tx,
        );
        events += 1;
      }
      for (const creation of mappingCreates) {
        await logMappingChange(
          { change: "added", framework: frameworkRef, requirementCode: creation.requirementCode, controlCode: creation.controlCode, from: null, to: creation.coverage, note },
          SYSTEM_ACTOR,
          tx,
        );
        events += 1;
      }
      for (const update of mappingUpdates) {
        if (update.from === update.to) continue;
        await logMappingChange(
          { change: "changed", framework: frameworkRef, requirementCode: update.requirementCode, controlCode: update.controlCode, from: update.from, to: update.to, note },
          SYSTEM_ACTOR,
          tx,
        );
        events += 1;
      }
    }
    return { events, controlIdByCode };
  }, TRANSACTION_OPTIONS);

  summary.changeEvents = written.events;

  // --- Published: recompute the Systems the change reaches, after the commit like the UI. ---
  if (isPublished && existing) {
    const added = [...afterWriteControlCodes].map((code) => written.controlIdByCode.get(code)).filter((id): id is string => !!id);
    const additions = await prepareRecompute(scopeForMappedControls(existing, added), { snapshot: false });
    if (additions) pendings.push(additions);
  }
  if (pendings.length > 0) {
    let total: RecomputeSummary | null = null;
    for (const pending of pendings) total = addSummaries(total, await finishRecompute(pending, trigger));
    summary.recompute = total;
  }

  return done(existing?.status ?? "DRAFT");
}

/** Plain-text lines for a CLI: what happened to one file. */
export function describeLoadResult(file: string, result: LoadResult): string[] {
  if (result.status === "invalid") {
    return [`${file}: INVALID, nothing changed`, ...result.problems.map((problem) => `  - ${problem}`)];
  }
  if (result.status === "refused") return [`${file}: REFUSED. ${result.reason}`];
  const { summary, framework } = result;
  const label = frameworkLabel(framework);
  const head = summary.changed ? `${file}: ${label} (${framework.status}) ${summary.framework === "created" ? "created" : "updated"}` : `${file}: ${label} (${framework.status}) already up to date, no change`;
  const lines = [head];
  if (summary.changed || summary.requirements.notInFile.length > 0) {
    const { requirements: r, mappings: m, supplementaryControls: s } = summary;
    lines.push(
      `  Requirements: ${r.created} created, ${r.updated} updated, ${r.unchanged} unchanged`,
      `  Control Mappings: ${m.created} created, ${m.updated} updated, ${m.removed} removed, ${m.unchanged} unchanged`,
      `  Supplementary Controls: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged`,
    );
    if (summary.changeEvents > 0) lines.push(`  Change Events: ${summary.changeEvents} mapping change(s) logged`);
    if (summary.recompute) {
      const c = summary.recompute;
      lines.push(`  Recompute: ${c.systems} System(s) examined, ${c.changed} changed (+${c.added}/-${c.removed} Control Assessments, ${c.stale} kept as stale)`);
    }
    if (r.notInFile.length > 0) {
      lines.push(`  ${r.notInFile.length} Requirement(s) in the database are not in the file and were kept: ${r.notInFile.join(", ")}`);
    }
  }
  return lines;
}
