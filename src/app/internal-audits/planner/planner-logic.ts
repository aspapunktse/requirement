/**
 * Pure helpers of the audit planner (#393): the quick due dates, the working days left, how a Control's
 * **last audited** date reads, and the suggested title. Prisma-free and given `today` explicitly so they test
 * without a clock. Dates are the browser's local calendar days, as "YYYY-MM-DD" like the due date field.
 * What a launch would generate is NOT here: that is `planLaunch`, behind `POST /api/internal-audits/preview`.
 */

/** Fewer working days than this left, and the planner warns that the due date is tight. */
export const TIGHT_WORKING_DAYS = 10;

const pad = (n: number) => String(n).padStart(2, "0");

/** A local calendar day as "YYYY-MM-DD". */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoDay(date) === value ? date : null;
}

export function addDays(today: Date, days: number): string {
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  return isoDay(date);
}

export function endOfQuarter(today: Date): string {
  const quarter = Math.floor(today.getMonth() / 3);
  return isoDay(new Date(today.getFullYear(), quarter * 3 + 3, 0));
}

/** The quick picks beside the due date field. */
export const QUICK_DUES: { label: string; date: (today: Date) => string }[] = [
  { label: "2 weeks", date: (today) => addDays(today, 14) },
  { label: "30 days", date: (today) => addDays(today, 30) },
  { label: "6 weeks", date: (today) => addDays(today, 42) },
  { label: "End of quarter", date: endOfQuarter },
];

/** Whole calendar days from `today` to `dueDate`, or null when there is no valid date. Negative in the past. */
export function daysUntil(dueDate: string, today: Date): number | null {
  const due = parseDay(dueDate);
  if (!due) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

/** Working days the recipients have: weekdays after today up to and including the due date. No holidays. 0 for a past or missing date. */
export function workingDaysUntil(dueDate: string, today: Date): number {
  const days = daysUntil(dueDate, today);
  if (days === null || days <= 0) return 0;
  let count = 0;
  for (let i = 1; i <= days; i += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i).getDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function formatDay(value: string): string {
  const date = parseDay(value);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** Whole months between two instants (UTC calendar), never negative. */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return Math.max(0, to.getUTCDate() < from.getUTCDate() ? months - 1 : months);
}

/** "Never audited", "Audited 5 mo ago", "Audited 1 y 3 mo ago". */
export function lastAuditedLabel(lastAudited: string | null, now: Date): string {
  if (lastAudited === null) return "Never audited";
  const months = monthsBetween(new Date(lastAudited), now);
  if (months < 1) return "Audited this month";
  if (months < 12) return `Audited ${months} mo ago`;
  const rest = months % 12;
  return `Audited ${Math.floor(months / 12)} y ${rest ? `${rest} mo ` : ""}ago`;
}

export function quarterName(today: Date): string {
  return `Q${Math.floor(today.getMonth() / 3) + 1} ${today.getFullYear()}`;
}

/** The title offered while the field is empty: "Q4 2026 · <what was started from>". Null until a Control is picked. */
export function suggestedTitle(today: Date, picked: { code: string; title: string }[], startedFrom: string | null): string | null {
  if (picked.length === 0) return null;
  const what = startedFrom ?? (picked.length === 1 ? picked[0].title : `${picked.length} Controls`);
  return `${quarterName(today)} · ${what}`;
}

/** The local calendar day "YYYY-MM-DD" as a local-midnight Date, or null if it isn't a real day. */
export function dayToDate(value: string): Date | null {
  return parseDay(value);
}

/** The instant the server rules see for a local calendar day: that day at UTC midnight (`isDueForAudit` reads UTC days). */
export function dayAsUtc(today: Date): Date {
  return new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
}
