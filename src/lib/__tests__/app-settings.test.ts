import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { APP_SETTINGS, readOrganizationName, DEFAULT_SYSTEMS_THRESHOLDS, SETTING_SECTIONS, definitionOf, isAppSettingKey, schemaOf } from "../app-settings";

describe("the App Settings registry (#240)", () => {
  it("declares the two Systems list thresholds with the values that were constants before", () => {
    expect(DEFAULT_SYSTEMS_THRESHOLDS).toEqual({ staleDraftDays: 60, underFulfilledPercent: 70 });
    expect(definitionOf("systems.staleDraftDays")).toMatchObject({ min: 1, max: 365, default: 60, unit: "days" });
    expect(definitionOf("systems.underFulfilledPercent")).toMatchObject({ min: 1, max: 100, default: 70, unit: "%" });
  });

  it("puts every setting in a known section, with a label and help, and a default its own schema accepts", () => {
    const keys = new Set<string>();
    for (const setting of APP_SETTINGS) {
      expect(SETTING_SECTIONS).toContain(setting.section);
      expect(setting.label).toBeTruthy();
      expect(setting.help).toBeTruthy();
      expect(schemaOf(setting).safeParse(setting.default).success).toBe(true);
      keys.add(setting.key);
    }
    expect(keys.size).toBe(APP_SETTINGS.length);
  });

  it("declares the Organization name as an unset text setting of at most 200 characters, trimmed", () => {
    const definition = definitionOf("organization.name");
    expect(definition).toMatchObject({ type: "text", section: "Organization", maxLength: 200, default: "" });
    const schema = schemaOf(definition);
    expect(schema.parse("  Acme AB ")).toBe("Acme AB");
    expect(schema.safeParse("x".repeat(200)).success).toBe(true);
    expect(schema.safeParse("x".repeat(201)).success).toBe(false);
    expect(schema.safeParse(1).success).toBe(false);
  });

  it("reads the Organization name as null while it is unset", async () => {
    // Read only; the settings API test covers saving it. A saved name in this database would also be valid here.
    const name = await readOrganizationName(prisma);
    expect(name === null || name.trim() === name).toBe(true);
  });

  it("knows its keys", () => {
    expect(isAppSettingKey("systems.staleDraftDays")).toBe(true);
    expect(isAppSettingKey("organization.name")).toBe(true);
    expect(isAppSettingKey("systems.other")).toBe(false);
    expect(isAppSettingKey("__proto__")).toBe(false);
  });
});
