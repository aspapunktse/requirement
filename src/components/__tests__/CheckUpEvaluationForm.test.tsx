import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckUpEvaluationForm } from "../CheckUpEvaluationForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("CheckUpEvaluationForm (#156)", () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the outcome and the comment, and says the evaluation is final", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpEvaluationForm checkUpId="cu1" />);
    expect(screen.getByText(/evaluation is final/)).toBeTruthy();

    await user.click(screen.getByLabelText("Nonconformity"));
    await user.type(screen.getByLabelText("Comment"), "No evidence of operation");
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(
      "Record this Check-up as Nonconformity? An evaluation is final: it can't be changed, and the recipient can no longer change the response.",
    );
    const [url, init] = calls()[0];
    expect(url).toBe("/api/check-ups/cu1/evaluation");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ outcome: "NONCONFORMITY", comment: "No evidence of operation" });
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    confirm.mockReturnValue(false);
    const user = userEvent.setup({ delay: null });
    render(<CheckUpEvaluationForm checkUpId="cu1" />);
    await user.click(screen.getByLabelText("Conforming"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("accepts Conforming without a comment", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpEvaluationForm checkUpId="cu1" />);
    await user.click(screen.getByLabelText("Conforming"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(calls()[0][1].body as string)).toEqual({ outcome: "CONFORMING", comment: "" });
  });

  it("sends nothing without an outcome, or without a comment for an Observation or a Nonconformity", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpEvaluationForm checkUpId="cu1" />);

    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/outcome/i);

    await user.click(screen.getByLabelText("Observation"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/comment is required for Observation/));
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Validation comes first: the dialog only appears for a submission that would be accepted.
    expect(confirm).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and does not refresh", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: "This Check-up has been evaluated already; an evaluation is final" }));
    const user = userEvent.setup({ delay: null });
    render(<CheckUpEvaluationForm checkUpId="cu1" />);
    await user.click(screen.getByLabelText("Conforming"));
    await user.click(screen.getByRole("button", { name: "Record evaluation" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/final/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
