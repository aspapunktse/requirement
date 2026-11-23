import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET, PATCH } from "../route";

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("Business Risk Owner Scope Isolation", () => {
  it("allows a BRO to access a Business Unit in their portfolio", async () => {
    const res = await GET(req(`/api/business-units/${assignedId}`, "GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe(assignedName);
  });

  it("denies a BRO access to a Business Unit they do not own", async () => {
    const res = await GET(req(`/api/business-units/${otherId}`, "GET"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("denied");
  });

  it("denies a BRO access to a Business Unit they have no-scope on", async () => {
    const res = await GET(req(`/api/business-units/${unassignedId}`, "GET"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("denied");
  });
});
