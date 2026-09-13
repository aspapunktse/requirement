import { describe, expect, it } from "vitest";
import { visibleSystemsWhere } from "../system-visibility";

describe("visibleSystemsWhere", () => {
  it.each(["ADMIN", "RISK_OWNER", "REVIEWER"] as const)(
    "returns an unrestricted clause for %s",
    (role) => {
      expect(visibleSystemsWhere({ id: "u1", role })).toEqual({});
    },
  );

  it.each(["SYSTEM_OWNER", "VIEWER"] as const)(
    "restricts %s to owned Systems plus ONBOARDED ones",
    (role) => {
      expect(visibleSystemsWhere({ id: "u1", role })).toEqual({
        OR: [{ ownerId: "u1" }, { status: "ONBOARDED" }],
      });
    },
  );
});
