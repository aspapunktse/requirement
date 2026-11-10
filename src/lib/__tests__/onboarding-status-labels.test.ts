import { describe, expect, it } from "vitest";
import { ONBOARDING_STATUS_LABEL } from "../internal-audit-system-filter";
import { STATUS_LABEL } from "@/app/systems/systems-types";

// Staged evaluation (#333): the stored APPROVED value is shown as ATO everywhere the lifecycle shows.
describe("Onboarding Status labels", () => {
  it("show Approved as ATO and leave Onboarded as it is", () => {
    for (const labels of [ONBOARDING_STATUS_LABEL, STATUS_LABEL]) {
      expect(labels.APPROVED).toBe("ATO");
      expect(labels.ONBOARDED).toBe("Onboarded");
      expect(Object.values(labels)).not.toContain("Approved");
    }
  });
});
