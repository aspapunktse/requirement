import { describe, expect, it } from "vitest";
import type { AiMessage } from "../ai";
import { boundedHistory, MAX_CHAT_MESSAGES, MAX_MESSAGE_CHARS } from "../ai-history";

const system: AiMessage = { role: "system", content: "prompt" };
function turns(pairs: number): AiMessage[] {
  return Array.from({ length: pairs }, (_, i) => [
    { role: "user" as const, content: `q${i}` },
    { role: "assistant" as const, content: `a${i}` },
  ]).flat();
}

describe("boundedHistory", () => {
  it("sends a short conversation unchanged", () => {
    const messages = [system, ...turns(2), { role: "user" as const, content: "next" }];
    expect(boundedHistory(messages)).toEqual(messages);
  });

  it("keeps the system prompt and the latest turns within the endpoint limit, starting at a question", () => {
    const messages = [system, ...turns(10), { role: "user" as const, content: "q10" }];
    expect(messages).toHaveLength(22);
    const sent = boundedHistory(messages);
    expect(sent.length).toBeLessThanOrEqual(MAX_CHAT_MESSAGES);
    expect(sent[0]).toEqual(system);
    expect(sent[1].role).toBe("user");
    expect(sent.at(-1)).toEqual({ role: "user", content: "q10" });
    expect(sent.map((m) => m.content)).toEqual(["prompt", "q1", "a1", "q2", "a2", "q3", "a3", "q4", "a4", "q5", "a5", "q6", "a6", "q7", "a7", "q8", "a8", "q9", "a9", "q10"]);
  });

  it("never starts the turns at a reply", () => {
    const messages = [system, ...turns(3), { role: "user" as const, content: "q3" }];
    expect(boundedHistory(messages, 5).map((m) => m.content)).toEqual(["prompt", "q2", "a2", "q3"]);
  });

  it("leaves out empty replies, which the endpoint refuses", () => {
    const messages: AiMessage[] = [system, { role: "user", content: "q0" }, { role: "assistant", content: "" }, { role: "user", content: "q1" }];
    expect(boundedHistory(messages).map((m) => m.content)).toEqual(["prompt", "q0", "q1"]);
  });

  it("cuts a message longer than the endpoint accepts, leaving shorter ones as they are", () => {
    const long = "x".repeat(MAX_MESSAGE_CHARS + 500);
    const messages: AiMessage[] = [system, { role: "user", content: "q0" }, { role: "assistant", content: long }, { role: "user", content: "q1" }];
    const sent = boundedHistory(messages);
    expect(sent[2].content).toHaveLength(MAX_MESSAGE_CHARS);
    expect(sent.map((m) => m.content.length)).toEqual([6, 2, MAX_MESSAGE_CHARS, 2]);
    expect(messages[2].content).toHaveLength(MAX_MESSAGE_CHARS + 500);
  });
});
