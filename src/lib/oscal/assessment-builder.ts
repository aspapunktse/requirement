/**
 * The assessment layer of an OSCAL Package (#454, PRD #440): an Assessment Plan and Assessment Results for one System and one
 * closed Internal Audit. Pure: plain rows in, plain objects out (the loader in `package-builder.ts` reads the rows).
 *
 * Mapping (product owner decisions on #454 are final; ADR 0017 for identifiers, every uuid is `oscalUuid(<record>, <ids>)`):
 * - Assessment Plan: `import-ssp` is `ssp.json` (the SSP of the same package); `reviewed-controls` are the Controls the audit
 *   made a Check-up for on this System; `assessment-subjects` is the System's component; one task runs from the launch date to
 *   the due date; each Check-up's questions are the steps of one activity.
 * - Assessment Results, result 1 (the audit): `start` = launch date, `end` = close date. A Check-up response is an observation
 *   (INTERVIEW, plus EXAMINE when it links evidence; origin = the responder). An evaluation is a finding on `<control>_smt`:
 *   Conforming is satisfied; Observation is satisfied plus an observation describing the weakness, linked from the finding;
 *   Nonconformity is not-satisfied and relates the Risk it opened. A withdrawn Check-up has no finding; its reason is an
 *   observation. `risks[]` holds the Risks the audit raised plus every Risk the SSP cites for a Waived Control, so each of those
 *   resolves (the SSP and these results are one package).
 * - Assessment Results, result 2 ("System Owner self-assessment", only when there is something to say): the System's recorded
 *   Self-Assessment answers as of the close date, as observations only. No finding is made from them: nobody judged them, and
 *   they are never merged with the audit's findings. The app keeps only the latest answer (no history), so an answer last
 *   changed after the close is left out rather than shown as if it were the answer at the close.
 */
import type { CheckUpAnswer, CheckUpOutcome, RiskSeverity, RiskSource, RiskStatus } from "@prisma/client";
import { controlId, OSCAL_APP_NS, oscalUuid, type DocumentKind } from "@/lib/oscal/ids";

type Json = Record<string, unknown>;
export type AuditPerson = { id: string; name: string; roles: { id: string; title: string }[] };
type Who = { id: string; name: string };

/** One Risk, as the assessment documents need it. */
export type OscalRisk = {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  likelihood: RiskSeverity;
  status: RiskStatus;
  source: RiskSource;
  mitigationPlan: string | null;
  /** The Check-up whose Nonconformity opened it; null for any other Risk. */
  checkUpId: string | null;
};

/** One Check-up of the audit on this System, with everything that was recorded on it. */
export type OscalAuditCheckUp = {
  id: string;
  controlId: string;
  questions: { id: string; position: number; text: string; guidance: string | null }[];
  response: {
    respondedAt: Date;
    respondedBy: Who;
    /** Already checked to be http(s) URLs. */
    evidenceLinks: string[];
    answers: { questionId: string; answer: CheckUpAnswer; description: string }[];
  } | null;
  evaluation: { outcome: CheckUpOutcome; comment: string; evaluatedAt: Date; evaluatedBy: Who } | null;
  withdrawal: { reason: string; withdrawnAt: Date; withdrawnBy: Who } | null;
};

/** The closed Internal Audit and what it recorded on one System. */
export type OscalAuditSnapshot = {
  id: string;
  title: string;
  scopeDescription: string;
  /** A calendar date (UTC). */
  dueDate: Date;
  launchedAt: Date;
  closedAt: Date;
  /** The audit's Check-ups on this System (never an Organization-level one). */
  checkUps: OscalAuditCheckUp[];
  /** The Risks the audit's Check-ups opened, and every Risk linked to one of the System's Control Assessments (the Waived Control's candidates). */
  risks: OscalRisk[];
  /** The System's Self-Assessment answers last recorded at or before `closedAt`. */
  selfAssessments: { assessmentId: string; controlId: string; answer: CheckUpAnswer; assessedAt: Date; assessedBy: Who | null; question: string | null }[];
};

export const AUDIT_ROLE = {
  responder: { id: "check-up-responder", title: "Check-up responder" },
  auditor: { id: "internal-auditor", title: "Internal Auditor" },
  selfAssessor: { id: "self-assessment-respondent", title: "Self-Assessment respondent" },
} as const;

/** The AR's file name for the plan it imports; the in-package convention of `validate.ts` is the same. */
export const ASSESSMENT_FILES = { plan: "assessment-plan.json", results: "assessment-results.json" } as const;

const prop = (name: string, value: string) => ({ name, ns: OSCAL_APP_NS, value });
const OUTCOME_LABEL: Record<CheckUpOutcome, string> = { CONFORMING: "Conforming", OBSERVATION: "Observation", NONCONFORMITY: "Nonconformity" };
const ANSWER_LABEL: Record<CheckUpAnswer, string> = { YES: "Yes", NO: "No", NA: "N/A" };
/**
 * Risk status to OSCAL `risk-status`. Product-owner decision still open (research doc, section 5): OPEN is open and CLOSED is
 * closed; Mitigated is not closed, so it is remediating; Accepted and Transferred are decisions to carry the risk, so
 * deviation-approved. The app's own status always travels as the `risk-status` prop.
 */
export const RISK_STATE: Record<RiskStatus, string> = {
  OPEN: "open",
  MITIGATED: "remediating",
  ACCEPTED: "deviation-approved",
  TRANSFERRED: "deviation-approved",
  CLOSED: "closed",
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type AssessmentContext = {
  audit: OscalAuditSnapshot;
  system: { id: string; name: string; owner: Who };
  controls: Map<string, { id: string; code: string; title: string }>;
  applicableControlIds: Set<string>;
  /** The Risks the SSP cites for Waived Controls (record ids): each must resolve to a risk in the results. */
  referencedRiskIds: Set<string>;
  exporter: AuditPerson[];
  newUuid: () => string;
  /** The package's document metadata, with `people` as its parties. */
  metadata: (title: string, kind: DocumentKind, subjectId: string, people: AuditPerson[]) => Json;
};

/** The two documents. */
export function buildAssessmentDocuments(ctx: AssessmentContext) {
  const { audit, system } = ctx;
  const systemUuid = oscalUuid("System", system.id);
  const subjectId = `${system.id}:${audit.id}`;
  const checkUps = audit.checkUps
    .filter((c) => ctx.controls.has(c.controlId))
    .sort((a, b) => byText(ctx.controls.get(a.controlId)!.code, ctx.controls.get(b.controlId)!.code) || byText(a.id, b.id));
  const control = (c: { controlId: string }) => ctx.controls.get(c.controlId)!;
  const statementId = (c: { controlId: string }) => `${controlId(control(c).code)}_smt`;

  const subjectRef = { "subject-uuid": systemUuid, type: "component" };
  const reviewedControls = (cs: { id: string; code: string }[], description: string) => ({
    description,
    "control-selections": [{ "include-controls": cs.map((c) => ({ "control-id": controlId(c.code), "statement-ids": [`${controlId(c.code)}_smt`] })) }],
  });

  // ---- Assessment Plan ----
  const activities = checkUps.map((c) => ({
    uuid: oscalUuid("Activity", c.id),
    title: `Check-up on ${control(c).code}: ${control(c).title}`,
    description: `The questions of the Check-up on Control ${control(c).code} for ${system.name}.`,
    ...(c.questions.length > 0 && {
      steps: [...c.questions]
        .sort((a, b) => a.position - b.position)
        .map((q) => ({
          uuid: oscalUuid("CheckUpQuestion", q.id),
          title: `Question ${q.position}`,
          description: q.text,
          ...(q.guidance?.trim() && { remarks: q.guidance.trim() }),
        })),
    }),
    "related-controls": reviewedControls([control(c)], `Control ${control(c).code}.`),
  }));
  const controlsReviewed = [...new Map(checkUps.map((c) => [control(c).id, control(c)])).values()];
  const dueEnd = new Date(audit.dueDate);
  dueEnd.setUTCHours(23, 59, 59, 0);
  const taskUuid = oscalUuid("Task", audit.id, system.id);

  const assessmentPlan = {
    "assessment-plan": {
      uuid: ctx.newUuid(),
      metadata: ctx.metadata(`Assessment Plan of ${audit.title} for ${system.name}`, "assessment-plan", subjectId, ctx.exporter),
      "import-ssp": { href: "ssp.json" },
      "local-definitions": { activities },
      "reviewed-controls": reviewedControls(controlsReviewed, `The Controls of the Internal Audit "${audit.title}" that have a Check-up on ${system.name}.`),
      "assessment-subjects": [{ type: "component", "include-subjects": [subjectRef] }],
      tasks: [
        {
          uuid: taskUuid,
          type: "action",
          title: audit.title,
          description: audit.scopeDescription.trim() || `Internal Audit "${audit.title}" of ${system.name}.`,
          props: [prop("internal-audit-due-date", audit.dueDate.toISOString().slice(0, 10))],
          timing: { "within-date-range": { start: audit.launchedAt.toISOString(), end: dueEnd.toISOString() } },
          "associated-activities": activities.map((a) => ({ "activity-uuid": a.uuid, subjects: [{ type: "component", "include-subjects": [subjectRef] }] })),
        },
      ],
    },
  };

  // ---- Assessment Results ----
  const people = new Map<string, AuditPerson>();
  const addPerson = (who: Who | null, role: { id: string; title: string }): string | null => {
    if (!who) return null;
    const p = people.get(who.id) ?? { id: who.id, name: who.name, roles: [] };
    if (!p.roles.some((r) => r.id === role.id)) p.roles.push(role);
    people.set(who.id, p);
    return oscalUuid("User", who.id);
  };
  for (const e of ctx.exporter) for (const r of e.roles) addPerson(e, r);
  const origins = (who: Who | null, role: { id: string; title: string }) => {
    const uuid = addPerson(who, role);
    return uuid ? [{ actors: [{ type: "party", "actor-uuid": uuid }] }] : undefined;
  };

  const observations: Json[] = [];
  const findings: Json[] = [];
  const riskById = new Map(audit.risks.map((r) => [r.id, r]));
  const raisedByAudit = audit.risks.filter((r) => r.checkUpId !== null && checkUps.some((c) => c.id === r.checkUpId));
  const risksOf = new Map<string, OscalRisk>(raisedByAudit.map((r) => [r.id, r]));
  for (const id of ctx.referencedRiskIds) {
    const r = riskById.get(id);
    if (r) risksOf.set(id, r);
  }
  const observationsOfCheckUp = new Map<string, string[]>();

  for (const c of checkUps) {
    const code = control(c).code;
    const mine: string[] = [];
    if (c.response) {
      const answers = new Map(c.response.answers.map((a) => [a.questionId, a]));
      const body = [...c.questions]
        .sort((a, b) => a.position - b.position)
        .map((q) => {
          const a = answers.get(q.id);
          return `${q.position}. ${q.text}\nAnswer: ${a ? ANSWER_LABEL[a.answer] : "not answered"}.${a?.description.trim() ? ` ${a.description.trim()}` : ""}`;
        })
        .join("\n\n");
      const uuid = oscalUuid("Observation", "response", c.id);
      mine.push(uuid);
      observations.push({
        uuid,
        title: `${code}: Check-up response`,
        description: body || "The response holds no answers.",
        props: [prop("observation-kind", "check-up-response")],
        methods: c.response.evidenceLinks.length > 0 ? ["INTERVIEW", "EXAMINE"] : ["INTERVIEW"],
        origins: origins(c.response.respondedBy, AUDIT_ROLE.responder),
        subjects: [subjectRef],
        ...(c.response.evidenceLinks.length > 0 && {
          "relevant-evidence": c.response.evidenceLinks.map((href) => ({ href, description: "Evidence link given with the Check-up response." })),
        }),
        collected: c.response.respondedAt.toISOString(),
      });
    }
    if (c.withdrawal) {
      observations.push({
        uuid: oscalUuid("Observation", "withdrawal", c.id),
        title: `${code}: Check-up withdrawn`,
        description: `The Internal Auditor withdrew this Check-up, so there is no finding for it. Reason: ${c.withdrawal.reason.trim()}`,
        props: [prop("observation-kind", "check-up-withdrawal"), prop("check-up-state", "withdrawn")],
        methods: ["UNKNOWN"],
        origins: origins(c.withdrawal.withdrawnBy, AUDIT_ROLE.auditor),
        subjects: [subjectRef],
        collected: c.withdrawal.withdrawnAt.toISOString(),
      });
    }
    const ev = c.evaluation;
    if (ev) {
      const related = [...mine];
      if (ev.outcome === "OBSERVATION") {
        const uuid = oscalUuid("Observation", "weakness", c.id);
        related.push(uuid);
        observations.push({
          uuid,
          title: `${code}: weakness noted`,
          description: ev.comment.trim() || "The Internal Auditor noted a weakness and left no comment.",
          props: [prop("observation-kind", "check-up-weakness")],
          methods: ["EXAMINE"],
          types: ["finding"],
          origins: origins(ev.evaluatedBy, AUDIT_ROLE.auditor),
          subjects: [subjectRef],
          collected: ev.evaluatedAt.toISOString(),
        });
      }
      const notSatisfied = ev.outcome === "NONCONFORMITY";
      const risk = [...risksOf.values()].find((r) => r.checkUpId === c.id);
      findings.push({
        uuid: oscalUuid("Finding", c.id),
        title: `${code}: ${OUTCOME_LABEL[ev.outcome]}`,
        description: ev.comment.trim() || `The Internal Auditor evaluated the Check-up on ${code} as ${OUTCOME_LABEL[ev.outcome]}.`,
        props: [prop("check-up-outcome", ev.outcome), prop("evaluated-at", ev.evaluatedAt.toISOString())],
        origins: origins(ev.evaluatedBy, AUDIT_ROLE.auditor),
        target: {
          type: "statement-id",
          "target-id": statementId(c),
          status: { state: notSatisfied ? "not-satisfied" : "satisfied", reason: ev.outcome === "CONFORMING" ? "pass" : notSatisfied ? "fail" : "other" },
        },
        ...(related.length > 0 && { "related-observations": related.map((u) => ({ "observation-uuid": u })) }),
        ...(risk && { "related-risks": [{ "risk-uuid": oscalUuid("Risk", risk.id) }] }),
      });
    }
    observationsOfCheckUp.set(c.id, mine);
  }

  const risks = [...risksOf.values()]
    .sort((a, b) => byText(a.id, b.id))
    .map((r) => {
      const related = r.checkUpId ? (observationsOfCheckUp.get(r.checkUpId) ?? []) : [];
      return {
      uuid: oscalUuid("Risk", r.id),
      title: r.title,
      description: r.description,
      statement: r.description,
      props: [prop("risk-status", r.status), prop("risk-source", r.source), prop("severity", r.severity), prop("likelihood", r.likelihood)],
      status: RISK_STATE[r.status],
      ...(related.length > 0 && { "related-observations": related.map((u) => ({ "observation-uuid": u })) }),
      ...(r.mitigationPlan?.trim() && {
        remediations: [{ uuid: oscalUuid("Remediation", r.id), lifecycle: "planned", title: "Mitigation plan", description: r.mitigationPlan.trim() }],
      }),
    };
    });

  const auditResult = {
    uuid: oscalUuid("AssessmentResult", audit.id, system.id),
    title: `Internal Audit: ${audit.title}`,
    description: audit.scopeDescription.trim() || `Internal Audit "${audit.title}" of ${system.name}, from launch to close.`,
    start: audit.launchedAt.toISOString(),
    end: audit.closedAt.toISOString(),
    props: [prop("result-kind", "internal-audit")],
    "reviewed-controls": reviewedControls(controlsReviewed, `The Controls with a Check-up on ${system.name}.`),
    ...(observations.length > 0 && { observations }),
    ...(risks.length > 0 && { risks }),
    ...(findings.length > 0 && { findings }),
  };

  const selfAnswers = audit.selfAssessments
    .filter((a) => ctx.controls.has(a.controlId) && ctx.applicableControlIds.has(a.controlId))
    .sort((a, b) => byText(ctx.controls.get(a.controlId)!.code, ctx.controls.get(b.controlId)!.code));
  const selfControls = [...new Map(selfAnswers.map((a) => [a.controlId, ctx.controls.get(a.controlId)!])).values()];
  const selfResult =
    selfAnswers.length === 0
      ? null
      : {
          uuid: oscalUuid("AssessmentResult", "self-assessment", audit.id, system.id),
          title: "System Owner self-assessment",
          description: `The Self-Assessment answers recorded for ${system.name} as of the close of "${audit.title}". Self-reported: no Internal Auditor evaluated them, so no finding is made from them.`,
          start: audit.closedAt.toISOString(),
          end: audit.closedAt.toISOString(),
          props: [prop("result-kind", "self-assessment")],
          "reviewed-controls": reviewedControls(selfControls, `The Controls of ${system.name} with a recorded Self-Assessment answer.`),
          observations: selfAnswers.map((a) => ({
            uuid: oscalUuid("Observation", "self-assessment", a.assessmentId),
            title: `${ctx.controls.get(a.controlId)!.code}: Self-Assessment answer`,
            description: `${a.question?.trim() ? `${a.question.trim()}\n\n` : ""}Answer: ${ANSWER_LABEL[a.answer]}.`,
            props: [prop("observation-kind", "self-assessment-answer")],
            methods: ["INTERVIEW"],
            origins: origins(a.assessedBy ?? system.owner, AUDIT_ROLE.selfAssessor),
            subjects: [subjectRef],
            collected: a.assessedAt.toISOString(),
          })),
        };

  const assessmentResults = {
    "assessment-results": {
      uuid: ctx.newUuid(),
      metadata: ctx.metadata(`Assessment Results of ${audit.title} for ${system.name}`, "assessment-results", subjectId, [...people.values()]),
      "import-ap": { href: ASSESSMENT_FILES.plan },
      results: selfResult ? [auditResult, selfResult] : [auditResult],
    },
  };

  return { assessmentPlan, assessmentResults };
}
