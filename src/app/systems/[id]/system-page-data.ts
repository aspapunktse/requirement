import type { ControlAssessmentStatus, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { getApplicableControls, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { inheritanceSourcesFor, resolveEffectiveStatus } from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { getSystemFrameworkRequirements, type SystemFrameworkRequirements } from "@/lib/requirement-status";
import { getSystemFrameworkScopes } from "@/lib/framework-scope";
import { getActionableQueriesForSystem } from "@/lib/assessment-queries";
import { deciderVisibilityFor, memberGroupIds, userCanDecideStep } from "@/lib/approvals";
import { readCurrentSteps } from "@/lib/review-steps";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { CHANGE_EVENT_ACTION_LABEL, CHANGE_EVENT_ACTION_TONE } from "@/lib/change-event-labels";
import { canChangeOwner, canSubmit } from "@/lib/system-permissions";
import { canMarkOnboarded } from "@/lib/onboarding";
import { frameworkLabel } from "@/lib/framework-label";
import { buildAttention, controlIsDone, lifecycleNote, nextStepFor, riskGridOf, sourceKeyOf } from "./system-page-logic";
import {
  CONTROL_STATUS_ORDER,
  SOURCE_KEYS,
  type ActivityItem,
  type DecisionStep,
  type FrameworkSummary,
  type SourceKey,
  type SystemPageView,
  type TimelineItem,
} from "./system-page-types";

/**
 * Everything the System page shows for the acting user (design proposal A "Cockpit", issue #243).
 * Visibility is the existing rule (`visibleSystemsWhere`, the same as `getVisibleSystem`); nothing here
 * widens it. All of it is read in one RepeatableRead transaction, every query on `tx`, so the headline
 * figures, the tiles and the next step agree even while the System changes.
 */

const SYSTEM_INCLUDE = {
  deploymentFacets: true,
  // Declared Framework Scope rows, ids only: applicability needs them (ADR 0007).
  frameworkScopes: { select: { id: true } },
  owner: true,
  businessUnits: { select: { id: true, name: true }, orderBy: { name: "asc" } },
} satisfies Prisma.SystemInclude;

/** The newest Change Events shown in the Recent activity tile. */
export const ACTIVITY_TILE_SIZE = 4;

/** Roles that see the person behind any attributed action (CONTEXT.md, "A step decides as its group"). */
const ALWAYS_SEES_PEOPLE: UserRole[] = ["ADMIN", "INTERNAL_AUDITOR", "COMPLIANCE_MANAGER"];
const QUERY_ACTIONS = ["QUERY_OPENED", "QUERY_REPLIED", "QUERY_RESOLVED"];
/** How close an Approval's decision time and its Change Event are (they are written in one transaction). */
const SAME_DECISION_MS = 60_000;

type User = { id: string; role: UserRole; name: string };

export type SystemPageData = {
  view: SystemPageView;
  /** The System as read in the snapshot, for the permission checks and the tab sections the page builds. */
  system: NonNullable<Awaited<ReturnType<typeof readSystem>>>;
  /** The per-Framework Requirements, for the Requirements tab's existing view. */
  frameworkRequirements: SystemFrameworkRequirements[];
};

function readSystem(tx: Prisma.TransactionClient, user: User, id: string, where: Prisma.SystemWhereInput) {
  return tx.system.findFirst({ where: { id, ...where }, include: SYSTEM_INCLUDE });
}

/** The page's data, or null when the System doesn't exist or the user can't see it. */
export async function loadSystemPage(user: User, id: string, now = new Date()): Promise<SystemPageData | null> {
  return prisma.$transaction(
    async (tx) => {
      const system = await readSystem(tx, user, id, await visibleSystemsWhere(user, tx));
      if (!system) return null;

      // Sequential throughout: a transaction has one connection.
      const frameworkRequirements = await getSystemFrameworkRequirements(system, tx);
      const declaredScopes = await getSystemFrameworkScopes(system.id, tx);

      // The Controls that apply, each with the status it is judged by (own, or inherited).
      const applicable = await getApplicableControls(system, {}, tx);
      const assessments = await tx.controlAssessment.findMany({
        where: { systemId: system.id },
        select: { controlId: true, status: true, assessedById: true },
      });
      const assessmentByControl = new Map(assessments.map((assessment) => [assessment.controlId, assessment]));
      const organizationStatuses = await loadOrganizationStatuses(
        applicable.filter((control) => control.applicability === "BOTH").map((control) => control.id),
        tx,
      );
      const providerSources = (await loadProviderSources([system.id], applicable.map((control) => control.id), tx)).get(system.id);
      const controls = applicable.map((control) => {
        const own = assessmentByControl.get(control.id);
        const effective = resolveEffectiveStatus(
          own ? toOwnAssessment(own) : null,
          inheritanceSourcesFor(control, organizationStatuses.get(control.id), providerSources?.get(control.id)),
        );
        return { control, status: effective.status, source: sourceKeyOf(effective.source), providerId: effective.source.kind === "PROVIDER" ? effective.source.provider.id : null };
      });

      // Only a Draft can be submitted; the count is the route's own gate.
      const unaddressedMandatory = system.status === "DRAFT" ? (await getUnaddressedMandatoryControls(system, tx)).length : 0;
      const queries = await getActionableQueriesForSystem(user, system.id, tx);
      const risks = await tx.risk.findMany({
        where: { systemId: system.id },
        select: { id: true, title: true, severity: true, likelihood: true, status: true },
      });
      const providerCount = await tx.providerDependency.count({ where: { dependentId: system.id } });

      // The lifecycle: the latest Review Round, who submitted it, and the Review Steps the user may decide.
      const roundCount = await tx.reviewRound.count({ where: { systemId: system.id } });
      const latestRound = await tx.reviewRound.findFirst({ where: { systemId: system.id }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], select: { submittedAt: true } });
      const submitted = await tx.changeEvent.findFirst({
        where: { systemId: system.id, action: "SYSTEM_SUBMITTED" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { actorId: true },
      });
      const approved =
        system.status === "APPROVED"
          ? await tx.changeEvent.findFirst({
              where: { systemId: system.id, action: "APPROVAL_DECIDED" },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { createdAt: true },
            })
          : null;
      const current = system.status === "IN_REVIEW" ? await readCurrentSteps(tx, system.id) : null;
      const memberOf = current ? await memberGroupIds(user.id, tx) : [];
      const decidableSteps: DecisionStep[] = (current?.steps ?? [])
        .filter((step) => step.status === "OPEN" && userCanDecideStep(user, system.ownerId, memberOf, step.reviewGroupId))
        .map((step) => ({ reviewGroupId: step.reviewGroupId, name: step.name }));

      // Recent activity (the tile shows the newest few) and the Approval and activity tab's timeline show
      // all of this System's own Change Events, newest first.
      const events = await tx.changeEvent.findMany({
        where: { systemId: system.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const personIds = [
        ...new Set([...events.map((event) => event.actorId), ...(submitted ? [submitted.actorId] : [])].filter((actor) => actor !== SYSTEM_ACTOR && actor !== user.id)),
      ];
      const people = personIds.length === 0 ? [] : await tx.user.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } });
      const nameOf = new Map(people.map((person) => [person.id, person.name]));
      nameOf.set(user.id, user.name);

      // Approval decisions and Query actions are attributed to a step or a group, and only some viewers
      // see the person (CONTEXT.md, "A step decides as its group"). An Approval event is tied back to its
      // Approval (same System, same person, decided within a minute) and judged by `deciderVisibilityFor`,
      // the rule the Approval history uses. A Query event carries no attribution, so it can't be tied
      // back to its message: only the roles that always see people, and the System's owner for an owner's
      // own (named) action, see a name; everyone else sees "A reviewer".
      const canSeeDecider = await deciderVisibilityFor(user, system.ownerId, tx);
      const decisionActors = [...new Set(events.filter((event) => event.action === "APPROVAL_DECIDED").map((event) => event.actorId))].filter((actor) => actor !== SYSTEM_ACTOR);
      const approvals = decisionActors.length === 0 ? [] : await tx.approval.findMany({ where: { systemId: system.id, approverId: { in: decisionActors } }, select: { approverId: true, reviewGroupId: true, decidedAt: true } });
      const personFor = (event: (typeof events)[number]): string => {
        if (event.actorId === user.id) return "You";
        if (event.actorId === SYSTEM_ACTOR) return "The system";
        const named = nameOf.get(event.actorId) ?? "Someone";
        if (event.action === "APPROVAL_DECIDED") {
          const approval = approvals
            .filter((candidate) => candidate.approverId === event.actorId && Math.abs(candidate.decidedAt.getTime() - event.createdAt.getTime()) <= SAME_DECISION_MS)
            .sort((a, b) => Math.abs(a.decidedAt.getTime() - event.createdAt.getTime()) - Math.abs(b.decidedAt.getTime() - event.createdAt.getTime()))[0];
          const seen = approval ? canSeeDecider(approval) : ALWAYS_SEES_PEOPLE.includes(user.role);
          return seen ? named : event.detail.split(": ")[0];
        }
        if (QUERY_ACTIONS.includes(event.action)) {
          return ALWAYS_SEES_PEOPLE.includes(user.role) || event.actorId === system.ownerId ? named : "A reviewer";
        }
        return named;
      };
      const timeline = events.map(
        (event): ActivityItem => ({
          id: event.id,
          who: personFor(event),
          what: CHANGE_EVENT_ACTION_LABEL[event.action],
          detail: event.detail,
          tone: CHANGE_EVENT_ACTION_TONE[event.action],
          at: event.createdAt.toISOString(),
        }),
      );
      const activity = timeline.slice(0, ACTIVITY_TILE_SIZE);
      // A System created before `SYSTEM_CREATED` existed has no such event (no backfill): its timeline ends in a
      // "Created" entry from `createdAt`, without an actor.
      const createdEntry: TimelineItem[] = events.some((event) => event.action === "SYSTEM_CREATED")
        ? []
        : [{ id: "created", who: null, what: CHANGE_EVENT_ACTION_LABEL.SYSTEM_CREATED, detail: "", tone: CHANGE_EVENT_ACTION_TONE.SYSTEM_CREATED, at: system.createdAt.toISOString() }];

      const frameworks = frameworkRequirements.map(
        (entry): FrameworkSummary => ({
          id: entry.framework.id,
          label: frameworkLabel(entry.framework),
          isBase: entry.framework.isBase,
          met: entry.counts.MET,
          partial: entry.counts.PARTIALLY_MET,
          notMet: entry.counts.NOT_MET,
          notApplicable: entry.counts.NOT_APPLICABLE,
          applicable: entry.counts.applicable,
        }),
      );
      // The base Framework first, as the Systems list and Home measure against it.
      frameworks.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.label.localeCompare(b.label));
      const base = frameworks.find((framework) => framework.isBase) ?? null;

      const byStatus = Object.fromEntries(CONTROL_STATUS_ORDER.map((status) => [status, 0])) as Record<ControlAssessmentStatus, number>;
      const bySource = Object.fromEntries(SOURCE_KEYS.map((key) => [key, 0])) as Record<SourceKey, number>;
      const byProvider: Record<string, number> = {};
      for (const { status, source, providerId } of controls) {
        byStatus[status] += 1;
        bySource[source] += 1;
        if (providerId !== null) byProvider[providerId] = (byProvider[providerId] ?? 0) + 1;
      }
      const done = controls.filter(({ status }) => controlIsDone(status)).length;
      const openRisks = risks.filter((risk) => risk.status === "OPEN").length;

      const view: SystemPageView = {
        userId: user.id,
        userName: user.name,
        role: user.role,
        now: now.toISOString(),
        system: {
          id: system.id,
          name: system.name,
          vendor: system.vendor,
          description: system.description,
          status: system.status,
          isProvider: system.isProvider,
          ownerId: system.ownerId,
          ownerName: system.owner.name,
          facets: [...system.deploymentFacets].sort((a, b) => a.name.localeCompare(b.name)).map((facet) => ({ id: facet.id, name: facet.name })),
          confidentiality: system.confidentialityImpactLevel,
          integrity: system.integrityImpactLevel,
          availability: system.availabilityImpactLevel,
          createdAt: system.createdAt.toISOString(),
          onboardedAt: system.onboardedAt?.toISOString() ?? null,
        },
        note: lifecycleNote({
          status: system.status,
          ownerName: system.owner.name,
          submittedAt: latestRound?.submittedAt.toISOString() ?? null,
          submittedBy: submitted ? (nameOf.get(submitted.actorId) ?? (submitted.actorId === SYSTEM_ACTOR ? null : "someone")) : null,
          approvedAt: approved?.createdAt.toISOString() ?? null,
          onboardedAt: system.onboardedAt?.toISOString() ?? null,
          hasEarlierRound: roundCount > 0,
          stepsApproved: current?.steps.filter((step) => step.status === "APPROVED").length ?? 0,
          stepsTotal: current?.steps.length ?? 0,
        }),
        nextStep: nextStepFor({
          status: system.status,
          canSubmit: canSubmit(user, system),
          canMarkOnboarded: canMarkOnboarded(user, system),
          decidableSteps,
          unaddressedMandatory,
        }),
        canChangeOwner: canChangeOwner(user, system),
        headline: {
          baseFramework: base?.label ?? null,
          met: base?.met ?? 0,
          applicable: base?.applicable ?? 0,
          controlsDone: done,
          controlsTotal: controls.length,
          openRisks,
        },
        frameworks,
        controls: { total: controls.length, done, byStatus, bySource, byProvider },
        attention: buildAttention({
          queries,
          controls: controls.map(({ control, status, source }) => ({ id: control.id, code: control.code, title: control.title, mandatory: control.mandatory, status, source })),
          risks,
        }),
        risks: {
          grid: riskGridOf(risks),
          open: openRisks,
          mitigated: risks.filter((risk) => risk.status === "MITIGATED").length,
          accepted: risks.filter((risk) => risk.status === "ACCEPTED").length,
        },
        classification: {
          facets: system.deploymentFacets.map((facet) => facet.name).sort((a, b) => a.localeCompare(b)),
          businessUnits: system.businessUnits.map((unit) => unit.name),
          frameworkScope: declaredScopes.map((framework) => frameworkLabel(framework)),
        },
        activity,
        timeline: [...timeline, ...createdEntry],
        counts: { controls: controls.length, requirements: frameworks.length, openRisks, providers: providerCount },
        controlList: controls.map(({ control }) => ({ id: control.id, code: control.code, title: control.title })),
      };
      return { view, system, frameworkRequirements };
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}
