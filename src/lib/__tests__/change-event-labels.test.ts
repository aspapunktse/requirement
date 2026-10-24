import { describe, expect, it } from "vitest";
import { ChangeEventAction } from "@prisma/client";
import { CHANGE_EVENT_ACTION_LABEL, CHANGE_EVENT_ACTION_TONE } from "../change-event-labels";

describe("Change Event labels for the Home page's Recent activity (#226)", () => {
  it("has a human label and a tone for every ChangeEventAction", () => {
    const actions = Object.values(ChangeEventAction);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      const label = CHANGE_EVENT_ACTION_LABEL[action];
      expect(label, action).toBeTruthy();
      // A phrase for people, never the enum name.
      expect(label, action).not.toMatch(/_/);
      expect(label, action).toBe(label.trim());
      expect(CHANGE_EVENT_ACTION_TONE[action], action).toBeTruthy();
    }
  });

  it("labels the actions that once had none", () => {
    for (const action of ["APPLICABILITY_RECOMPUTED", "ASSESSMENT_REMOVED", "ORGANIZATION_IMPLEMENTATION_CHANGED", "CONTROL_OFFERING_CHANGED"] as const) {
      expect(CHANGE_EVENT_ACTION_LABEL[action]).toMatch(/[a-z] [a-z]/);
    }
  });

  it("has no label for a value the enum lacks", () => {
    expect(Object.keys(CHANGE_EVENT_ACTION_LABEL).sort()).toEqual([...Object.values(ChangeEventAction)].sort());
  });
});
