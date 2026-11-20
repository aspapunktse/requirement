import { afterEach, describe, expect, it, vi } from "vitest";
import { chat, DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL, OLLAMA_BASE_URL, OLLAMA_MODEL, type AiMessage } from "../ai";

/**
 * `src/lib/ai.ts`: the client for the local Ollama server. There is no Ollama in tests, so the
 * server is a stubbed `fetch` — the assertions are on what the client sends and how it reads the
 * reply, the wiring to the local server.
 */

const messages: AiMessage[] = [
  { role: "system", content: "You are an assistant for ISMS." },
  { role: "user", content: "What are Systems?" },
];

function stubOllama(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("ai.chat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("the local server and model default to Ollama's and gemma4:12b", () => {
    expect(DEFAULT_OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(DEFAULT_OLLAMA_MODEL).toBe("gemma4:12b");
    expect(OLLAMA_BASE_URL).toBe(process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL);
    expect(OLLAMA_MODEL).toBe(process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL);
  });

  it("POSTs the model, stream:false and the messages to /api/chat and returns the reply text", async () => {
    stubOllama(200, { message: { role: "assistant", content: "Systems are the top level of the app." } });
    expect(await chat(messages)).toBe("Systems are the top level of the app.");

    const [url, init] = calls()[0];
    expect(url).toBe(`${OLLAMA_BASE_URL}/api/chat`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ model: OLLAMA_MODEL, stream: false, messages });
  });

  it("a non-ok answer throws and a rejected fetch throws too", async () => {
    stubOllama(503, {});
    await expect(chat(messages)).rejects.toThrow("Ollama answered 503");

    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    await expect(chat(messages)).rejects.toThrow("fetch failed");
  });

  it("returns an empty string when Ollama's answer has no message text", async () => {
    stubOllama(200, { message: { role: "assistant" } });
    expect(await chat(messages)).toBe("");
    stubOllama(200, {});
    expect(await chat(messages)).toBe("");
  });

  it("options.model overrides the model sent", async () => {
    stubOllama(200, { message: { role: "assistant", content: "ok" } });
    await chat(messages, { model: "other-model" });
    expect(JSON.parse(calls()[0][1].body as string).model).toBe("other-model");
  });
});
