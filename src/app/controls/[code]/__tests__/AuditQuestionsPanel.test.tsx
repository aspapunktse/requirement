import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditQuestionsPanel } from "../AuditQuestionsPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

const mockFetch = (status: number, body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

const q = (text: string, guidance: string | null = null) => ({ text, guidance });

describe("Audit Questions panel on the Control page (#404)", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("is a read-only list for a role that can't curate", () => {
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[q("First?", "Look at the SSO log"), q("Second?")]} canCurate={false} />);
    const list = screen.getByRole("list", { name: "Audit Questions for SEC-001" });
    expect(list).toHaveTextContent("First?");
    expect(list).toHaveTextContent("Second?");
    expect(list).toHaveTextContent("Guidance: Look at the SSO log");
    expect(screen.getAllByText(/Guidance:/)).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says so when a reader sees no Audit Questions", () => {
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[]} canCurate={false} />);
    expect(screen.getByText("No Audit Questions yet.")).toBeInTheDocument();
  });

  it("edits, adds, reorders and removes, then PUTs the ordered list", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { questions: ["Second?", "First? (edited)", "New?"], guidance: [null, "Note", null] }));
    const user = userEvent.setup();
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[q("First?", "Note"), q("Second?"), q("Drop?")]} canCurate />);

    await user.type(screen.getByLabelText("Audit Question 1 for SEC-001"), " (edited)");
    await user.click(screen.getByRole("button", { name: "Move Audit Question 1 down" }));
    await user.click(screen.getByRole("button", { name: "Remove Audit Question 3" }));
    await user.click(screen.getByRole("button", { name: "Add Audit Question" }));
    await user.type(screen.getByLabelText("Audit Question 3 for SEC-001"), "New?");
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = calls()[0];
    expect(url).toBe("/api/controls/c1/audit-questions");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      questions: [
        { text: "Second?", guidance: "" },
        { text: "First? (edited)", guidance: "Note" },
        { text: "New?", guidance: "" },
      ],
    });
    expect(screen.getByLabelText("Guidance for Audit Question 2 (optional)")).toHaveValue("Note");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("sends nothing for a blank or repeated question and names the problem", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { questions: [] }));
    const user = userEvent.setup();
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[q("Same?")]} canCurate />);
    await user.click(screen.getByRole("button", { name: "Add Audit Question" }));
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));
    expect(screen.getByRole("alert")).toHaveTextContent("An Audit Question can't be blank");
    await user.type(screen.getByLabelText("Audit Question 2 for SEC-001"), "Same?");
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The same Audit Question is listed twice");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { error: "Forbidden" }));
    const user = userEvent.setup();
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[q("Q?")]} canCurate />);
    await user.type(screen.getByLabelText("Audit Question 1 for SEC-001"), "!");
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves a note typed beside a question, and names an over-long one without sending", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { questions: ["Q?"], guidance: ["Check the log"] }));
    const user = userEvent.setup();
    render(<AuditQuestionsPanel controlId="c1" code="SEC-001" initialQuestions={[q("Q?")]} canCurate />);
    const guidance = screen.getByLabelText("Guidance for Audit Question 1 (optional)");
    await user.click(guidance);
    await user.paste("x".repeat(1001));
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Guidance can be at most 1000 characters");
    expect(fetch).not.toHaveBeenCalled();
    await user.clear(guidance);
    await user.type(guidance, "Check the log");
    await user.click(screen.getByRole("button", { name: "Save Audit Questions" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(calls()[0][1].body as string)).toEqual({ questions: [{ text: "Q?", guidance: "Check the log" }] });
    expect(screen.getByLabelText("Guidance for Audit Question 1 (optional)")).toHaveValue("Check the log");
  });
});
