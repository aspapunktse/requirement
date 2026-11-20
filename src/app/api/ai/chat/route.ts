import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { chat } from "@/lib/ai";

/**
 * `/api/ai/chat` — the AI Assistant panel's endpoint. Authenticated: any signed-in user, not a role.
 * The panel sends the whole conversation each time and owns it client-side, so the route writes
 * nothing and remembers nothing; Ollama must be reachable, and on Vercel that means pointing
 * `OLLAMA_BASE_URL` at an Ollama that the app can reach (the app's own is the user's).
 */

const messageSchema = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().min(1).max(4000) });
const requestSchema = z.object({ messages: z.array(messageSchema).min(1).max(20) });

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "messages is required: an array of up to 20 messages, each with role (system, user or assistant) and content (1–4000 characters)" },
      { status: 400 },
    );
  }

  try {
    const reply = await chat(parsed.data.messages);
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "The AI assistant is unavailable — check that Ollama is running on the configured OLLAMA_BASE_URL." },
      { status: 502 },
    );
  }
}
