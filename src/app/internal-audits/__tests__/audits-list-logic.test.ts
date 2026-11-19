import { describe, expect, it } from "vitest";
import { dueLine } from "../audits-list-logic";

describe("dueLine (#398)", () => {
  it("says how far away the due date is, amber within 7 days and red once past", () => {
    expect(dueLine(30)).toEqual({ text: "Due in 30 days", urgency: null });
    expect(dueLine(8)).toEqual({ text: "Due in 8 days", urgency: null });
    expect(dueLine(7)).toEqual({ text: "Due in 7 days", urgency: "soon" });
    expect(dueLine(1)).toEqual({ text: "Due in 1 day", urgency: "soon" });
    expect(dueLine(0)).toEqual({ text: "Due today", urgency: "soon" });
    expect(dueLine(-1)).toEqual({ text: "1 day overdue", urgency: "late" });
    expect(dueLine(-12)).toEqual({ text: "12 days overdue", urgency: "late" });
    expect(dueLine(null)).toEqual({ text: "", urgency: null });
  });
});
