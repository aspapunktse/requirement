import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseAuditButton, LaunchAuditButton } from "../AuditActions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

const mockFetch = (status: number, body: unknown) => vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("audit actions (#399)", () => {
  let confirm: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    refresh.mockClear();
    confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
  });
  afterEach(() => vi.unstubAllGlobals());

  describe("CloseAuditButton", () => {
    it("is disabled while Check-ups are open", () => {
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={2} />);
      expect((screen.getByRole("button", { name: "Close audit" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("closes after a confirmation that says the audit becomes read-only for everyone, then refreshes", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {}));
      const user = userEvent.setup({ delay: null });
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={0} />);
      await user.click(screen.getByRole("button", { name: "Close audit" }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/read-only for everyone/));
      expect(calls()[0][0]).toBe("/api/internal-audits/a1/close");
      expect(calls()[0][1].method).toBe("POST");
    });

    it("sends nothing when the confirmation is cancelled", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {}));
      confirm.mockReturnValue(false);
      const user = userEvent.setup({ delay: null });
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={0} />);
      await user.click(screen.getByRole("button", { name: "Close audit" }));
      expect(fetch).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("shows the server's refusal and does not refresh", async () => {
      vi.stubGlobal("fetch", mockFetch(409, { error: "can't be closed yet", problems: ["A.5.3 for the Organization"] }));
      const user = userEvent.setup({ delay: null });
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={0} />);
      await user.click(screen.getByRole("button", { name: "Close audit" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("can't be closed yet");
      expect(alert.textContent).toContain("A.5.3 for the Organization");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("shows a failure when the request itself fails, and the button works again", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
      const user = userEvent.setup({ delay: null });
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={0} />);
      await user.click(screen.getByRole("button", { name: "Close audit" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Failed to close");
      expect((screen.getByRole("button", { name: "Close audit" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("says Closing… and is disabled while the request runs", async () => {
      let release: (r: Response) => void = () => {};
      vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (release = resolve))));
      const user = userEvent.setup({ delay: null });
      render(<CloseAuditButton internalAuditId="a1" title="Q4" openCount={0} />);
      await user.click(screen.getByRole("button", { name: "Close audit" }));
      const busy = await screen.findByRole("button", { name: "Closing…" });
      expect((busy as HTMLButtonElement).disabled).toBe(true);
      release(new Response("{}", { status: 200 }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
    });
  });

  describe("LaunchAuditButton", () => {
    it("is disabled while anything blocks the launch", () => {
      render(<LaunchAuditButton internalAuditId="a1" title="Q4" summary="2 Check-ups" blockers={["No Control Owner for: X"]} />);
      expect((screen.getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("confirms with what launching creates, POSTs, and refreshes", async () => {
      vi.stubGlobal("fetch", mockFetch(200, {}));
      const user = userEvent.setup({ delay: null });
      render(<LaunchAuditButton internalAuditId="a1" title="Q4" summary="2 Check-ups" blockers={[]} />);
      await user.click(screen.getByRole("button", { name: "Launch" }));
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("2 Check-ups"));
      expect(calls()[0][0]).toBe("/api/internal-audits/a1/launch");
      expect(calls()[0][1].method).toBe("POST");
    });

    it("sends nothing when cancelled, and shows a refusal without refreshing", async () => {
      vi.stubGlobal("fetch", mockFetch(409, { error: "Launch is blocked", problems: ["No question for X"] }));
      const user = userEvent.setup({ delay: null });
      confirm.mockReturnValueOnce(false);
      render(<LaunchAuditButton internalAuditId="a1" title="Q4" summary="2 Check-ups" blockers={[]} />);
      await user.click(screen.getByRole("button", { name: "Launch" }));
      expect(fetch).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Launch" }));
      expect((await screen.findByRole("alert")).textContent).toContain("No question for X");
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
