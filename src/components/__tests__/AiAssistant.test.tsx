import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiAssistant } from "../AiAssistant";

/**
 * The AiAssistant panel: opens on the toggle, asks a question to `/api/ai/chat` with the whole
 * conversation, and shows the reply — or the error when Ollama is unavailable. `fetch` is stubbed
 * like the other component tests.
 */

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("AiAssistant", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the panel, asks a question and shows the reply", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { reply: "Systems are the top level of the app." }));
    const user = userEvent.setup({ delay: null });
    render(<AiAssistant />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(screen.getByRole("dialog", { name: "AI assistant" })).toBeVisible();

    await user.type(screen.getByLabelText("Message"), "What are Systems?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByText("Systems are the top level of the app.")).toBeVisible());
    const [url, init] = calls()[0];
    expect(url).toBe("/api/ai/chat");
    expect(init.method).toBe("POST");
    const messages = JSON.parse(init.body as string).messages;
    expect(messages.at(-1)).toEqual({ role: "user", content: "What are Systems?" });
  });

  it("closes on Close and can be reopened", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { reply: "ok" }));
    const user = userEvent.setup({ delay: null });
    render(<AiAssistant />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(screen.getByRole("dialog", { name: "AI assistant" })).toBeVisible();
  });

  it("shows the error when the assistant is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));
    const user = userEvent.setup({ delay: null });
    render(<AiAssistant />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    await user.type(screen.getByLabelText("Message"), "Hi");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The AI assistant is unavailable — check that Ollama is running."));
  });

  it("keeps working past the endpoint's message limit by sending only the latest turns", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { reply: "ok" }));
    const user = userEvent.setup({ delay: null });
    render(<AiAssistant />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    for (let i = 0; i < 11; i++) {
      await user.type(screen.getByLabelText("Message"), `q${i}`);
      await user.click(screen.getByRole("button", { name: "Ask" }));
      await waitFor(() => expect(calls()).toHaveLength(i + 1));
      await waitFor(() => expect(screen.getAllByText("ok")).toHaveLength(i + 1));
    }
    const sent = JSON.parse(calls()[10][1].body as string).messages;
    expect(sent.length).toBeLessThanOrEqual(20);
    expect(sent[0].role).toBe("system");
    expect(sent.at(-1)).toEqual({ role: "user", content: "q10" });
    expect(screen.getByText("q0")).toBeVisible();
  });

  it("starts afresh when remounted for another acting user", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { reply: "ok" }));
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<AiAssistant key="user-a" />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    await user.type(screen.getByLabelText("Message"), "secret question");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("ok")).toBeVisible());
    await user.type(screen.getByLabelText("Message"), "unsent draft");

    rerender(<AiAssistant key="user-b" />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    expect(screen.queryByText("secret question")).toBeNull();
    expect(screen.getByLabelText("Message")).toHaveValue("");
  });
});
