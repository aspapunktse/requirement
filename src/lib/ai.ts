/**
 * Client for the local Ollama server's native chat endpoint. The server runs on the user's machine,
 * so there is no API key and nothing leaves their network: the base URL and the model come from the
 * environment, defaulting to the standard Ollama endpoint and the model they run locally
 * (`gemma4:12b`). See `.env.example` for `OLLAMA_BASE_URL` and `OLLAMA_MODEL`.
 */

export type AiRole = "system" | "user" | "assistant";
export type AiMessage = { role: AiRole; content: string };

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4:12b";

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;

/**
 * Sends the conversation to Ollama and returns the assistant's reply text ("" when Ollama sent
 * none). Throws when Ollama answers non-ok or is unreachable.
 */
export async function chat(messages: AiMessage[], options: { model?: string } = {}): Promise<string> {
  const model = options.model ?? OLLAMA_MODEL;
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, messages }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const data: unknown = await response.json();
  const message = typeof data === "object" && data !== null ? (data as { message?: { content?: unknown } }).message : undefined;
  return typeof message?.content === "string" ? message.content : "";
}
