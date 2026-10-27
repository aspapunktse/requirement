import { describe, expect, it } from "vitest";
import { attributeEvent, type AttributableEvent } from "../change-event-attribution";

const event = (over: Partial<AttributableEvent>): AttributableEvent => ({
  action: "SYSTEM_SUBMITTED",
  actorId: "actor",
  createdAt: new Date(),
  detail: "Base review: Approved: c",
  systemId: "s",
  systemOwnerId: "owner",
  ...over,
});
const none = new Set<string>();

describe("attributeEvent (#251)", () => {
  it("says You, The system, and a name for anything else", () => {
    const viewer = { id: "v", role: "VIEWER" as const };
    expect(attributeEvent(viewer, event({ actorId: "v" }), "V", none, undefined)).toBe("You");
    expect(attributeEvent(viewer, event({ actorId: "system" }), undefined, none, undefined)).toBe("The system");
    expect(attributeEvent(viewer, event({}), "Ann", none, undefined)).toBe("Ann");
    expect(attributeEvent(viewer, event({}), undefined, none, undefined)).toBe("Someone");
  });

  it("hides an Approval decider from the System's owner and anyone outside its step, but not from the always-seeing roles", () => {
    const decided = event({ action: "APPROVAL_DECIDED" });
    expect(attributeEvent({ id: "owner", role: "SYSTEM_OWNER" }, decided, "Ann", none, { reviewGroupId: null })).toBe("Base review");
    expect(attributeEvent({ id: "r", role: "REVIEWER" }, decided, "Ann", none, { reviewGroupId: null })).toBe("Ann");
    expect(attributeEvent({ id: "r", role: "REVIEWER" }, decided, "Ann", none, { reviewGroupId: "g" })).toBe("Base review");
    expect(attributeEvent({ id: "m", role: "SYSTEM_OWNER" }, decided, "Ann", new Set(["g"]), { reviewGroupId: "g" })).toBe("Ann");
    expect(attributeEvent({ id: "m", role: "SYSTEM_OWNER" }, decided, "Ann", new Set(["g"]), { reviewGroupId: null })).toBe("Base review");
    expect(attributeEvent({ id: "a", role: "ADMIN" }, decided, "Ann", none, { reviewGroupId: "g" })).toBe("Ann");
  });

  it("names an unmatched decision only for the always-seeing roles, and copes with a System-less event", () => {
    const decided = event({ action: "APPROVAL_DECIDED" });
    expect(attributeEvent({ id: "r", role: "REVIEWER" }, decided, "Ann", none, undefined)).toBe("Base review");
    expect(attributeEvent({ id: "a", role: "INTERNAL_AUDITOR" }, decided, "Ann", none, undefined)).toBe("Ann");
    const orphan = event({ action: "APPROVAL_DECIDED", systemId: null, systemOwnerId: null });
    expect(attributeEvent({ id: "r", role: "REVIEWER" }, orphan, "Ann", none, { reviewGroupId: null })).toBe("Base review");
    expect(attributeEvent({ id: "a", role: "ADMIN" }, orphan, "Ann", none, { reviewGroupId: null })).toBe("Ann");
  });

  it("names a Query's actor only for the always-seeing roles and the System's owner", () => {
    const query = event({ action: "QUERY_REPLIED" });
    expect(attributeEvent({ id: "r", role: "REVIEWER" }, query, "Ann", none, undefined)).toBe("A reviewer");
    expect(attributeEvent({ id: "m", role: "COMPLIANCE_MANAGER" }, query, "Ann", none, undefined)).toBe("Ann");
    expect(attributeEvent({ id: "x", role: "VIEWER" }, event({ action: "QUERY_OPENED", actorId: "owner" }), "Olle", none, undefined)).toBe("Olle");
    expect(attributeEvent({ id: "x", role: "VIEWER" }, event({ action: "QUERY_OPENED", systemOwnerId: null }), "Ann", none, undefined)).toBe("A reviewer");
  });
});
