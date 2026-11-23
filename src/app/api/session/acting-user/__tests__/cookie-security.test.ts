import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../route";

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("Acting User Cookie Security", () => {
  it("sets a secure HttpOther cookie on valid request", async () => {
    const res = await POST(req("/api/session/acting-user", "POST", { userId: "test-user-id" }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await POST(req("/api/session/acting-user", "POST", { userId: "non-existent-id" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
