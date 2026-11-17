/**
 * Production-sized demo estate (#385): about 100 more Systems like the design proposals' example data
 * (`public/design/systems/data.js`), with the state a real estate has (assessments, open questions, Risks,
 * review rounds and approvals, a Change Event history over about 8 months, Providers and their dependents,
 * suggested Frameworks added or declined, one draft Internal Audit and, when staged evaluation is on, two
 * Comparisons).
 *
 * Not wired into `prisma db seed`. Run on demand:
 *   npx tsx prisma/seed-production-like.ts --dry-run      describe what would happen, write nothing
 *   npx tsx prisma/seed-production-like.ts                run against a local database
 *   dotenv -e <env file> -- npx tsx prisma/seed-production-like.ts --production   run against a shared database
 *
 * Safe by construction:
 * - Production guard: a database that is not local (localhost, 127.0.0.1, ::1, *.localhost, the docker `db`
 *   host) is refused without `--production`, before any connection is opened. The target (host and database,
 *   never the password) and what will be created are always printed first.
 * - Marker: every row it creates that does not cascade from a System has an id starting with `seed385-`.
 *   Re-running deletes those rows (by id prefix, never by name) and creates them again, so the result is
 *   the same after every run. Rows it did not create are never modified or deleted. Existing catalogs
 *   (Deployment Facets, Business Units, Information Types, Frameworks, Controls, settings) are only read.
 * - A System name that already exists as a System this script did not create is skipped.
 * - Deterministic: a seeded generator, so the plan is identical on every run (only the dates move with the day).
 */
import fs from "node:fs";
import path from "node:path";
import type { ControlAssessmentStatus, ImpactLevel, Prisma, RiskSeverity, RiskStatus } from "@prisma/client";
import {
  AD_HOC_RISKS,
  APPROVAL_COMMENTS,
  MARKER,
  QUERY_QUESTIONS,
  QUERY_REPLIES,
  REJECTION_TEXT,
  SEED,
  buildEstatePlan,
  describeDatabaseTarget,
  isLocalDatabaseUrl,
  makeRng,
  type CatalogInput,
  type EstatePlan,
  type PlannedSystem,
  type ProviderKind,
} from "./seed-production-like-plan";

const DAY = 86_400_000;

/** DATABASE_URL from the environment or, as Prisma does, from `.env` in the working directory. */
function readDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

type Args = { dryRun: boolean; production: boolean };
function parseArgs(argv: string[]): Args {
  const known = new Set(["--dry-run", "--production"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(" ")}\nUsage: npx tsx prisma/seed-production-like.ts [--dry-run] [--production]`);
    process.exit(2);
  }
  return { dryRun: argv.includes("--dry-run"), production: argv.includes("--production") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // --- The guard, before any connection ----------------------------------------------------------------------
  const url = readDatabaseUrl();
  const local = isLocalDatabaseUrl(url);
  console.log(`Target database: ${describeDatabaseTarget(url)} (${local ? "local" : "NOT local"})${args.dryRun ? " [dry run]" : ""}`);
  if (!url) {
    console.error("No DATABASE_URL in the environment or .env. Nothing was done.");
    process.exit(1);
  }
  if (!local && !args.production) {
    console.error("Refusing to run: this database is not local. Pass --production to run against it on purpose. Nothing was done.");
    process.exit(1);
  }
  process.env.DATABASE_URL = url;

  // Imported only now, so a refused run never creates a client.
  const { prisma } = await import("../src/lib/prisma");
  const { getApplicableControls } = await import("../src/lib/control-assessments");
  const { groupsWithRemit } = await import("../src/lib/review-steps");
  const { SYSTEM_ACTOR } = await import("../src/lib/change-events");
  const { riskLoggedDetail } = await import("../src/lib/risk-logged-event");
  const { describeProviderMarked, describeOfferingAdded } = await import("../src/lib/control-offering-rules");
  const { describeDependencyAdded } = await import("../src/lib/provider-dependency-rules");
  const { readStagedEvaluationEnabled } = await import("../src/lib/app-settings");
  const { addCandidates, recordOutcome } = await import("../src/lib/comparison");

  const started = Date.now();
  const now = new Date();
  const ago = (days: number, extraHours = 0) => new Date(now.getTime() - days * DAY - extraHours * 3_600_000);

  try {
    // --- Read what exists ---------------------------------------------------------------------------------------
    const base = await prisma.framework.findFirst({ where: { isBase: true } });
    if (!base) {
      console.error("There is no base Framework in this database, so no Control would apply. Nothing was done.");
      process.exit(1);
    }
    const [allFacets, businessUnits, informationTypes, frameworks, sensitivityLevels, systemRows, userRows, staged] = await Promise.all([
      prisma.deploymentFacet.findMany(),
      prisma.businessUnit.findMany(),
      prisma.informationType.findMany({ include: { suggestedFrameworks: { select: { id: true } } } }),
      prisma.framework.findMany(),
      prisma.sensitivityLevel.findMany({ select: { level: true } }),
      prisma.system.findMany({ where: { NOT: { id: { startsWith: MARKER } } }, select: { name: true } }),
      prisma.user.findMany({ where: { NOT: { id: { startsWith: MARKER } } }, select: { id: true, email: true } }),
      readStagedEvaluationEnabled(prisma),
    ]);
    const markerCounts = {
      systems: await prisma.system.count({ where: { id: { startsWith: MARKER } } }),
      users: await prisma.user.count({ where: { id: { startsWith: MARKER } } }),
      comparisons: await prisma.comparison.count({ where: { id: { startsWith: MARKER } } }),
      audits: await prisma.internalAudit.count({ where: { id: { startsWith: MARKER } } }),
    };

    // Catalog entries created by an earlier run belong to the plan, not to "what exists".
    const input: CatalogInput = {
      facets: allFacets.filter((row) => !row.id.startsWith(MARKER)).map((row) => ({ id: row.id, name: row.name, requiresVendorDetails: row.requiresVendorDetails })),
      businessUnits: businessUnits.filter((row) => !row.id.startsWith(MARKER)).map((row) => ({ id: row.id, name: row.name })),
      informationTypes: informationTypes
        .filter((row) => !row.id.startsWith(MARKER))
        .map((row) => ({ id: row.id, name: row.name, sensitivityLevel: row.sensitivityLevel, suggestedFrameworkIds: row.suggestedFrameworks.map((fw) => fw.id) })),
      frameworks: frameworks.map((row) => ({ id: row.id, name: row.name, version: row.version, status: row.status, isBase: row.isBase })),
      sensitivityLevels: sensitivityLevels.map((row) => row.level),
      existingSystemNames: systemRows.map((row) => row.name),
      existingUsers: userRows,
      stagedEvaluationEnabled: staged,
    };
    const plan = buildEstatePlan(input);

    // --- Summary (always) -----------------------------------------------------------------------------------------
    printSummary(plan, markerCounts, base.name);
    if (args.dryRun) {
      console.log("\nDry run: nothing was written.");
      return;
    }

    // --- Replace: delete what an earlier run created ------------------------------------------------------------
    await deleteMarkerRows(prisma);

    // --- Shared rows -----------------------------------------------------------------------------------------------
    await prisma.$transaction(async (tx) => {
      for (const entry of plan.catalogsToCreate.facets) await tx.deploymentFacet.create({ data: entry });
      for (const entry of plan.catalogsToCreate.businessUnits) await tx.businessUnit.create({ data: entry });
      for (const entry of plan.catalogsToCreate.informationTypes) await tx.informationType.create({ data: entry });
      for (const user of plan.users) {
        if (!user.create) continue;
        await tx.user.create({ data: { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: ago(300) } });
      }
    });

    // --- Systems: one transaction each -------------------------------------------------------------------------------
    const applicableBySystem = new Map<string, { id: string; code: string; mandatory: boolean }[]>();
    const nameById = new Map(plan.systems.map((system) => [system.id, system.name]));
    for (const system of plan.systems) {
      const rng = makeRng(SEED * 1000 + system.index);
      await prisma.$transaction(
        async (tx) => {
          const applicable = await writeSystem(tx, system, rng);
          applicableBySystem.set(system.id, applicable);
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
      if ((system.index + 1) % 20 === 0) console.log(`  ${system.index + 1} of ${plan.systems.length} Systems written`);
    }

    // --- Dependencies on Providers (both ends exist now) --------------------------------------------------------
    await prisma.$transaction(async (tx) => {
      const rows: { dependentId: string; providerId: string; createdAt: Date }[] = [];
      const events: Prisma.ChangeEventCreateManyInput[] = [];
      for (const system of plan.systems) {
        system.dependsOnIds.forEach((providerId, i) => {
          const createdAt = ago(Math.max(0, (system.timeline.onboardedDaysAgo ?? system.timeline.updatedDaysAgo) - 1 - i));
          rows.push({ dependentId: system.id, providerId, createdAt });
          events.push({ systemId: system.id, action: "CLASSIFICATION_CHANGED", detail: describeDependencyAdded(nameById.get(providerId)!), actorId: system.ownerId, createdAt });
        });
      }
      await tx.providerDependency.createMany({ data: rows });
      await tx.changeEvent.createMany({ data: events });
    });

    // --- Internal Audit (draft) ------------------------------------------------------------------------------------
    if (plan.internalAudit) await writeInternalAudit(prisma, plan, applicableBySystem, ago);

    // --- Comparisons (only when staged evaluation is on) -------------------------------------------------------
    for (const comparison of plan.comparisons) {
      await prisma.comparison.create({ data: { id: comparison.id, name: comparison.name, need: comparison.need, ownerId: comparison.ownerId, createdAt: ago(20) } });
      const actor = { id: comparison.ownerId, role: "ADMIN" as const };
      const added = await addCandidates(actor, comparison.id, comparison.candidateIds);
      if (!added.ok) throw new Error(`Could not add Candidates to ${comparison.name}: ${JSON.stringify(added)}`);
      if (comparison.outcome) {
        const recorded = await recordOutcome(actor, comparison.id, { chosenSystemId: comparison.outcome.chosenId, comment: comparison.outcome.comment, closeAsNotSelected: [] });
        if (!recorded.ok) throw new Error(`Could not record the outcome of ${comparison.name}: ${JSON.stringify(recorded)}`);
      }
    }

    await printCounts(prisma);
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s.`);

    // ---------------------------------------------------------------------------------------------------------------
    // The writer for one System
    // ---------------------------------------------------------------------------------------------------------------
    async function writeSystem(tx: Prisma.TransactionClient, s: PlannedSystem, rnd: () => number) {
      const t = s.timeline;
      const createdAt = ago(t.createdDaysAgo);
      const updatedAt = ago(t.updatedDaysAgo);
      const submittedAt = t.submittedDaysAgo === null ? null : ago(t.submittedDaysAgo);
      const rejectedAtGate = s.status === "REJECTED";
      const scopeIds = [base!.id, ...s.scopeFrameworkIds];
      const decidedAt = rejectedAtGate ? updatedAt : t.decidedDaysAgo === null ? null : ago(t.decidedDaysAgo);
      const d = s.details;
      const renewal = d?.contractRenewsInMonths == null ? null : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + d.contractRenewsInMonths, 1));

      await tx.system.create({
        data: {
          id: s.id,
          name: s.name,
          vendor: s.vendor,
          description: s.description,
          vendorWebsiteUrl: d?.vendorWebsiteUrl ?? null,
          serviceUrl: d?.serviceUrl ?? null,
          productPlan: d?.productPlan ?? null,
          dataLocation: d?.dataLocation ?? null,
          dataProcessingAgreement: d?.dataProcessingAgreement ?? null,
          contractReference: d?.contractReference ?? null,
          contractRenewalDate: renewal,
          noticePeriodMonths: d?.noticePeriodMonths ?? null,
          status: s.status,
          sensitivityLevel: s.sensitivityLevel,
          integrityImpactLevel: s.integrityImpactLevel,
          availabilityImpactLevel: s.availabilityImpactLevel,
          ownerId: s.ownerId,
          businessSystemOwnerId: s.businessSystemOwnerId,
          isProvider: s.isProvider,
          deploymentFacets: { connect: s.facetIds.map((id) => ({ id })) },
          businessUnits: { connect: s.businessUnitIds.map((id) => ({ id })) },
          informationTypes: { connect: s.informationTypeIds.map((id) => ({ id })) },
          frameworkScopes: { connect: scopeIds.map((id) => ({ id })) },
          ...(s.staged && { evaluationStage: "FIRST_ROUND" as const, evaluationStageEnteredAt: createdAt }),
          ...(rejectedAtGate && { evaluationStage: "OG3" as const, evaluationTrack: "FULL" as const, evaluationStageEnteredAt: ago(t.updatedDaysAgo + 3), evaluationClosedAt: updatedAt }),
          onboardedAt: t.onboardedDaysAgo === null ? null : ago(t.onboardedDaysAgo),
          createdAt,
          updatedAt,
        },
      });
      if (s.declinedSuggestions.length > 0) {
        await tx.frameworkSuggestionDecline.createMany({ data: s.declinedSuggestions.map((row) => ({ systemId: s.id, ...row, createdAt })) });
      }

      // Assessments for every applicable Control, the way the app creates them.
      const classification = {
        deploymentFacets: s.facetIds.map((id) => ({ id })),
        frameworkScopes: scopeIds.map((id) => ({ id })),
        sensitivityLevel: s.sensitivityLevel,
        integrityImpactLevel: s.integrityImpactLevel as ImpactLevel | null,
        availabilityImpactLevel: s.availabilityImpactLevel as ImpactLevel | null,
      };
      const applicable = await getApplicableControls(classification, {}, tx);
      const offered = s.providerKind ? offeredControls(s.providerKind, applicable, rnd) : [];
      const offeredIds = new Set(offered.map((entry) => entry.control.id));
      const nonDraft = s.status !== "DRAFT";
      const assessedBy = s.ownerId;
      const assessmentIds = new Map<string, string>();
      const inProgress: typeof applicable = [];
      const events: Prisma.ChangeEventCreateManyInput[] = [];

      const rows: Prisma.ControlAssessmentCreateManyInput[] = applicable.map((control, i) => {
        const id = `${s.id}-ca-${i}`;
        assessmentIds.set(control.id, id);
        const when = new Date((submittedAt ?? createdAt).getTime() - Math.floor(rnd() * 6) * DAY - Math.floor(rnd() * 20) * 3_600_000);
        const roll = rnd();
        if (offeredIds.has(control.id) || rnd() < s.doneShare) {
          const kind = offeredIds.has(control.id) ? 0 : rnd();
          if (kind < 0.88) {
            return { id, systemId: s.id, controlId: control.id, status: "FULFILLED", selfAssessmentAnswer: "YES", evidence: `https://evidence.example.com/${s.id}/${control.code}`, assessedById: assessedBy, assessedAt: when, updatedAt: when };
          }
          if (kind < 0.94) {
            return { id, systemId: s.id, controlId: control.id, status: "NOT_APPLICABLE", selfAssessmentAnswer: "NA", notes: "Not applicable to this deployment model, confirmed against the vendor's shared-responsibility matrix.", assessedById: assessedBy, assessedAt: when, updatedAt: when };
          }
          return { id, systemId: s.id, controlId: control.id, status: "WAIVED", notes: "Waived by agreement with the Reviewer until the vendor delivers the missing capability.", assessedById: assessedBy, assessedAt: when, updatedAt: when };
        }
        // Not done: a mandatory Control of a submitted System is at least In progress; the rest is mostly untouched.
        if ((nonDraft && control.mandatory) || roll < 0.35) {
          inProgress.push(control);
          return { id, systemId: s.id, controlId: control.id, status: "IN_PROGRESS", notes: "Working on it; evidence to follow.", assessedById: assessedBy, assessedAt: when, updatedAt: when };
        }
        return { id, systemId: s.id, controlId: control.id, status: "NOT_STARTED", updatedAt: createdAt };
      });

      // Risks: "No" answers open one the way the app does; the rest are ad hoc.
      const risks: Prisma.RiskCreateManyInput[] = [];
      const nonconformances = Math.min(Math.ceil(s.riskCount / 2), inProgress.length);
      for (let i = 0; i < nonconformances; i++) {
        const control = inProgress[i];
        const assessment = rows.find((row) => row.controlId === control.id)!;
        assessment.selfAssessmentAnswer = "NO";
        const at = assessment.assessedAt as Date;
        const title = `${control.code}: ${control.title}`;
        risks.push({
          id: `${s.id}-risk-${i}`,
          source: "REQUIREMENT_NONCONFORMANCE",
          systemId: s.id,
          title,
          description: `Auto-opened: "${control.question ?? control.title}" was answered No.`,
          severity: "MEDIUM",
          likelihood: "MEDIUM",
          status: "OPEN",
          controlAssessmentId: assessmentIds.get(control.id)!,
          createdAt: at,
          updatedAt: at,
        });
        events.push({ systemId: s.id, action: "RISK_LOGGED", detail: riskLoggedDetail({ title, severity: "MEDIUM", how: { kind: "self-assessment", controlCode: control.code } }), actorId: SYSTEM_ACTOR, createdAt: at });
      }
      const severities: RiskSeverity[] = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "CRITICAL"];
      for (let i = nonconformances; i < s.riskCount; i++) {
        const template = AD_HOC_RISKS[Math.floor(rnd() * AD_HOC_RISKS.length)];
        const statusRoll = rnd();
        const status: RiskStatus = statusRoll < 0.6 ? "OPEN" : statusRoll < 0.75 ? "MITIGATED" : statusRoll < 0.85 ? "ACCEPTED" : "CLOSED";
        const severity = severities[Math.floor(rnd() * severities.length)];
        const at = ago(Math.max(0, Math.floor(rnd() * Math.max(1, t.createdDaysAgo - 1))));
        const title = `${template.title} (${s.name})`;
        risks.push({
          id: `${s.id}-risk-${i}`,
          source: "AD_HOC",
          systemId: s.id,
          title,
          description: template.description,
          severity,
          likelihood: severities[Math.floor(rnd() * severities.length)],
          status,
          mitigationPlan: status === "OPEN" ? null : "Agreed with the owner; tracked in the next review.",
          ownerId: plan.riskOwnerId,
          createdAt: at,
          updatedAt: at,
        });
        events.push({ systemId: s.id, action: "RISK_LOGGED", detail: riskLoggedDetail({ title, severity, how: { kind: "manual" } }), actorId: plan.riskOwnerId, createdAt: at });
      }

      await tx.controlAssessment.createMany({ data: rows });
      if (risks.length > 0) await tx.risk.createMany({ data: risks });

      // A sample of the answered assessments leave a status-change event, spread between creation and the last change.
      const touched = rows.filter((row) => row.status !== "NOT_STARTED").slice(0, 6);
      for (const row of touched) {
        const control = applicable.find((entry) => entry.id === row.controlId)!;
        events.push({ systemId: s.id, action: "ASSESSMENT_STATUS_CHANGED", detail: `${control.code} status changed from NOT_STARTED to ${row.status}`, actorId: assessedBy, createdAt: row.assessedAt as Date });
      }

      // Offerings of a Provider (the dependents are written once every System exists).
      if (s.isProvider) {
        const offeringAt = ago(Math.max(0, (t.onboardedDaysAgo ?? t.updatedDaysAgo) - 1));
        events.push({ systemId: s.id, action: "CLASSIFICATION_CHANGED", detail: describeProviderMarked(true), actorId: s.ownerId, createdAt: offeringAt });
        await tx.controlOffering.createMany({
          data: offered.map((entry) => ({
            providerId: s.id,
            controlId: entry.control.id,
            type: entry.type,
            customerResponsibility: entry.type === "SHARED" ? "The customer configures and reviews this for its own use of the service." : null,
            createdAt: offeringAt,
            updatedAt: offeringAt,
          })),
        });
        for (const entry of offered) events.push({ systemId: s.id, action: "CONTROL_OFFERING_CHANGED", detail: describeOfferingAdded(entry.control.code, entry.type), actorId: s.ownerId, createdAt: offeringAt });
      }

      // Open questions: a Reviewer asks, the owner sometimes answers; none is resolved.
      if (s.openQuestions > 0) {
        const candidates = rows.filter((row) => row.status !== "NOT_STARTED" || true);
        for (let q = 0; q < s.openQuestions && q < candidates.length; q++) {
          const row = candidates[Math.floor(rnd() * candidates.length)];
          const control = applicable.find((entry) => entry.id === row.controlId)!;
          const body = QUERY_QUESTIONS[Math.floor(rnd() * QUERY_QUESTIONS.length)];
          const askedAt = ago(Math.max(0, Math.min(t.updatedDaysAgo, (t.submittedDaysAgo ?? t.updatedDaysAgo)) - Math.floor(rnd() * 3)));
          const replied = rnd() < 0.3;
          const replyBody = QUERY_REPLIES[Math.floor(rnd() * QUERY_REPLIES.length)];
          const repliedAt = new Date(askedAt.getTime() + 3_600_000 * (2 + Math.floor(rnd() * 30)));
          await tx.assessmentQuery.create({
            data: {
              controlAssessmentId: row.id!,
              lastMessageAuthorId: replied ? s.ownerId : plan.reviewerId,
              createdAt: askedAt,
              messages: {
                create: [
                  { authorId: plan.reviewerId, body: `${control.code}: ${body}`, attributedTo: "Base review", createdAt: askedAt },
                  ...(replied ? [{ authorId: s.ownerId, body: replyBody, createdAt: repliedAt }] : []),
                ],
              },
            },
          });
          events.push({ systemId: s.id, action: "QUERY_OPENED", detail: `Query raised: "${`${control.code}: ${body}`.slice(0, 80)}"`, actorId: plan.reviewerId, createdAt: askedAt });
          if (replied) events.push({ systemId: s.id, action: "QUERY_REPLIED", detail: `Reply: "${replyBody.slice(0, 80)}"`, actorId: s.ownerId, createdAt: repliedAt });
        }
      }

      // Created, and the review history.
      events.push({ systemId: s.id, action: "SYSTEM_CREATED", detail: `Created the System "${s.name}"`, actorId: s.ownerId, createdAt });
      if (s.staged) events.push({ systemId: s.id, action: "EVALUATION_STAGE_CHANGED", detail: "Staged evaluation started: first round", actorId: s.ownerId, createdAt });
      const steps = async () => [{ reviewGroupId: null as string | null, name: "Base review" }, ...[...(await groupsWithRemit(tx, classification)).entries()].map(([reviewGroupId, name]) => ({ reviewGroupId, name }))];

      if (s.returnedToDraft && submittedAt && decidedAt) {
        // Submitted once, rejected by the base review and returned to the owner; not yet resubmitted.
        const round = await tx.reviewRound.create({ data: { systemId: s.id, submittedAt } });
        const comment = REJECTION_TEXT.returned[s.index % REJECTION_TEXT.returned.length];
        await tx.approval.create({ data: { systemId: s.id, reviewRoundId: round.id, approverId: plan.reviewerId, decision: "REJECTED", comment, decidedAt } });
        events.push({ systemId: s.id, action: "SYSTEM_SUBMITTED", detail: "Submitted for review", actorId: s.ownerId, createdAt: submittedAt });
        events.push({ systemId: s.id, action: "APPROVAL_DECIDED", detail: `Base review: Rejected: ${comment}`, actorId: plan.reviewerId, createdAt: decidedAt });
      } else if (s.status === "IN_REVIEW" && submittedAt) {
        await tx.reviewRound.create({ data: { systemId: s.id, submittedAt } });
        events.push({ systemId: s.id, action: "SYSTEM_SUBMITTED", detail: "Submitted for review", actorId: s.ownerId, createdAt: submittedAt });
        // Some steps already decided: the base review has approved in about half of the Systems under review.
        if (rnd() < 0.5) {
          const round = await tx.reviewRound.findFirstOrThrow({ where: { systemId: s.id }, select: { id: true } });
          const at = new Date(submittedAt.getTime() + 3_600_000 * (4 + Math.floor(rnd() * 40)));
          const comment = APPROVAL_COMMENTS[Math.floor(rnd() * APPROVAL_COMMENTS.length)];
          await tx.approval.create({ data: { systemId: s.id, reviewRoundId: round.id, approverId: plan.reviewerId, decision: "APPROVED", comment, decidedAt: at } });
          events.push({ systemId: s.id, action: "APPROVAL_DECIDED", detail: `Base review: Approved: ${comment}`, actorId: plan.reviewerId, createdAt: at });
        }
      } else if ((s.status === "APPROVED" || s.status === "ONBOARDED") && submittedAt && decidedAt) {
        const round = await tx.reviewRound.create({ data: { systemId: s.id, submittedAt } });
        events.push({ systemId: s.id, action: "SYSTEM_SUBMITTED", detail: "Submitted for review", actorId: s.ownerId, createdAt: submittedAt });
        const allSteps = await steps();
        for (const [i, step] of allSteps.entries()) {
          const at = new Date(Math.min(decidedAt.getTime(), submittedAt.getTime() + 3_600_000 * (6 + i * 7)) + (i === allSteps.length - 1 ? 0 : 0));
          const comment = APPROVAL_COMMENTS[(s.index + i) % APPROVAL_COMMENTS.length];
          await tx.approval.create({ data: { systemId: s.id, reviewRoundId: round.id, reviewGroupId: step.reviewGroupId, approverId: plan.reviewerId, decision: "APPROVED", comment, decidedAt: i === allSteps.length - 1 ? decidedAt : at } });
          events.push({ systemId: s.id, action: "APPROVAL_DECIDED", detail: `${step.name}: Approved: ${comment}`, actorId: plan.reviewerId, createdAt: i === allSteps.length - 1 ? decidedAt : at });
        }
        if (s.status === "ONBOARDED" && t.onboardedDaysAgo !== null) {
          events.push({ systemId: s.id, action: "SYSTEM_ONBOARDED", detail: "Marked Onboarded", actorId: s.ownerId, createdAt: ago(t.onboardedDaysAgo) });
        }
      } else if (rejectedAtGate) {
        const comment = REJECTION_TEXT.gate[s.index % REJECTION_TEXT.gate.length];
        events.push({ systemId: s.id, action: "EVALUATION_STAGE_CHANGED", detail: "Staged evaluation started: first round", actorId: s.ownerId, createdAt });
        await tx.gateDecision.create({ data: { systemId: s.id, gate: "OG3", outcome: "REJECT", comment, decidedById: s.businessSystemOwnerId!, decidedAt: updatedAt } });
        events.push({ systemId: s.id, action: "GATE_DECIDED", detail: `OG3: rejected: ${comment}`, actorId: s.businessSystemOwnerId!, createdAt: updatedAt });
      }

      await tx.changeEvent.createMany({ data: events });
      return applicable.map((control) => ({ id: control.id, code: control.code, mandatory: control.mandatory }));
    }
  } finally {
    await prisma.$disconnect();
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Providers: which Controls they offer
// -------------------------------------------------------------------------------------------------------------------

const OFFER_CODES: Record<ProviderKind, string[]> = {
  identity: ["A.5.15", "A.5.16", "A.5.17", "A.5.18", "A.8.2", "A.8.5"],
  backup: ["A.8.13", "A.8.14"],
  cloud: ["A.8.9", "A.8.15", "A.8.16", "A.8.24", "A.8.20", "A.5.23"],
  cdn: ["A.8.20", "A.8.21", "A.8.22", "A.8.23"],
};

function offeredControls<C extends { id: string; code: string }>(kind: ProviderKind, applicable: C[], rnd: () => number) {
  const wanted = new Set(OFFER_CODES[kind]);
  const picked = applicable.filter((control) => wanted.has(control.code));
  // A few more at random, so the list is not just the textbook ones.
  const others = applicable.filter((control) => !wanted.has(control.code));
  for (let i = 0; i < 3 && others.length > 0; i++) picked.push(others.splice(Math.floor(rnd() * others.length), 1)[0]);
  return picked.map((control) => ({ control, type: rnd() < 0.8 ? ("FULL" as const) : ("SHARED" as const) }));
}

// -------------------------------------------------------------------------------------------------------------------
// Internal Audit (draft)
// -------------------------------------------------------------------------------------------------------------------

async function writeInternalAudit(
  prisma: Awaited<typeof import("../src/lib/prisma")>["prisma"],
  plan: EstatePlan,
  applicableBySystem: Map<string, { id: string; code: string; mandatory: boolean }[]>,
  ago: (days: number) => Date,
) {
  const audit = plan.internalAudit!;
  const common = audit.systemIds.map((id) => new Set(applicableBySystem.get(id)!.map((control) => control.id)));
  const first = applicableBySystem.get(audit.systemIds[0])!.filter((control) => common.every((ids) => ids.has(control.id)));
  const preferred = ["A.5.15", "A.8.13", "A.8.15", "A.5.18", "A.8.5", "A.8.9"];
  const chosen = [...first.filter((control) => preferred.includes(control.code)), ...first.filter((control) => !preferred.includes(control.code))].slice(0, 6);
  const controls = await prisma.control.findMany({ where: { id: { in: chosen.map((control) => control.id) } }, select: { id: true, code: true, title: true, question: true } });
  await prisma.$transaction(async (tx) => {
    await tx.internalAudit.create({
      data: {
        id: audit.id,
        title: audit.title,
        scopeDescription: audit.scopeDescription,
        dueDate: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + audit.dueInDays)),
        includeOrganization: false,
        createdById: audit.createdById,
        createdAt: ago(6),
        systems: { create: audit.systemIds.map((systemId) => ({ systemId })) },
        controls: {
          create: controls.map((control) => ({
            controlId: control.id,
            questions: { create: [{ position: 1, text: control.question ?? `Show how ${control.code} (${control.title}) is met on this System.` }] },
          })),
        },
      },
    });
  });
}

// -------------------------------------------------------------------------------------------------------------------
// Replace: remove what an earlier run created
// -------------------------------------------------------------------------------------------------------------------

async function deleteMarkerRows(prisma: Awaited<typeof import("../src/lib/prisma")>["prisma"]) {
  const where = { id: { startsWith: MARKER } };
  await prisma.comparison.deleteMany({ where });
  await prisma.internalAudit.deleteMany({ where });
  const ids = (await prisma.system.findMany({ where, select: { id: true } })).map((row) => row.id);
  for (let i = 0; i < ids.length; i += 20) await prisma.system.deleteMany({ where: { id: { in: ids.slice(i, i + 20) } } });
  // Catalog entries and Users it created, each only if nothing else came to use it since.
  const attempt = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.warn(`  Kept some ${label} from an earlier run (still in use): ${(error as Error).message.split("\n").pop()}`);
    }
  };
  await attempt("Information Types", () => prisma.informationType.deleteMany({ where }));
  await attempt("Business Units", () => prisma.businessUnit.deleteMany({ where }));
  await attempt("Deployment Facets", () => prisma.deploymentFacet.deleteMany({ where }));
  const users = await prisma.user.findMany({ where, select: { id: true } });
  for (const user of users) await attempt(`User ${user.id}`, () => prisma.user.delete({ where: { id: user.id } }));
}

// -------------------------------------------------------------------------------------------------------------------
// Output
// -------------------------------------------------------------------------------------------------------------------

function printSummary(plan: EstatePlan, existing: { systems: number; users: number; comparisons: number; audits: number }, baseName: string) {
  const byStatus = new Map<string, number>();
  for (const system of plan.systems) byStatus.set(system.status, (byStatus.get(system.status) ?? 0) + 1);
  const sum = (pick: (system: PlannedSystem) => number) => plan.systems.reduce((total, system) => total + pick(system), 0);
  console.log(`Base Framework: ${baseName}`);
  console.log(`Will create ${plan.systems.length} Systems (${[...byStatus].map(([status, n]) => `${n} ${status}`).join(", ")})`);
  console.log(`  ${plan.systems.filter((system) => system.isProvider).length} Providers, ${sum((system) => system.dependsOnIds.length)} Provider dependencies`);
  console.log(`  ${sum((system) => system.openQuestions)} open Assessment Queries, ${sum((system) => system.riskCount)} Risks, ${plan.systems.filter((system) => system.staged).length} staged Drafts`);
  console.log(`Will create ${plan.users.filter((user) => user.create).length} Users (${plan.users.filter((user) => !user.create).length} existing ones are reused as they are)`);
  console.log(`Will create ${plan.comparisons.length} Comparisons and ${plan.internalAudit ? 1 : 0} draft Internal Audit`);
  const c = plan.catalogsToCreate;
  console.log(`Catalog entries to create (only for an empty catalog): ${c.facets.length} Deployment Facets, ${c.businessUnits.length} Business Units, ${c.informationTypes.length} Information Types`);
  console.log(`Will replace what an earlier run created: ${existing.systems} Systems, ${existing.users} Users, ${existing.comparisons} Comparisons, ${existing.audits} Internal Audits`);
  if (plan.skippedNames.length > 0) console.log(`Skipped ${plan.skippedNames.length} names that already exist as Systems: ${plan.skippedNames.join(", ")}`);
  for (const note of plan.notes) console.log(`Note: ${note}`);
}

async function printCounts(prisma: Awaited<typeof import("../src/lib/prisma")>["prisma"]) {
  const counts = {
    Systems: await prisma.system.count(),
    "Systems created by this script": await prisma.system.count({ where: { id: { startsWith: MARKER } } }),
    Users: await prisma.user.count(),
    ControlAssessments: await prisma.controlAssessment.count(),
    AssessmentQueries: await prisma.assessmentQuery.count(),
    Risks: await prisma.risk.count(),
    ReviewRounds: await prisma.reviewRound.count(),
    Approvals: await prisma.approval.count(),
    ChangeEvents: await prisma.changeEvent.count(),
    ControlOfferings: await prisma.controlOffering.count(),
    ProviderDependencies: await prisma.providerDependency.count(),
    FrameworkSuggestionDeclines: await prisma.frameworkSuggestionDecline.count(),
    GateDecisions: await prisma.gateDecision.count(),
    InternalAudits: await prisma.internalAudit.count(),
    Comparisons: await prisma.comparison.count(),
  };
  console.log("\nRow counts now:");
  for (const [label, n] of Object.entries(counts)) console.log(`  ${label}: ${n}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// Referenced for type completeness of the status literals above.
export type { ControlAssessmentStatus };
