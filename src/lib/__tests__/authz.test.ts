import { describe, expect, it } from "vitest";
import { ForbiddenError, requireAuthenticated, requireRole } from "../authz";

describe("requireRole", () => {
  it("allows a user whose role is in the allowed list", () => {
    expect(() => requireRole({ role: "ADMIN" }, ["ADMIN"])).not.toThrow();
  });

  it("rejects a user whose role is not in the allowed list", () => {
    expect(() => requireRole({ role: "VIEWER" }, ["ADMIN"])).toThrow(ForbiddenError);
  });

  it("rejects when there is no acting user", () => {
    expect(() => requireRole(null, ["ADMIN"])).toThrow(ForbiddenError);
  });

  it("includes the allowed roles in the rejection message", () => {
    expect(() => requireRole({ role: "VIEWER" }, ["ADMIN", "RISK_OWNER"])).toThrow(
      /ADMIN, RISK_OWNER/,
    );
  });
});

describe("requireAuthenticated", () => {
  it("allows any acting user, regardless of role", () => {
    expect(() => requireAuthenticated({ role: "VIEWER" })).not.toThrow();
  });

  it("rejects when there is no acting user", () => {
    expect(() => requireAuthenticated(null)).toThrow(ForbiddenError);
  });
});
