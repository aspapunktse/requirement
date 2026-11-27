/**
 * A Risk's remediation (#456): a deadline and planned milestones. The deadline is edited on the Risk itself (the PATCH routes);
 * this module holds the calendar-date validation both use, and the milestone writes shared by the System Risk routes and the
 * Organization Risk routes. Who may edit is the caller's check: the same people as for changing the Risk's status (a Risk Owner
 * or an Admin, `ROLES_ALLOWED_TO_MANAGE_RISK_STATUS`). A milestone belongs to one Risk and is found through it, so a milestone
 * of another Risk or System is "not found". A completed milestone is a record that something was done: it is never deleted.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { RISK_INCLUDE } from "@/lib/risks";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date as `YYYY-MM-DD` that exists (not 2026-02-30). */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Not a calendar date");

/** The UTC-midnight Date of a `YYYY-MM-DD` string (the column is a calendar date, so the time is never read). */
export const toCalendarDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const title = z.string().trim().min(1).max(300);

export const createMilestoneSchema = z.object({ title, plannedDate: calendarDate });

export const updateMilestoneSchema = z
  .object({
    title: title.optional(),
    plannedDate: calendarDate.optional(),
    /** Marks the milestone completed on that date; null reopens it. */
    completedDate: calendarDate.nullable().optional(),
  })
  .refine((body) => body.title !== undefined || body.plannedDate !== undefined || body.completedDate !== undefined, "Nothing to change");

/** A milestone is done when it is done, not planned: its completed date can't be later than tomorrow (UTC, for time zones ahead of it). */
export function completedDateInFuture(value: string, now: Date = new Date()): boolean {
  return toCalendarDate(value).getTime() > toCalendarDate(now.toISOString().slice(0, 10)).getTime() + DAY_MS;
}

/** The Risk a milestone route acts on: on this System, or (`systemId: null`) an Organization Risk. */
export type RiskScope = { riskId: string; systemId: string | null };

export type MilestoneResult = { kind: "ok"; risk: Awaited<ReturnType<typeof loadRisk>> } | { kind: "not-found" } | { kind: "completed" };

function loadRisk(riskId: string) {
  return prisma.risk.findUniqueOrThrow({ where: { id: riskId }, include: RISK_INCLUDE });
}

export async function createMilestone(scope: RiskScope, input: z.infer<typeof createMilestoneSchema>): Promise<MilestoneResult> {
  const risk = await prisma.risk.findFirst({ where: { id: scope.riskId, systemId: scope.systemId }, select: { id: true } });
  if (!risk) return { kind: "not-found" };
  await prisma.riskMilestone.create({ data: { riskId: risk.id, title: input.title, plannedDate: toCalendarDate(input.plannedDate) } });
  return { kind: "ok", risk: await loadRisk(risk.id) };
}

export async function updateMilestone(scope: RiskScope, milestoneId: string, input: z.infer<typeof updateMilestoneSchema>): Promise<MilestoneResult> {
  const { count } = await prisma.riskMilestone.updateMany({
    where: { id: milestoneId, risk: { id: scope.riskId, systemId: scope.systemId } },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.plannedDate !== undefined && { plannedDate: toCalendarDate(input.plannedDate) }),
      ...(input.completedDate !== undefined && { completedDate: input.completedDate === null ? null : toCalendarDate(input.completedDate) }),
    },
  });
  if (count === 0) return { kind: "not-found" };
  return { kind: "ok", risk: await loadRisk(scope.riskId) };
}

/** Deletes a milestone that is not completed. The delete itself is conditional on that, so a concurrent completion can't be undone by it. */
export async function deleteMilestone(scope: RiskScope, milestoneId: string): Promise<MilestoneResult> {
  const { count } = await prisma.riskMilestone.deleteMany({
    where: { id: milestoneId, completedDate: null, risk: { id: scope.riskId, systemId: scope.systemId } },
  });
  if (count === 0) {
    const exists = await prisma.riskMilestone.findFirst({ where: { id: milestoneId, risk: { id: scope.riskId, systemId: scope.systemId } }, select: { id: true } });
    return exists ? { kind: "completed" } : { kind: "not-found" };
  }
  return { kind: "ok", risk: await loadRisk(scope.riskId) };
}
