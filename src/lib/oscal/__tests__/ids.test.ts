// @vitest-environment node
import { describe, expect, it } from "vitest";
import { controlId, oscalUuid, OSCAL_NAMESPACE_UUID } from "../ids";

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("controlId", () => {
  it("keeps a code that is already a valid OSCAL token", () => {
    for (const code of ["A.5.15", "SEC-001", "T442-abc", "Ärende.1", "x_y"]) expect(controlId(code)).toBe(code);
  });

  it("escapes anything else, reversibly", () => {
    expect(controlId("5.1 Policy")).toBe("_5.1_x20_Policy");
    expect(controlId("A/B")).toBe("_A_x2f_B");
    expect(controlId("a_b c")).toBe("_a_x5f_b_x20_c");
    expect(controlId("")).toBe("_");
    expect(controlId("😀 1")).toBe("__x1f600__x20_1");
  });

  it("gives every escaped code an id that is a valid token", () => {
    const token = /^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$/u;
    for (const code of ["5.1 Policy", "A/B", "", "😀", "_lead", "9"]) expect(controlId(code)).toMatch(token);
  });

  it("never lowercases: codes that differ only in case stay different", () => {
    expect(controlId("A.5")).toBe("A.5");
    expect(controlId("a.5")).toBe("a.5");
    expect(controlId("A B")).toBe("_A_x20_B");
    expect(controlId("a b")).toBe("_a_x20_b");
  });

  it("never gives two codes the same id", () => {
    const codes = ["5.1 Policy", "_5.1_x20_Policy", "5.1_Policy", "5.1-Policy", "_5.1 Policy", "A.5", "a.5", "_", "", "_x20_", " ", "a b", "a_x20_b", "9", "_9", "A/B", "A_x2f_B"];
    const ids = codes.map(controlId);
    expect(new Set(ids).size).toBe(codes.length);
  });
});

describe("oscalUuid", () => {
  it("is a version-5 UUID, the same for the same record every time", () => {
    const a = oscalUuid("System", "ckabc123");
    expect(a).toMatch(UUID_V5);
    expect(oscalUuid("System", "ckabc123")).toBe(a);
  });

  it("differs by record and by model", () => {
    expect(oscalUuid("System", "ckabc123")).not.toBe(oscalUuid("System", "ckabc124"));
    expect(oscalUuid("System", "ckabc123")).not.toBe(oscalUuid("Control", "ckabc123"));
    expect(oscalUuid("ImplementedRequirement", "a", "b")).not.toBe(oscalUuid("ImplementedRequirement", "b", "a"));
  });

  it("is pinned: the namespace and the derivation never change (ADR 0017)", () => {
    expect(OSCAL_NAMESPACE_UUID).toBe("4912ea13-2c3d-4b59-849e-d13c7efec5ba");
    // Computed independently (Python's uuid.uuid5 under the same namespace). If this changes, every exported identity changed.
    expect(oscalUuid("System", "pinned")).toBe("eb82439e-8fb5-5614-b1e2-45a43e756486");
  });
});
