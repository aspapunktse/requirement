import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckUpResponseForm } from "../CheckUpResponseForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

const questions = [
  { id: "q1", position: 1, text: "Is it in place?", answer: null },
  { id: "q2", position: 2, text: "Is it tested?", answer: null },
];

describe("CheckUpResponseForm (#155)", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs an answer for every question with the description and the evidence links", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpResponseForm checkUpId="cu1" questions={questions} initialEvidenceLinks={[]} changing={false} />);

    await user.click(screen.getByLabelText("Yes for question 1"));
    await user.click(screen.getByLabelText("N/A for question 2"));
    await user.click(screen.getByLabelText("Description for question 2 (required)"));
    await user.paste("Not applicable to this System");
    await user.type(screen.getByLabelText("Evidence links"), "https://example.com/a\nhttps://example.com/b");
    await user.click(screen.getByRole("button", { name: "Submit response" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = calls()[0];
    expect(url).toBe("/api/check-ups/cu1/response");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      answers: [
        { questionId: "q1", answer: "YES", description: "" },
        { questionId: "q2", answer: "NA", description: "Not applicable to this System" },
      ],
      evidenceLinks: ["https://example.com/a", "https://example.com/b"],
    });
  });

  it("sends nothing while a question is unanswered, a No has no description or a link isn't http(s)", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpResponseForm checkUpId="cu1" questions={questions} initialEvidenceLinks={[]} changing={false} />);

    await user.click(screen.getByRole("button", { name: "Submit response" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Question 1 needs an answer");
    expect(screen.getByRole("alert")).toHaveTextContent("Question 2 needs an answer");

    await user.click(screen.getByLabelText("Yes for question 1"));
    await user.click(screen.getByLabelText("No for question 2"));
    await user.click(screen.getByLabelText("Evidence links"));
    await user.paste("javascript:alert(1)");
    await user.click(screen.getByRole("button", { name: "Submit response" }));
    expect(screen.getByRole("alert")).toHaveTextContent("a description is required for No");
    expect(screen.getByRole("alert")).toHaveTextContent("is not an http(s) URL");
    expect(calls()).toHaveLength(0);
  });

  it("starts from the current response so it can be changed, and shows the server's refusal", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { error: "Only the recipient of a Check-up can answer it" }));
    const user = userEvent.setup({ delay: null });
    render(
      <CheckUpResponseForm
        checkUpId="cu1"
        questions={[{ ...questions[0], answer: { answer: "NO", description: "Not yet" } }, { ...questions[1], answer: { answer: "YES", description: "" } }]}
        initialEvidenceLinks={["https://example.com/a"]}
        changing
      />,
    );
    expect(screen.getByLabelText("No for question 1")).toBeChecked();
    expect(screen.getByLabelText("Evidence links")).toHaveValue("https://example.com/a");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only the recipient of a Check-up can answer it");
    expect(refresh).not.toHaveBeenCalled();
  });
});
