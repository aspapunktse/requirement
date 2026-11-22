import { describe, expect, it } from "vitest";
import { controlFieldsSchema, createControlSchema, isReservedControlCode } from "../control-schema";
import { parseFrameworkImport } from "../framework-import-schema";

// `/controls/new` is the New Control page and shadows `/controls/[code]`, so no Control may be called `new` (#412).
const FIELDS = { title: "t", description: "d", category: "Security", applicability: "ORGANIZATIONAL" as const };

describe("the reserved Control code", () => {
  it.each(["new", "New", "NEW", " new ", "nEw\n"])("recognises %j", (code) => {
    expect(isReservedControlCode(code)).toBe(true);
  });

  it.each(["news", "new-1", "A.5.1", "SEC-001", "renew"])("lets %j through", (code) => {
    expect(isReservedControlCode(code)).toBe(false);
  });

  it("is refused by the field and create schemas, and a normal code is not", () => {
    expect(controlFieldsSchema.safeParse({ ...FIELDS, code: "NEW" }).success).toBe(false);
    expect(createControlSchema.safeParse({ ...FIELDS, code: "new" }).success).toBe(false);
    expect(createControlSchema.safeParse({ ...FIELDS, code: "SEC-001" }).success).toBe(true);
  });

  it("is refused for a Supplementary Control in a Framework import", () => {
    const file = {
      framework: { name: "Test Framework", version: "1", licensing: "PARAPHRASE_ONLY", strictComplianceRequired: false },
      supplementaryControls: [{ ...FIELDS, code: "New" }],
      requirements: [],
    };
    expect(parseFrameworkImport(file).ok).toBe(false);
  });
});
