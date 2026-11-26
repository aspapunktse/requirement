import { describe, expect, it } from "vitest";
import { oscalRiskStatus } from "@/lib/oscal/risk-status";
import { OSCAL_APP_NS } from "@/lib/oscal/ids";

describe("oscalRiskStatus (#454, #456)", () => {
  it.each([
    ["OPEN", "open"],
    ["MITIGATED", "closed"],
    ["ACCEPTED", "deviation-approved"],
    ["TRANSFERRED", "deviation-approved"],
    ["CLOSED", "closed"],
  ] as const)("%s is %s", (status, state) => {
    expect(oscalRiskStatus(status).state).toBe(state);
  });

  it("only a Transferred Risk carries the transferred prop", () => {
    expect(oscalRiskStatus("TRANSFERRED").props).toEqual([{ name: "transferred", ns: OSCAL_APP_NS, value: "true" }]);
    for (const s of ["OPEN", "MITIGATED", "ACCEPTED", "CLOSED"] as const) expect(oscalRiskStatus(s).props).toEqual([]);
  });
});
