import { describe, expect, it } from "vitest";
import { canWriteJustifications, countStatementRows, deriveStatementRow, describeMetOn, matchesStatementFilter, worstStatus } from "@/lib/boundary-statement-rules";

const requirement = { id: "r", code: "A.1", section: "A", title: "T" };
const derive = (over: Partial<Parameters<typeof deriveStatementRow>[0]>) =>
  deriveStatementRow({ requirement, perSystem: [], visible: [], organizationStatus: null, organizationOnly: false, storedJustification: null, ...over });

describe("boundary statement rules (#420)", () => {
  it("takes the worst status: Not Met over Partially Met over Met", () => {
    expect(worstStatus([])).toBeNull();
    expect(worstStatus(["MET", "PARTIALLY_MET"])).toBe("PARTIALLY_MET");
    expect(worstStatus(["MET", "NOT_MET", "PARTIALLY_MET"])).toBe("NOT_MET");
  });

  it("includes a Requirement that applies to a System, with Met on x of y", () => {
    const included = derive({ perSystem: ["MET", "NOT_MET", "NOT_APPLICABLE"], visible: [0, 1, 2] });
    expect(included).toMatchObject({ included: true, worstStatus: "NOT_MET", metCount: 1, appliesToCount: 2, hiddenSystemCount: 0 });
    expect(describeMetOn(included)).toBe("Met on 1 of 2 Systems");
  });

  it("excludes one that applies to none and has no Organizational status, and keeps its text only then", () => {
    const missing = derive({ perSystem: ["NOT_APPLICABLE"], visible: [0], storedJustification: "  " });
    expect(missing).toMatchObject({ included: false, worstStatus: null, justification: null, justificationMissing: true });
    expect(derive({ perSystem: [], storedJustification: " Out " })).toMatchObject({ included: false, justification: "Out", justificationMissing: false });
    // A stored text on an included Requirement is not presented as a reason.
    expect(derive({ perSystem: ["MET"], visible: [0], storedJustification: "Stale" })).toMatchObject({ included: true, justification: null, justificationMissing: false });
  });

  it("includes a Requirement met by Organizational Controls with no counted System", () => {
    const row = derive({ organizationStatus: "PARTIALLY_MET", organizationOnly: true });
    expect(row).toMatchObject({ included: true, worstStatus: "PARTIALLY_MET", appliesToCount: 0 });
    expect(describeMetOn(row)).toBe("Organization only");
  });

  it("hides Systems the user may not see but counts them", () => {
    const row = derive({ perSystem: ["MET", "NOT_MET"], visible: [0, null] });
    expect(row.systemStatuses).toEqual([[0, "MET"]]);
    expect(row).toMatchObject({ hiddenSystemCount: 1, appliesToCount: 2 });
  });

  it("filters and counts", () => {
    const rows = [
      derive({ perSystem: ["NOT_MET"], visible: [0] }),
      derive({ perSystem: ["MET"], visible: [0] }),
      derive({ perSystem: [] }),
      derive({ perSystem: [], storedJustification: "x" }),
    ];
    expect(countStatementRows(rows)).toEqual({ all: 4, included: 2, excluded: 2, notMet: 1, missing: 1 });
    expect(matchesStatementFilter(rows[2], "MISSING")).toBe(true);
    expect(matchesStatementFilter(rows[0], "EXCLUDED")).toBe(false);
  });

  it("lets the Boundary Owner, a Compliance Manager and an Admin write", () => {
    const boundary = { boundaryOwnerId: "o" };
    expect(canWriteJustifications({ id: "x", role: "ADMIN" }, boundary)).toBe(true);
    expect(canWriteJustifications({ id: "x", role: "COMPLIANCE_MANAGER" }, boundary)).toBe(true);
    expect(canWriteJustifications({ id: "o", role: "SYSTEM_OWNER" }, boundary)).toBe(true);
    expect(canWriteJustifications({ id: "x", role: "SYSTEM_OWNER" }, boundary)).toBe(false);
    expect(canWriteJustifications({ id: "x", role: "INTERNAL_AUDITOR" }, { boundaryOwnerId: null })).toBe(false);
  });
});
