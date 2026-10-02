import { describe, expect, it } from "vitest";
import type { ControlOfferingType, UserRole } from "@prisma/client";
import {
  canManageProvider,
  controlOfferingRefusal,
  describeOfferingAdded,
  describeOfferingChanged,
  describeOfferingRemoved,
  describeProviderMarked,
  offeringValuesDiffer,
  resultingOfferingValues,
  storedCustomerResponsibility,
  type OfferingValues,
} from "../control-offering-rules";

const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
];

describe("canManageProvider (#123)", () => {
  const system = { ownerId: "owner-1" };

  it.each(ALL_ROLES.filter((role) => role !== "COMPLIANCE_MANAGER"))("lets a %s who owns the System manage it", (role) => {
    expect(canManageProvider({ id: "owner-1", role }, system)).toBe(true);
  });

  it("lets an Admin manage any System", () => {
    expect(canManageProvider({ id: "someone", role: "ADMIN" }, system)).toBe(true);
  });

  it.each(ALL_ROLES.filter((role) => role !== "ADMIN"))("refuses a %s who does not own the System", (role) => {
    expect(canManageProvider({ id: "someone", role }, system)).toBe(false);
  });

  it("refuses a Compliance Manager even if recorded as the owner", () => {
    expect(canManageProvider({ id: "owner-1", role: "COMPLIANCE_MANAGER" }, system)).toBe(false);
  });
});

describe("controlOfferingRefusal", () => {
  const cases: [string, ControlOfferingType, string | null | undefined, boolean][] = [
    ["Shared with a text", "SHARED", "The tenant manages its keys", false],
    ["Shared without a text", "SHARED", undefined, true],
    ["Shared with a null text", "SHARED", null, true],
    ["Shared with an empty text", "SHARED", "", true],
    ["Shared with a blank text", "SHARED", "  \n\t ", true],
    ["Full without a text", "FULL", null, false],
    ["Full with a text (it is cleared, not refused)", "FULL", "ignored", false],
    ["Full with a blank text", "FULL", " ", false],
  ];

  it.each(cases)("%s", (_name, type, text, refused) => {
    const refusal = controlOfferingRefusal(type, text);
    if (refused) expect(refusal).toMatch(/customer responsibility/);
    else expect(refusal).toBeNull();
  });
});

describe("storedCustomerResponsibility", () => {
  it.each<[ControlOfferingType, string | null | undefined, string | null]>([
    ["FULL", null, null],
    ["FULL", "some text", null],
    ["SHARED", "  trimmed  ", "trimmed"],
    ["SHARED", "text", "text"],
    ["SHARED", "   ", null],
    ["SHARED", undefined, null],
  ])("%s with %j stores %j", (type, text, stored) => {
    expect(storedCustomerResponsibility(type, text)).toBe(stored);
  });
});

describe("resultingOfferingValues: the rule is judged on the values the Offering would have", () => {
  const shared: OfferingValues = { type: "SHARED", customerResponsibility: "Tenant manages keys" };
  const full: OfferingValues = { type: "FULL", customerResponsibility: null };

  const table: [string, OfferingValues | null, Parameters<typeof resultingOfferingValues>[1], OfferingValues, boolean][] = [
    ["a new Full Offering", null, { type: "FULL" }, full, false],
    ["a new Full Offering given a text stores none", null, { type: "FULL", customerResponsibility: "x" }, full, false],
    ["a new Shared Offering with a text", null, { type: "SHARED", customerResponsibility: " Keys " }, { type: "SHARED", customerResponsibility: "Keys" }, false],
    ["a new Shared Offering without a text is refused", null, { type: "SHARED" }, { type: "SHARED", customerResponsibility: null }, true],
    ["Shared to Full clears the text", shared, { type: "FULL" }, full, false],
    ["Shared to Full with the text still sent clears it", shared, { type: "FULL", customerResponsibility: "x" }, full, false],
    ["Full to Shared with a text", full, { type: "SHARED", customerResponsibility: "Keys" }, { type: "SHARED", customerResponsibility: "Keys" }, false],
    ["Full to Shared without a text is refused", full, { type: "SHARED" }, { type: "SHARED", customerResponsibility: null }, true],
    ["editing the text alone keeps the type", shared, { customerResponsibility: "New text" }, { type: "SHARED", customerResponsibility: "New text" }, false],
    ["clearing the text of a Shared Offering is refused", shared, { customerResponsibility: "" }, { type: "SHARED", customerResponsibility: null }, true],
    ["nulling the text of a Shared Offering is refused", shared, { customerResponsibility: null }, { type: "SHARED", customerResponsibility: null }, true],
    ["a text sent to a Full Offering is dropped", full, { customerResponsibility: "x" }, full, false],
    ["an empty patch keeps everything", shared, {}, shared, false],
  ];

  it.each(table)("%s", (_name, current, patch, expected, refused) => {
    const values = resultingOfferingValues(current, patch);
    expect(values).toEqual(expected);
    expect(controlOfferingRefusal(values.type, values.customerResponsibility) !== null).toBe(refused);
  });
});

describe("offeringValuesDiffer", () => {
  it("compares type and text", () => {
    const a: OfferingValues = { type: "SHARED", customerResponsibility: "x" };
    expect(offeringValuesDiffer(a, { ...a })).toBe(false);
    expect(offeringValuesDiffer(a, { ...a, customerResponsibility: "y" })).toBe(true);
    expect(offeringValuesDiffer(a, { type: "FULL", customerResponsibility: null })).toBe(true);
  });
});

describe("Change Event wording", () => {
  const shared: OfferingValues = { type: "SHARED", customerResponsibility: "Keys" };
  const full: OfferingValues = { type: "FULL", customerResponsibility: null };

  it("marks and unmarks a Provider", () => {
    expect(describeProviderMarked(true)).toBe("Marked as a Provider");
    expect(describeProviderMarked(false)).toBe("No longer a Provider");
  });

  it("adds and removes an Offering", () => {
    expect(describeOfferingAdded("A.8.24", "SHARED")).toBe("Control Offering for A.8.24 added (Shared)");
    expect(describeOfferingAdded("A.8.24", "FULL")).toBe("Control Offering for A.8.24 added (Full)");
    expect(describeOfferingRemoved("A.8.24", "FULL")).toBe("Control Offering for A.8.24 removed (was Full)");
    expect(describeOfferingRemoved("A.8.24", "SHARED")).toBe("Control Offering for A.8.24 removed (was Shared)");
  });

  it("describes a type change and a text-only change, and nothing for no change", () => {
    expect(describeOfferingChanged("A.8.24", full, shared)).toBe("Control Offering for A.8.24 changed (Full → Shared)");
    expect(describeOfferingChanged("A.8.24", shared, full)).toBe("Control Offering for A.8.24 changed (Shared → Full)");
    expect(describeOfferingChanged("A.8.24", shared, { ...shared, customerResponsibility: "Other" })).toBe(
      "Control Offering for A.8.24 changed (customer responsibility updated)",
    );
    expect(describeOfferingChanged("A.8.24", shared, { ...shared })).toBeNull();
    expect(describeOfferingChanged("A.8.24", full, { ...full })).toBeNull();
  });
});
