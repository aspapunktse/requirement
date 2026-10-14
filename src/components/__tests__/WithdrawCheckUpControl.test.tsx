import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WithdrawCheckUpControl } from "../WithdrawCheckUpControl";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("WithdrawCheckUpControl (#158)", () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows only a Withdraw button until it is opened", () => {
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    expect(screen.getByRole("button", { name: "Withdraw this Check-up" })).toBeTruthy();
    expect(screen.queryByLabelText("Reason")).toBeNull();
  });

  it("POSTs the reason after a confirmation that says a withdrawal is final, then refreshes", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    await user.click(screen.getByRole("button", { name: "Withdraw this Check-up" }));
    await user.type(screen.getByLabelText("Reason"), "The Control no longer applies");
    await user.click(screen.getByRole("button", { name: "Withdraw Check-up" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/withdrawal is final/));
    const [url, init] = calls()[0];
    expect(url).toBe("/api/check-ups/cu1/withdrawal");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "The Control no longer applies" });
  });

  it("sends nothing without a reason, and asks nothing", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    const user = userEvent.setup({ delay: null });
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    await user.click(screen.getByRole("button", { name: "Withdraw this Check-up" }));
    await user.type(screen.getByLabelText("Reason"), "   ");
    await user.click(screen.getByRole("button", { name: "Withdraw Check-up" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/reason is required/);
    expect(fetch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    vi.stubGlobal("fetch", mockFetch(201, {}));
    confirm.mockReturnValue(false);
    const user = userEvent.setup({ delay: null });
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    await user.click(screen.getByRole("button", { name: "Withdraw this Check-up" }));
    await user.type(screen.getByLabelText("Reason"), "Because");
    await user.click(screen.getByRole("button", { name: "Withdraw Check-up" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and does not refresh", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: "This Check-up has been evaluated, so it can't be withdrawn" }));
    const user = userEvent.setup({ delay: null });
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    await user.click(screen.getByRole("button", { name: "Withdraw this Check-up" }));
    await user.type(screen.getByLabelText("Reason"), "Because");
    await user.click(screen.getByRole("button", { name: "Withdraw Check-up" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/evaluated/);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("closes the reason field again on Cancel", async () => {
    const user = userEvent.setup({ delay: null });
    render(<WithdrawCheckUpControl checkUpId="cu1" />);
    await user.click(screen.getByRole("button", { name: "Withdraw this Check-up" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason")).toBeNull();
  });
});
