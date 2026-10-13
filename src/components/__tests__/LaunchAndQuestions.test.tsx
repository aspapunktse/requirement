import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftQuestionsEditor } from "../DraftQuestionsEditor";
import { LaunchInternalAuditPanel } from "../LaunchInternalAuditPanel";
import type { LaunchReport } from "@/lib/check-ups";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, back: vi.fn() }) }));

function mockFetch(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}
const calls = () => (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];

describe("DraftQuestionsEditor (#154)", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  const control = { id: "c1", code: "SEC-001" };

  it("edits, adds, reorders and removes, then PUTs the ordered list", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { questions: ["Second?", "First (edited)?", "New?"] }));
    const user = userEvent.setup();
    render(<DraftQuestionsEditor internalAuditId="a1" control={control} initialQuestions={["First?", "Second?"]} />);

    await user.type(screen.getByLabelText("Question 1 for SEC-001"), " (edited)");
    await user.click(screen.getByRole("button", { name: "Move question 1 for SEC-001 down" }));
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.type(screen.getByLabelText("Question 3 for SEC-001"), "New?");
    await user.click(screen.getByRole("button", { name: "Save questions for SEC-001" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = calls()[0];
    expect(url).toBe("/api/internal-audits/a1/controls/c1/questions");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ questions: ["Second?", "First? (edited)", "New?"] });
  });

  it("removes a question and says so when none are left", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", mockFetch(200, { questions: [] }));
    render(<DraftQuestionsEditor internalAuditId="a1" control={control} initialQuestions={["Only?"]} />);
    await user.click(screen.getByRole("button", { name: "Remove question 1 for SEC-001" }));
    expect(screen.getByText(/No question yet/)).toBeInTheDocument();
  });

  it("sends nothing for a blank question and names the problem", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { questions: [] }));
    const user = userEvent.setup();
    render(<DraftQuestionsEditor internalAuditId="a1" control={control} initialQuestions={[]} />);
    await user.click(screen.getByRole("button", { name: "Add question" }));
    await user.click(screen.getByRole("button", { name: "Save questions for SEC-001" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A question can't be blank");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, e.g. once the audit is launched", async () => {
    vi.stubGlobal("fetch", mockFetch(409, { error: "An Internal Audit can only be edited or deleted while it is a draft (this one is launched)" }));
    const user = userEvent.setup();
    render(<DraftQuestionsEditor internalAuditId="a1" control={control} initialQuestions={["Q?"]} />);
    await user.click(screen.getByRole("button", { name: "Save questions for SEC-001" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("while it is a draft");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("LaunchInternalAuditPanel (#154)", () => {
  beforeEach(() => refresh.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  const clean: LaunchReport = {
    summary: "6 Check-ups (5 System-level, 1 Organization-level); 1 System and Control pair skipped because the Control doesn't apply to the System",
    systemCheckUpCount: 5,
    organizationCheckUpCount: 1,
    skippedCount: 1,
    skipped: [{ control: { id: "c1", code: "SEC-001", title: "Access" }, systems: [{ id: "s1", name: "Wiki" }] }],
    blockers: [],
  };

  it("shows the preview, confirms with what will be created, launches and keeps the summary", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetch(200, { summary: clean }));
    const user = userEvent.setup();
    render(<LaunchInternalAuditPanel internalAuditId="a1" title="Access audit" preview={clean} canLaunch />);

    expect(screen.getByText(/Launching creates 6 Check-ups/)).toBeInTheDocument();
    expect(screen.getByText(/SEC-001/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch Internal Audit" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("creates 6 Check-ups (5 System-level, 1 Organization-level)"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls()[0]).toEqual(["/api/internal-audits/a1/launch", { method: "POST" }]);
    expect(await screen.findByRole("region", { name: "Launch summary" })).toHaveTextContent("6 Check-ups");
    confirm.mockRestore();
  });

  it("sends nothing when the confirmation is declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("fetch", mockFetch(200, { summary: clean }));
    const user = userEvent.setup();
    render(<LaunchInternalAuditPanel internalAuditId="a1" title="Access audit" preview={clean} canLaunch />);
    await user.click(screen.getByRole("button", { name: "Launch Internal Audit" }));
    expect(fetch).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("lists the blockers and disables the button", () => {
    const blocked: LaunchReport = {
      ...clean,
      blockers: [{ kind: "no-control-owner", message: "Every Control audited at Organization level needs a Control Owner. No Control Owner for: ORG-002" }],
    };
    render(<LaunchInternalAuditPanel internalAuditId="a1" title="Access audit" preview={blocked} canLaunch />);
    expect(screen.getByRole("alert")).toHaveTextContent("No Control Owner for: ORG-002");
    expect(screen.getByRole("button", { name: "Launch Internal Audit" })).toBeDisabled();
  });

  it("offers no button to a role that can't launch", () => {
    render(<LaunchInternalAuditPanel internalAuditId="a1" title="Access audit" preview={clean} canLaunch={false} />);
    expect(screen.getByRole("region", { name: "Launch preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the server's blockers if the launch is refused", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", mockFetch(400, { error: "can't", problems: ["The due date can't be in the past"] }));
    const user = userEvent.setup();
    render(<LaunchInternalAuditPanel internalAuditId="a1" title="Access audit" preview={clean} canLaunch />);
    await user.click(screen.getByRole("button", { name: "Launch Internal Audit" }));
    expect(await screen.findByText("The due date can't be in the past")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
