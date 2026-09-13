import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("GET /api/health", () => {
  it("returns ok status", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });
});
