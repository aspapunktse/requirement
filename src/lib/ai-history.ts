import type { AiMessage } from "@/lib/ai";

/** The most messages `/api/ai/chat` accepts in one request, the system prompt included. */
export const MAX_CHAT_MESSAGES = 20;

/**
 * The part of a conversation the AI Assistant panel sends: its system prompt(s), then as many of the
 * latest turns as fit under `max`, starting at a question so the model never sees a reply without
 * the question it answered. Empty messages (an empty reply from the model) are left out, because
 * the endpoint refuses empty content. The panel keeps showing the whole conversation; only what is
 * sent is trimmed.
 */
export function boundedHistory(messages: AiMessage[], max: number = MAX_CHAT_MESSAGES): AiMessage[] {
  const kept = messages.filter((message) => message.content.trim() !== "");
  const system = kept.filter((message) => message.role === "system");
  const turns = kept.filter((message) => message.role !== "system");
  let tail = turns.slice(Math.max(0, turns.length - (max - system.length)));
  while (tail.length > 0 && tail[0].role !== "user") tail = tail.slice(1);
  return [...system, ...tail];
}
