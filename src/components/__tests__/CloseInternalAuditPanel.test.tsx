import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseInternalAuditPanel } from "../CloseInternalAuditPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("CloseInternalAuditPanel (#158)", () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = ['A.5.1 for System "Payroll"', "A.5.2 for the Organization"];

  it("names the Check-ups still open and disables Close while there are any", () => {
    render(<CloseInternalAuditPanel internalAuditId="a1" title="Q4" unfinished={open} canClose />);
    const blockers = screen.getByTestId("close-blockers");
    expect(blockers.textContent).toContain("Still open (2)");
    expect(blockers.textContent).toContain('A.5.1 for System "Payroll"');
    expect(blockers.textContent).toContain("A.5.2 for the Organization");
    expect((screen.getByRole("button", { name: "Close Internal Audit" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a reader who can't close the list but no button", () => {
    render(<CloseInternalAuditPanel internalAuditId="a1" title="Q4" unfinished={open} canClose={false} />);
    expect(screen.getByTestId("close-blockers")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("closes after a confirmation that says the audit becomes read-only for everyone, then refreshes", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    const user = userEvent.setup({ delay: null });
    render(<CloseInternalAuditPanel internalAuditId="a1" title="Q4" unfinished={[]} canClose />);
    expect(screen.queryByTestId("close-blockers")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close Internal Audit" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/read-only for everyone/));
    const [url, init] = calls()[0];
    expect(url).toBe("/api/internal-audits/a1/close");
    expect(init.method).toBe("POST");
  });

  it("sends nothing when the confirmation is cancelled", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {}));
    confirm.mockReturnValue(false);
    const user = userEvent.setup({ delay: null });
    render(<CloseInternalAuditPanel internalAuditId="a1" title="Q4" unfinished={[]} canClose />);
    await user.click(screen.getByRole("button", { name: "Close Internal Audit" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the server's refusal with the Check-ups it names, and does not refresh", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(409, {
        error: "This Internal Audit can't be closed yet: 1 Check-up is neither evaluated nor withdrawn",
        problems: ["A.5.3 for the Organization"],
      }),
    );
    const user = userEvent.setup({ delay: null });
    render(<CloseInternalAuditPanel internalAuditId="a1" title="Q4" unfinished={[]} canClose />);
    await user.click(screen.getByRole("button", { name: "Close Internal Audit" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("can't be closed yet");
    expect(alert.textContent).toContain("A.5.3 for the Organization");
    expect(refresh).not.toHaveBeenCalled();
  });
});
