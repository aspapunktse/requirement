"use client";

import { useId, useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import type { AiMessage } from "@/lib/ai";
import { boundedHistory } from "@/lib/ai-history";

/**
 * The floating AI Assistant panel: one toggle button in the corner of every page, and a chat panel
 * that POSTs the whole conversation to `/api/ai/chat` — the local Ollama server, by default
 * `gemma4:12b`. The conversation lives in the panel's state and is sent again with every question,
 * trimmed to the endpoint's limit (`boundedHistory`), so there is nothing to load or clean up on the
 * server side. The root layout keys the panel by the acting user, so switching user starts afresh.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rg-accent";
const PANEL = `flex max-h-[70vh] w-[min(360px,calc(100vw-32px))] flex-col rounded-[14px] border border-rg-line bg-rg-surface shadow-[var(--rg-shadow-popover)]`;
const BUBBLE = "max-w-[85%] rounded-[10px] px-2.5 py-2 text-[13px]";
const INPUT = `rounded-[10px] border border-rg-control bg-rg-surface px-2.5 py-1.5 text-[13px] text-rg-ink disabled:cursor-not-allowed ${FOCUS}`;
const ASK = `rounded-[10px] border border-rg-control bg-rg-surface px-2.5 py-1.5 text-[13.5px] font-semibold text-rg-ink hover:border-rg-accent disabled:opacity-50 ${FOCUS}`;

/** What the model sees as the assistant's system prompt: what it is, what the app's vocabulary is, and what it must not do. */
const SYSTEM_PROMPT =
  "You are an assistant for ISMS, an internal requirements and compliance tracking app (Systems, Frameworks, Controls, Risks, Check-ups and Internal Audits). Answer in English, concisely. You cannot change anything in the app or its data — your answers are text only.";

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AiMessage[]>([{ role: "system", content: SYSTEM_PROMPT }]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();

  async function send() {
    const question = draft.trim();
    if (!question || sending) return;
    const next: AiMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: boundedHistory(next) }),
      });
      const body: { reply?: unknown } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("The assistant answered with status " + response.status);
      setMessages((current) => [...current, { role: "assistant", content: typeof body.reply === "string" ? body.reply : "" }]);
    } catch {
      setError("The AI assistant is unavailable — check that Ollama is running.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-end gap-2">
      {open && (
        <div id={panelId} role="dialog" aria-label="AI assistant" className={PANEL}>
          <div className="flex items-center justify-between gap-2 border-b border-rg-line px-3 py-2.5">
            <span className="text-[13.5px] font-bold text-rg-ink">AI Assistant</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className={`inline-flex size-[22px] items-center justify-center rounded-[8px] text-rg-muted ${FOCUS} hover:text-rg-ink`}
            >
              ×
            </button>
          </div>
          <div aria-live="polite" className="flex-1 space-y-2 overflow-y-auto px-3 py-2.5">
            {messages
              .filter((message) => message.role !== "system")
              .map((message, index) => (
                <div key={index} className={message.role === "user" ? "flex justify-end" : undefined}>
                  <div className={`${BUBBLE} ${message.role === "user" ? "bg-rg-accent text-rg-on-accent" : "bg-rg-accent-soft text-rg-ink"}`}>
                    {message.content}
                  </div>
                </div>
              ))}
            {sending && <div className="text-[12px] text-rg-muted">Thinking…</div>}
            {error && (
              <p role="alert" className="text-[12px] text-rg-muted">
                {error}
              </p>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-rg-line px-3 py-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask…" aria-label="Message" disabled={sending} className={INPUT} />
            <button type="submit" disabled={sending || !draft.trim()} className={ASK}>
              Ask
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        aria-label="AI assistant"
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-rg-line bg-rg-surface text-rg-ink shadow-[var(--rg-shadow-popover)] hover:border-rg-accent ${FOCUS}`}
      >
        <Icon name="bolt" size={18} />
      </button>
    </div>
  );
}
