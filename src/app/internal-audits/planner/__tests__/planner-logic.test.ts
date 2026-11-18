import { describe, expect, it } from "vitest";
import { addDays, daysUntil, endOfQuarter, isoDay, lastAuditedLabel, QUICK_DUES, suggestedTitle, workingDaysUntil } from "../planner-logic";

// Wednesday 18 November 2026, local time.
const today = new Date(2026, 10, 18, 9, 30);

describe("planner logic (#393)", () => {
  it("writes a local calendar day", () => {
    expect(isoDay(today)).toBe("2026-11-18");
    expect(addDays(today, 14)).toBe("2026-12-02");
    expect(addDays(today, 42)).toBe("2026-12-30");
  });

  it("offers the quick due dates", () => {
    expect(Object.fromEntries(QUICK_DUES.map((q) => [q.label, q.date(today)]))).toEqual({
      "2 weeks": "2026-12-02",
      "30 days": "2026-12-18",
      "6 weeks": "2026-12-30",
      "End of quarter": "2026-12-31",
    });
    expect(endOfQuarter(new Date(2026, 0, 5))).toBe("2026-03-31");
    expect(endOfQuarter(new Date(2026, 5, 30))).toBe("2026-06-30");
  });

  it("counts calendar days, negative in the past and null without a valid date", () => {
    expect(daysUntil("2026-11-18", today)).toBe(0);
    expect(daysUntil("2026-11-25", today)).toBe(7);
    expect(daysUntil("2026-11-10", today)).toBe(-8);
    expect(daysUntil("", today)).toBeNull();
    expect(daysUntil("2026-02-30", today)).toBeNull();
  });

  it("counts working days after today up to the due date, weekends excluded", () => {
    expect(workingDaysUntil("2026-11-19", today)).toBe(1); // Thursday
    expect(workingDaysUntil("2026-11-20", today)).toBe(2); // Friday
    expect(workingDaysUntil("2026-11-22", today)).toBe(2); // Sunday adds nothing
    expect(workingDaysUntil("2026-11-25", today)).toBe(5); // next Wednesday
    expect(workingDaysUntil("2026-12-02", today)).toBe(10); // 2 weeks
    expect(workingDaysUntil("2026-11-18", today)).toBe(0);
    expect(workingDaysUntil("2026-11-01", today)).toBe(0);
  });

  it("labels when a Control was last audited", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(lastAuditedLabel(null, now)).toBe("Never audited");
    expect(lastAuditedLabel("2026-11-02T00:00:00Z", now)).toBe("Audited this month");
    expect(lastAuditedLabel("2026-06-18T00:00:00Z", now)).toBe("Audited 5 mo ago");
    expect(lastAuditedLabel("2025-08-18T00:00:00Z", now)).toBe("Audited 1 y 3 mo ago");
    expect(lastAuditedLabel("2024-11-18T00:00:00Z", now)).toBe("Audited 2 y ago");
  });

  it("suggests a title once a Control is picked", () => {
    expect(suggestedTitle(today, [], null)).toBeNull();
    expect(suggestedTitle(today, [{ code: "A-1", title: "Access" }], null)).toBe("Q4 2026 · Access");
    expect(suggestedTitle(today, [{ code: "A-1", title: "Access" }, { code: "A-2", title: "Backup" }], null)).toBe("Q4 2026 · 2 Controls");
    expect(suggestedTitle(today, [{ code: "A-1", title: "Access" }], "Not audited in 12 months")).toBe("Q4 2026 · Not audited in 12 months");
  });
});
