/**
 * The Plan of Action and Milestones of an OSCAL Package (#456, PRD #440): the System's open work on its Risks. Pure: plain rows in,
 * plain objects out (the loader in `package-builder.ts` reads the rows).
 *
 * Mapping (product owner decisions on #456 are final; ADR 0017 for identifiers, ADR 0019 for the status history):
 * - Only OPEN and ACCEPTED Risks are POA&M items (`poam-items`, one per Risk, `related-risks` to it). A Mitigated, Closed or
 *   Transferred Risk is not work to plan, so it is left out. When there is no such Risk the System has no POA&M: OSCAL requires at
 *   least one item, and an empty plan would claim something the app does not.
 * - `risks[]` use the same uuid as the SSP and the Assessment Results (`oscalUuid("Risk", id)`) and the shared status mapping
 *   (`oscalRiskStatus`); the app's own status is the `risk-status` prop. `deadline` is the Risk's deadline (a calendar date, end
 *   of that day in UTC).
 * - `remediations[]`: one response per Risk with a mitigation plan or milestones, `oscalUuid("Remediation", id)` like the
 *   Assessment Results. Each milestone is a `milestone` task timed on its planned date; `lifecycle` is `completed` when the Risk has
 *   milestones and all are completed, else `planned`. A milestone's completion date is a prop.
 * - `risk-log.entries[]`: one per row of the Risk's status history, oldest first. `status-change` is the mapped OSCAL status, the app's
 *   own from and to statuses are props, and `logged-by` names the person who made the change when the app knows them. A Risk older
 *   than the history has no entries.
 * - A Risk that came from a Check-up finding already in the Assessment Results links that finding and its observations, which
 *   are copied with the same uuids.
 */
import type { RiskStatus } from "@prisma/client";
import { OSCAL_APP_NS, oscalUuid, type DocumentKind } from "@/lib/oscal/ids";
import { oscalRiskStatus } from "@/lib/oscal/risk-status";
import type { AuditPerson, OscalRisk } from "@/lib/oscal/assessment-builder";

type Json = Record<string, unknown>;

/** The Risk statuses that are POA&M items. */
export const POAM_STATUSES: RiskStatus[] = ["OPEN", "ACCEPTED"];

/** One Risk with its deadline, milestones and status history, as the POA&M needs it. */
export type OscalPoamRisk = OscalRisk & {
  /** A calendar date (UTC midnight), or null. */
  deadline: Date | null;
  milestones: { id: string; title: string; plannedDate: Date; completedDate: Date | null }[];
  /** The Risk's status history, oldest first. `actor` is null when the app did not record a person. */
  history: { id: string; changedAt: Date; fromStatus: string | null; toStatus: string; actor: { id: string; name: string } | null }[];
};

export const POAM_ROLE = { statusChanger: { id: "risk-status-changer", title: "Person who changed a Risk's status" } } as const;

/** The AR's file name convention; the POA&M imports the package's SSP. */
export const POAM_SSP_HREF = "ssp.json";

const prop = (name: string, value: string) => ({ name, ns: OSCAL_APP_NS, value });
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** A calendar date as the end of that day in UTC, the date-time OSCAL wants. */
const endOfDay = (d: Date) => `${dayOf(d)}T23:59:59Z`;
const STATUS_LABEL: Record<string, string> = { OPEN: "Open", MITIGATED: "Mitigated", ACCEPTED: "Accepted", TRANSFERRED: "Transferred", CLOSED: "Closed" };
const label = (status: string) => STATUS_LABEL[status] ?? status;

export type PoamContext = {
  system: { id: string; name: string };
  /** Every Risk of the System that may be an item; the builder keeps OPEN and ACCEPTED only. */
  risks: OscalPoamRisk[];
  /** The Assessment Results' finding and observations of each Check-up (by Check-up id), when the package has them. */
  linked: Map<string, { finding: Json; observations: Json[] }>;
  /** The people the linked findings and observations name (they must be parties of this document). */
  linkedPeople: AuditPerson[];
  exporter: AuditPerson[];
  newUuid: () => string;
  metadata: (title: string, kind: DocumentKind, subjectId: string, people: AuditPerson[]) => Json;
};

/** The POA&M, or null when the System has no OPEN or ACCEPTED Risk. */
export function buildPoam(ctx: PoamContext) {
  const items = ctx.risks.filter((r) => POAM_STATUSES.includes(r.status)).sort((a, b) => byText(a.id, b.id));
  if (items.length === 0) return null;
  const { system } = ctx;

  const people = new Map<string, AuditPerson>();
  const addPerson = (who: { id: string; name: string }, roles: { id: string; title: string }[]) => {
    const p = people.get(who.id) ?? { id: who.id, name: who.name, roles: [] };
    for (const r of roles) if (!p.roles.some((x) => x.id === r.id)) p.roles.push(r);
    people.set(who.id, p);
  };
  for (const p of [...ctx.exporter, ...ctx.linkedPeople]) addPerson(p, p.roles);

  const findings = new Map<string, Json>();
  const observations = new Map<string, Json>();
  const poamRiskUuids = new Set(items.map((r) => oscalUuid("Risk", r.id)));

  const risks = items.map((r) => {
    const riskUuid = oscalUuid("Risk", r.id);
    const mapped = oscalRiskStatus(r.status);
    const linked = r.checkUpId ? ctx.linked.get(r.checkUpId) : undefined;
    if (linked) {
      const related = ((linked.finding["related-risks"] as { "risk-uuid": string }[] | undefined) ?? []).filter((x) => poamRiskUuids.has(x["risk-uuid"]));
      const { "related-risks": _dropped, ...rest } = linked.finding;
      void _dropped;
      findings.set(linked.finding.uuid as string, { ...rest, ...(related.length > 0 && { "related-risks": related }) });
      for (const o of linked.observations) observations.set(o.uuid as string, o);
    }

    const milestones = [...r.milestones].sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime() || byText(a.id, b.id));
    const remediation =
      milestones.length > 0 || r.mitigationPlan?.trim()
        ? [
            {
              uuid: oscalUuid("Remediation", r.id),
              lifecycle: milestones.length > 0 && milestones.every((m) => m.completedDate !== null) ? "completed" : "planned",
              title: "Mitigation plan",
              description: r.mitigationPlan?.trim() || "Milestones of the Risk's remediation.",
              ...(milestones.length > 0 && {
                tasks: milestones.map((m) => ({
                  uuid: oscalUuid("Milestone", m.id),
                  type: "milestone",
                  title: m.title,
                  props: [prop("milestone-status", m.completedDate ? "completed" : "planned"), ...(m.completedDate ? [prop("completed-date", dayOf(m.completedDate))] : [])],
                  timing: { "on-date": { date: endOfDay(m.plannedDate) } },
                })),
              }),
            },
          ]
        : undefined;

    const entries = r.history.map((h) => {
      if (h.actor) addPerson(h.actor, [POAM_ROLE.statusChanger]);
      const to = oscalRiskStatus(h.toStatus as RiskStatus);
      return {
        uuid: oscalUuid("RiskLogEntry", h.id),
        title: h.fromStatus === null ? `Risk created as ${label(h.toStatus)}` : `Status changed from ${label(h.fromStatus)} to ${label(h.toStatus)}`,
        start: h.changedAt.toISOString(),
        props: [...(h.fromStatus === null ? [] : [prop("from-status", h.fromStatus)]), prop("to-status", h.toStatus), ...to.props],
        ...(h.actor && { "logged-by": [{ "party-uuid": oscalUuid("User", h.actor.id), "role-id": POAM_ROLE.statusChanger.id }] }),
        "status-change": to.state,
      };
    });

    return {
      uuid: riskUuid,
      title: r.title,
      description: r.description.trim() || r.title,
      statement: r.description.trim() || r.title,
      props: [prop("risk-status", r.status), prop("risk-source", r.source), prop("severity", r.severity), prop("likelihood", r.likelihood), ...mapped.props],
      status: mapped.state,
      ...(r.deadline && { deadline: endOfDay(r.deadline) }),
      ...(remediation && { remediations: remediation }),
      ...(entries.length > 0 && { "risk-log": { entries } }),
      ...(linked && linked.observations.length > 0 && { "related-observations": linked.observations.map((o) => ({ "observation-uuid": o.uuid as string })) }),
    };
  });

  const poamItems = items.map((r) => {
    const linked = r.checkUpId ? ctx.linked.get(r.checkUpId) : undefined;
    return {
      uuid: oscalUuid("PoamItem", r.id),
      title: r.title,
      description: r.description.trim() || r.title,
      props: [prop("risk-status", r.status)],
      ...(linked && { "related-findings": [{ "finding-uuid": linked.finding.uuid as string }] }),
      ...(linked && linked.observations.length > 0 && { "related-observations": linked.observations.map((o) => ({ "observation-uuid": o.uuid as string })) }),
      "related-risks": [{ "risk-uuid": oscalUuid("Risk", r.id) }],
    };
  });

  return {
    "plan-of-action-and-milestones": {
      uuid: ctx.newUuid(),
      metadata: ctx.metadata(`Plan of Action and Milestones of ${system.name}`, "poam", system.id, [...people.values()]),
      "import-ssp": { href: POAM_SSP_HREF },
      "system-id": { "identifier-type": OSCAL_APP_NS, id: oscalUuid("System", system.id) },
      ...(observations.size > 0 && { observations: [...observations.values()] }),
      risks,
      ...(findings.size > 0 && { findings: [...findings.values()] }),
      "poam-items": poamItems,
    },
  };
}
