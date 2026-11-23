import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "../route";

const req = (url: string, method: string, body?: any) =>
  new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("Design Votes Validation", () => {
  it("allows a vote on a valid proposal", async () => {
    // P1 is a valid proposal ID from public/design/proposals.js
    const res = await POST(req("/api/design-votes", "POST", { proposal: "test-186-a-12345", voter: "valid-uuid", vote: true }));
    expect(res.status).toBe(200);
  });

  it("rejects a vote on a non-existent proposal", async () => {
    const res = await POST(req("/api/design-votes", "POST", { proposal: "non-existent-id", voter: "valid-uuid", vote: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid vote");
  });

  it("rejects an invalid voter UUID", async () => {
    const res = await POST(req("/api/design-votes", "POST", { proposal: "test-186-a-12345", voter: "not-a-uuid", vote: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid vote");
  });
});
