import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "@/lib/ai";
import { POST } from "../route";

/**
 * /api/ai/chat — against real Postgres for the acting-user authentication (the route writes
 * nothing; the Ollama conversation is stubbed). The route's contract: any signed-in user, the
 * request body is validated with zod, the reply comes from the local Ollama server, and anything
 * wrong with Ollama is a 502, never a partial success.
 */

const URL = "http://localhost/api/ai/chat";
const suffix = `${process.pid}-${Date.now()}`;
const messages = [{ role: "user", content: "What are Systems?" }];

const replyBody = () => ({ message: { role: "assistant", content: "Systems are the top level of the app." } });
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("/api/ai/chat", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `test-ai-chat-${suffix}@example.com`, name: "Test AI Chat", role: "VIEWER" } })).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId] } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  const post = (userId: string | null, body: unknown) =>
    POST(new NextRequest(URL, { method: "POST", headers: userId ? { cookie: `${ACTING_USER_COOKIE}=${userId}` } : {}, body: JSON.stringify(body) }));

  it("401 without a user, and never calls Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await post(null, { messages })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a signed-in user gets the Ollama reply; the model and the messages go to the server", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replyBody()), { status: 200 })));
    const response = await post(userId, { messages });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reply: "Systems are the top level of the app." });

    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0];
    expect(url).toBe(`${OLLAMA_BASE_URL}/api/chat`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(OLLAMA_MODEL);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual(messages);
  });

  it("400 on bodies without a valid messages array", async () => {
    for (const bad of [
      null,
      {},
      { messages: [] },
      { messages: "hi" },
      { messages: [{ role: "user" }] },
      { messages: [{ role: "bot", content: "hi" }] },
      { messages: [{ role: "user", content: "" }] },
      { messages: [{ role: "user", content: "x".repeat(4001) }] },
    ]) {
      expect((await post(userId, bad)).status).toBe(400);
    }
  });

  it("a body that is not JSON is 400", async () => {
    const response = await POST(new NextRequest(URL, { method: "POST", headers: { cookie: `${ACTING_USER_COOKIE}=${userId}` }, body: "not json" }));
    expect(response.status).toBe(400);
  });

  it("502 when Ollama is unreachable or answers non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    expect((await post(userId, { messages })).status).toBe(502);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replyBody()), { status: 500 })));
    expect((await post(userId, { messages })).status).toBe(502);
  });
});
