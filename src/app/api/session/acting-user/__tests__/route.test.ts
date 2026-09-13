import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, GET, POST } from "../route";

const URL = "http://localhost/api/session/acting-user";

describe("/api/session/acting-user", () => {
  const email = "test-acting-user-route@example.com";
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Acting User Route Test", role: "ADMIN" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled (404) outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getResponse = await GET(new NextRequest(URL));
    expect(getResponse.status).toBe(404);

    const postResponse = await POST(
      new NextRequest(URL, { method: "POST", body: JSON.stringify({ userId }) }),
    );
    expect(postResponse.status).toBe(404);

    const deleteResponse = await DELETE();
    expect(deleteResponse.status).toBe(404);
  });

  it("GET returns null when no acting user cookie is set", async () => {
    const response = await GET(new NextRequest(URL));
    const body = await response.json();
    expect(body.user).toBeNull();
  });

  it("POST rejects a request with no userId", async () => {
    const response = await POST(
      new NextRequest(URL, { method: "POST", body: JSON.stringify({}) }),
    );
    expect(response.status).toBe(400);
  });

  it("POST rejects an unknown userId", async () => {
    const response = await POST(
      new NextRequest(URL, {
        method: "POST",
        body: JSON.stringify({ userId: "does-not-exist" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("POST sets the acting user and returns it", async () => {
    const response = await POST(
      new NextRequest(URL, { method: "POST", body: JSON.stringify({ userId }) }),
    );
    const body = await response.json();

    expect(body.user).toMatchObject({ id: userId, email });
    expect(response.cookies.get(ACTING_USER_COOKIE)?.value).toBe(userId);
  });

  it("GET returns the acting user once the cookie is set", async () => {
    const request = new NextRequest(URL, {
      headers: { cookie: `${ACTING_USER_COOKIE}=${userId}` },
    });
    const response = await GET(request);
    const body = await response.json();
    expect(body.user).toMatchObject({ id: userId, email });
  });

  it("DELETE clears the acting user cookie", async () => {
    const response = await DELETE();
    const body = await response.json();
    expect(body.user).toBeNull();
    expect(response.cookies.get(ACTING_USER_COOKIE)?.value).toBeFalsy();
  });
});
