import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessment,
  control,
  json,
  openQuery,
  organization,
  provider,
  renderControls,
  renderDrawer,
  rowOf,
  shared,
  stubApi,
  type Call,
} from "./controls-test-utils";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refresh.mockClear();
  window.history.replaceState(null, "", "/systems/s1");
});

const POLICIES = control("A.5.1", { title: "Policies for information security", mandatory: true, question: "Do you have policies?" });
const policiesRow = (extra: Record<string, unknown> = {}) =>
  rowOf(POLICIES, assessment("IN_PROGRESS", { evidence: "Policy doc v2", queries: [openQuery("q1", "Which version?")] }), [], extra);

/** The options of a Status select that can be picked. */
const enabledOptions = (drawer: ReturnType<typeof within>, code: string) =>
  Array.from((drawer.getByLabelText(`Status for ${code}`) as HTMLSelectElement).options)
    .filter((option: HTMLOptionElement) => !option.disabled)
    .map((option: HTMLOptionElement) => option.textContent);

/** The buttons of the Self-Assessment Question section. */
const answerButtons = (drawer: ReturnType<typeof within>) =>
  within(drawer.getByRole("region", { name: "Self-Assessment Question" }))
    .getAllByRole("button")
    .map((button) => button.textContent);

const patchStatus = (call: Call) => (call.body as { status: string }).status;
/** A PATCH of the Assessment answers with the saved Assessment, as the API does (no `effective`). */
const saveAs = (over: Parameters<typeof assessment>[1] = {}) => (call: Call) =>
  call.method === "PATCH" && !call.url.endsWith("/answer") ? json({ assessment: assessment(patchStatus(call), over) }) : undefined;

describe("Control drawer: what each role may do (#71, #78, #147)", () => {
  it("offers the edit form, the Self-Assessment answers and the question actions by default", async () => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", { userRole: "ADMIN", currentUserId: "admin", systemOwnerId: "owner" });
    expect(drawer.getByLabelText("Status for A.5.1")).toBeInTheDocument();
    expect(drawer.getByLabelText("Evidence for A.5.1")).toHaveValue("Policy doc v2");
    expect(drawer.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("in readOnly mode shows the Assessment and the question with no way to change them", async () => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", { userRole: "COMPLIANCE_MANAGER", currentUserId: "cm", systemOwnerId: "owner", readOnly: true });
    expect(drawer.getByText("Policy doc v2")).toBeInTheDocument();
    expect(drawer.getByText("Which version?")).toBeInTheDocument();
    expect(drawer.queryByLabelText("Status for A.5.1")).not.toBeInTheDocument();
    expect(drawer.queryByRole("textbox")).not.toBeInTheDocument();
    // Only the drawer's own way out is left.
    expect(drawer.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Close"]);
  });

  it.each(["auditor", "owner"] as const)("shows an Internal Auditor (recorded owner id %s) the Assessment and the question with no way to change them (#147)", async (systemOwnerId) => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", {
      userRole: "INTERNAL_AUDITOR",
      currentUserId: "auditor",
      systemOwnerId,
      readOnly: true,
      assessmentEditAccess: "none",
    });
    expect(drawer.getByText("Which version?")).toBeInTheDocument();
    expect(drawer.queryByLabelText("Status for A.5.1")).not.toBeInTheDocument();
    expect(drawer.queryByRole("textbox")).not.toBeInTheDocument();
    expect(drawer.getAllByRole("button")).toHaveLength(1);
  });

  it("with no Assessment edit access hides the edit form and the answers but keeps the question actions (#78)", async () => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", { userRole: "REVIEWER", currentUserId: "rev", systemOwnerId: "owner", assessmentEditAccess: "none" });
    expect(drawer.getByText("Policy doc v2")).toBeInTheDocument();
    expect(drawer.queryByLabelText("Status for A.5.1")).not.toBeInTheDocument();
    for (const name of ["Save", "Yes", "No", "N/A"]) expect(drawer.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "Reply" })).toBeInTheDocument();
  });

  it("with waive-only access offers just Waived / Not Applicable / N/A, and Save only once one is picked (#78)", async () => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", { userRole: "RISK_OWNER", currentUserId: "ro", systemOwnerId: "owner", assessmentEditAccess: "waive-only" });
    const select = drawer.getByLabelText("Status for A.5.1");
    expect(enabledOptions(drawer, "A.5.1")).toEqual(["Not Applicable", "Waived"]);
    expect(drawer.queryByLabelText("Evidence for A.5.1")).not.toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Yes" })).not.toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "No" })).not.toBeInTheDocument();
    expect(drawer.getByRole("button", { name: "N/A" })).toBeInTheDocument();
    // The current status (In progress) is shown but can't be saved as it is.
    expect(drawer.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "WAIVED" } });
    expect(drawer.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("Control drawer: waive options on a System the user owns (#97)", () => {
  const rows = () => [
    rowOf(control("MAND-1", { mandatory: true, question: "Do you do MAND-1?" }), assessment("IN_PROGRESS")),
    rowOf(control("OPT-1", { mandatory: false, question: "Do you do OPT-1?" }), assessment("IN_PROGRESS")),
  ];

  it("hides Waived / Not Applicable and the N/A answer on mandatory Controls from an owning Risk Owner, but keeps them on non-mandatory ones", async () => {
    stubApi(rows());
    const { drawer } = await renderDrawer("MAND-1", { userRole: "RISK_OWNER", currentUserId: "ro", systemOwnerId: "ro" });
    expect(enabledOptions(drawer, "MAND-1")).toEqual(["Not Started", "In Progress", "Fulfilled"]);
    expect(answerButtons(drawer)).toEqual(["Yes", "No"]);
    cleanup();

    stubApi(rows());
    const optional = await renderDrawer("OPT-1", { userRole: "RISK_OWNER", currentUserId: "ro", systemOwnerId: "ro" });
    expect(enabledOptions(optional.drawer, "OPT-1")).toEqual(["Not Started", "In Progress", "Fulfilled", "Not Applicable", "Waived"]);
    expect(answerButtons(optional.drawer)).toEqual(["Yes", "No", "N/A"]);
  });

  it("still offers an Admin who owns the System every option on mandatory Controls", async () => {
    stubApi(rows());
    const { drawer } = await renderDrawer("MAND-1", { userRole: "ADMIN", currentUserId: "admin", systemOwnerId: "admin" });
    expect(enabledOptions(drawer, "MAND-1")).toEqual(["Not Started", "In Progress", "Fulfilled", "Not Applicable", "Waived"]);
    expect(answerButtons(drawer)).toEqual(["Yes", "No", "N/A"]);
  });

  it("still offers a Risk Owner who doesn't own the System Waived / Not Applicable / N/A on mandatory Controls", async () => {
    stubApi(rows());
    const { drawer } = await renderDrawer("MAND-1", { userRole: "RISK_OWNER", currentUserId: "ro", systemOwnerId: "someone-else", assessmentEditAccess: "waive-only" });
    expect(enabledOptions(drawer, "MAND-1")).toEqual(["Not Applicable", "Waived"]);
    expect(answerButtons(drawer)).toEqual(["N/A"]);
  });

  it("disables Save for an owning Risk Owner on a mandatory Control already waived by someone else", async () => {
    stubApi([rowOf(control("MAND-1", { mandatory: true }), assessment("WAIVED", { notes: "Admin exception", assessedById: "admin" }))]);
    const { drawer } = await renderDrawer("MAND-1", { userRole: "RISK_OWNER", currentUserId: "ro", systemOwnerId: "ro" });
    const select = drawer.getByLabelText("Status for MAND-1") as HTMLSelectElement;
    expect(select.value).toBe("WAIVED");
    expect(drawer.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(select, { target: { value: "FULFILLED" } });
    expect(drawer.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("Control drawer: header, description and Self-Assessment Question (#244)", () => {
  it("shows the code and category, title, status, source, Mandatory, the description and the last person to set it", async () => {
    stubApi([
      rowOf(
        control("A.8.24", { title: "Use of cryptography", category: "A.8 Technological", mandatory: true }),
        assessment("FULFILLED", { assessedBy: { name: "Olivia Owner" }, assessedAt: "2026-09-02T10:00:00Z" }),
      ),
    ]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("A.8.24 · A.8 Technological")).toBeInTheDocument();
    expect(drawer.getByRole("heading", { name: "Use of cryptography" })).toBeInTheDocument();
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText("This System")).toBeInTheDocument();
    expect(drawer.getByText("Mandatory")).toBeInTheDocument();
    expect(drawer.getByText("Description of A.8.24.")).toBeInTheDocument();
    expect(drawer.getByText("Last set by Olivia Owner on 2 Sep 2026")).toBeInTheDocument();
  });

  it("says nothing about who set a status nobody set", async () => {
    stubApi([rowOf(control("A.1"), null)]);
    const { drawer } = await renderDrawer("A.1");
    expect(drawer.queryByText(/Last set by/)).not.toBeInTheDocument();
  });

  it("shows the Self-Assessment Question with its intent and examples", async () => {
    stubApi([rowOf(control("A.1", { question: "Is it encrypted?", intent: "Data at rest leaks.", examples: ["Disk encryption", "Key vault"] }), null)]);
    const { drawer } = await renderDrawer("A.1");
    const section = within(drawer.getByRole("region", { name: "Self-Assessment Question" }));
    expect(section.getByText("Is it encrypted?")).toBeInTheDocument();
    expect(section.getByText("Intent: Data at rest leaks.")).toBeInTheDocument();
    expect(section.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Disk encryption", "Key vault"]);
    expect(section.getByText("Answering No opens a Risk on this System.")).toBeInTheDocument();
  });

  it("has no question section for a Control without one", async () => {
    stubApi([rowOf(control("A.1"), null)]);
    const { drawer } = await renderDrawer("A.1");
    expect(drawer.queryByRole("region", { name: "Self-Assessment Question" })).not.toBeInTheDocument();
  });

  it("answers Yes: sends it with the justification, shows the recorded answer, and reads the page's figures again", async () => {
    const { calls } = stubApi([rowOf(control("A.1", { mandatory: true, question: "Is it encrypted?" }), null)], {
      handle: (call) => (call.url.endsWith("/answer") ? json({ assessment: assessment("FULFILLED", { selfAssessmentAnswer: "YES" }) }) : undefined),
    });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.type(drawer.getByLabelText("Self-assessment justification for A.1"), "All disks");
    await userEvent.click(drawer.getByRole("button", { name: "Yes" }));
    expect(await drawer.findByText("Recorded answer: Yes")).toBeInTheDocument();
    const sent = calls.find((call) => call.method === "PATCH");
    expect(sent).toMatchObject({ url: "/api/systems/s1/assessments/c-A.1/answer", body: { answer: "YES", notes: "All disks" } });
    // The answer sets the status too.
    expect(drawer.getByLabelText("Status for A.1")).toHaveValue("FULFILLED");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the API's refusal of an answer, and a failure of the request", async () => {
    let refuse = true;
    stubApi([rowOf(control("A.1", { question: "Is it encrypted?" }), null)], {
      handle: (call) => (call.url.endsWith("/answer") ? (refuse ? json({ error: "Not allowed to answer" }, 403) : Promise.reject(new Error("offline"))) : undefined),
    });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: "No" }));
    expect(await drawer.findByText("Not allowed to answer")).toBeInTheDocument();
    expect(drawer.queryByText(/Recorded answer/)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    refuse = false;
    await userEvent.click(drawer.getByRole("button", { name: "No" }));
    expect(await drawer.findByText("Failed to save answer")).toBeInTheDocument();
  });
});

describe("Control drawer: status, evidence and notes (#244)", () => {
  it("saves them, shows Saved, updates the header and the row, and reads the page's figures again", async () => {
    const { calls } = stubApi([rowOf(control("A.1", { title: "First Control" }), null)], {
      handle: saveAs({ evidence: "Link", notes: "Done", assessedBy: { name: "Olivia Owner" }, assessedAt: "2026-09-02T10:00:00Z" }),
    });
    const { drawer } = await renderDrawer("A.1");
    fireEvent.change(drawer.getByLabelText("Status for A.1"), { target: { value: "FULFILLED" } });
    await userEvent.type(drawer.getByLabelText("Evidence for A.1"), "Link");
    await userEvent.type(drawer.getByLabelText("Notes for A.1"), "Done");
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));

    expect(await drawer.findByRole("status")).toHaveTextContent("Saved");
    expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ url: "/api/systems/s1/assessments/c-A.1", body: { status: "FULFILLED", evidence: "Link", notes: "Done" } });
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText("Last set by Olivia Owner on 2 Sep 2026")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Editing again clears the confirmation.
    await userEvent.type(drawer.getByLabelText("Notes for A.1"), "!");
    expect(drawer.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.click(drawer.getByRole("button", { name: "Close" }));
    expect(within(document.querySelector<HTMLElement>('[data-control-code="A.1"]')!).getByText("Fulfilled")).toBeInTheDocument();
  });

  it("shows the API's message when a save is refused, keeps the form as typed and the drawer open", async () => {
    stubApi([rowOf(control("A.1", { mandatory: true }), assessment("IN_PROGRESS"))], {
      handle: (call) => (call.method === "PATCH" ? json({ error: "A justification is required" }, 400) : undefined),
    });
    const { drawer } = await renderDrawer("A.1", { userRole: "ADMIN", currentUserId: "admin" });
    fireEvent.change(drawer.getByLabelText("Status for A.1"), { target: { value: "WAIVED" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("A justification is required");
    expect(drawer.getByLabelText("Status for A.1")).toHaveValue("WAIVED");
    expect(drawer.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(drawer.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says so when the request fails altogether", async () => {
    stubApi([rowOf(control("A.1"), null)], { handle: (call) => (call.method === "PATCH" ? Promise.reject(new Error("offline")) : undefined) });
    const { drawer } = await renderDrawer("A.1");
    fireEvent.change(drawer.getByLabelText("Status for A.1"), { target: { value: "IN_PROGRESS" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("Failed to save assessment");
  });

  it("asks for a justification on a mandatory Control marked Not Applicable or Waived, and for notes otherwise", async () => {
    stubApi([rowOf(control("A.1", { mandatory: true }), assessment("IN_PROGRESS")), rowOf(control("A.2", { mandatory: false }), assessment("IN_PROGRESS"))]);
    const { drawer } = await renderDrawer("A.1", { userRole: "ADMIN", currentUserId: "admin" });
    expect(drawer.getByText("Notes (optional)")).toBeInTheDocument();
    fireEvent.change(drawer.getByLabelText("Status for A.1"), { target: { value: "NOT_APPLICABLE" } });
    expect(drawer.getByText("Justification (required)")).toBeInTheDocument();
  });

  it("submits the form on Enter in the evidence field", async () => {
    const { calls } = stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.type(drawer.getByLabelText("Evidence for A.1"), "Link{Enter}");
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
  });

  it("forgets what was typed when closed without saving", async () => {
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS", { notes: "Kept" }))]);
    const { drawer } = await renderDrawer("A.1");
    await userEvent.type(drawer.getByLabelText("Notes for A.1"), " and more");
    await userEvent.click(drawer.getByRole("button", { name: "Cancel" }));
    await userEvent.click(document.querySelector<HTMLElement>('[data-control-code="A.1"]')!);
    expect(await screen.findByLabelText("Notes for A.1")).toHaveValue("Kept");
  });
});

describe("Control drawer: Assessment Queries (#56, #201)", () => {
  it("raises a question, which appears in the thread and in the open count", async () => {
    const { calls } = stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], {
      handle: (call) => (call.url.endsWith("/queries") ? json({ query: openQuery("qn", "Show me the policy") }) : undefined),
    });
    const { drawer } = await renderDrawer("A.1", { userRole: "ADMIN", currentUserId: "admin" });
    expect(drawer.getByRole("heading", { name: "Questions" })).toBeInTheDocument();
    await userEvent.click(drawer.getByRole("button", { name: "Ask a question" }));
    await userEvent.type(drawer.getByLabelText("New question"), "Show me the policy");
    await userEvent.click(drawer.getByRole("button", { name: "Send" }));
    expect(await drawer.findByText("Show me the policy")).toBeInTheDocument();
    expect(drawer.getByRole("heading", { name: "Questions (1 open)" })).toBeInTheDocument();
    expect(drawer.queryByLabelText("New question")).not.toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: "/api/systems/s1/assessments/c-A.1/queries", body: { body: "Show me the policy" } });
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the API's refusal to raise a question and keeps the draft", async () => {
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], { handle: (call) => (call.method === "POST" ? json({ error: "Not allowed to ask" }, 403) : undefined) });
    const { drawer } = await renderDrawer("A.1", { userRole: "ADMIN", currentUserId: "admin" });
    await userEvent.click(drawer.getByRole("button", { name: "Ask a question" }));
    await userEvent.type(drawer.getByLabelText("New question"), "Why?");
    await userEvent.click(drawer.getByRole("button", { name: "Send" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("Not allowed to ask");
    expect(drawer.getByLabelText("New question")).toHaveValue("Why?");
  });

  it("lets the System's owner reply, not raise or resolve, and shows the reply", async () => {
    const reply = { ...openQuery("q1", "Which version?"), messages: [openQuery("q1", "Which version?").messages[0], { id: "m2", body: "Version 2", createdAt: "2026-09-02T00:00:00Z", attributedTo: null, author: { id: "owner", name: "Olivia Owner", role: "SYSTEM_OWNER" } }] };
    const { calls } = stubApi([policiesRow()], { handle: (call) => (call.url.endsWith("/messages") ? json({ query: reply }) : undefined) });
    const { drawer } = await renderDrawer("A.5.1");
    expect(drawer.queryByRole("button", { name: "Ask a question" })).not.toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Mark Resolved" })).not.toBeInTheDocument();
    await userEvent.type(drawer.getByLabelText("Reply"), "Version 2");
    await userEvent.click(drawer.getByRole("button", { name: "Reply" }));
    expect(await drawer.findByText("Version 2")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: "/api/systems/s1/assessments/c-A.5.1/queries/q1/messages", body: { body: "Version 2" } });
    expect(drawer.getByLabelText("Reply")).toHaveValue("");
  });

  it("resolves a question with attribution, and the row's open-question badge goes", async () => {
    const resolved = { ...openQuery("q1", "Which version?"), resolved: true, resolvedBy: { id: "admin", name: "Ada Admin" }, resolvedAttributedTo: "GDPR group" };
    const { calls } = stubApi([policiesRow({ canManageQueries: true })], { handle: (call) => (call.url.endsWith("/resolve") ? json({ query: resolved }) : undefined) });
    const { drawer } = await renderDrawer("A.5.1", { userRole: "ADMIN", currentUserId: "admin" });
    expect(drawer.getByRole("heading", { name: "Questions (1 open)" })).toBeInTheDocument();
    await userEvent.click(drawer.getByRole("button", { name: "Mark Resolved" }));
    expect(await drawer.findByText("by Ada Admin for GDPR group")).toBeInTheDocument();
    expect(drawer.getByText("Resolved")).toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Mark Resolved" })).not.toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.url).toBe("/api/systems/s1/assessments/c-A.5.1/queries/q1/resolve");
    await userEvent.click(drawer.getByRole("button", { name: "Close" }));
    expect(within(document.querySelector<HTMLElement>('[data-control-code="A.5.1"]')!).queryByText(/open question/)).not.toBeInTheDocument();
  });

  it("shows the API's refusal of a reply", async () => {
    stubApi([policiesRow()], { handle: (call) => (call.url.endsWith("/messages") ? json({ error: "Thread is closed" }, 409) : undefined) });
    const { drawer } = await renderDrawer("A.5.1");
    await userEvent.type(drawer.getByLabelText("Reply"), "Hello");
    await userEvent.click(drawer.getByRole("button", { name: "Reply" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("Thread is closed");
    expect(drawer.getByLabelText("Reply")).toHaveValue("Hello");
  });

  describe("Review Group members and attributed questions (#201)", () => {
    const thread = [
      {
        id: "q1",
        resolved: true,
        createdAt: "2026-09-01T00:00:00Z",
        resolvedAttributedTo: "GDPR group",
        messages: [
          { id: "m1", body: "Where is the record?", createdAt: "2026-09-01T00:00:00Z", attributedTo: "GDPR group" },
          { id: "m2", body: "Attached", createdAt: "2026-09-02T00:00:00Z", attributedTo: null, author: { id: "owner", name: "Olivia Owner", role: "SYSTEM_OWNER" } },
          { id: "m3", body: "Seen by a Reviewer", createdAt: "2026-09-03T00:00:00Z", attributedTo: "Base review", author: { id: "rev", name: "Rita Reviewer", role: "REVIEWER" } },
        ],
      },
    ];
    const row = (extra: Record<string, unknown>, queries: unknown[] = []) => rowOf(control("GDPR.1", { title: "Records of processing", mandatory: true }), assessment("IN_PROGRESS", { queries }), [], extra);

    it("offers a Viewer who is a member the question button when the server says they may, and not otherwise", async () => {
      stubApi([row({ canManageQueries: true })]);
      const allowed = await renderDrawer("GDPR.1", { userRole: "VIEWER", currentUserId: "member", systemOwnerId: "owner", readOnly: true });
      expect(allowed.drawer.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
      cleanup();

      stubApi([row({ canManageQueries: false })]);
      const denied = await renderDrawer("GDPR.1", { userRole: "VIEWER", currentUserId: "member", systemOwnerId: "owner", readOnly: true });
      expect(denied.drawer.getByText("Records of processing")).toBeInTheDocument();
      expect(denied.drawer.queryByRole("button", { name: "Ask a question" })).not.toBeInTheDocument();
    });

    it("offers a Reviewer the button when the server doesn't say (the role decides)", async () => {
      stubApi([row({})]);
      const { drawer } = await renderDrawer("GDPR.1", { userRole: "REVIEWER", currentUserId: "rev", systemOwnerId: "owner" });
      expect(drawer.getByRole("button", { name: "Ask a question" })).toBeInTheDocument();
    });

    it("shows a message with no author as its group, a named one by name, and the person next to the group when sent", async () => {
      stubApi([row({ canManageQueries: false }, thread)]);
      const { drawer } = await renderDrawer("GDPR.1");
      const first = drawer.getByText("Where is the record?").previousElementSibling as HTMLElement;
      expect(first).toHaveTextContent(/^GDPR group/);
      expect(first).not.toHaveTextContent("SYSTEM_OWNER");
      expect(drawer.getByText("Attached").previousElementSibling).toHaveTextContent("Olivia Owner (SYSTEM_OWNER)");
      expect(drawer.getByText("Seen by a Reviewer").previousElementSibling).toHaveTextContent("Rita Reviewer (REVIEWER) for Base review");
      // Resolved by the group: shown as the group, since the server sent no person.
      expect(drawer.getByText(/^by GDPR group/)).toBeInTheDocument();
    });
  });
});

describe("Control drawer: removing a stale Assessment (#109)", () => {
  const staleOf = (queries: unknown[] = []) => ({ ...assessment("FULFILLED", { evidence: "Old evidence", id: "stale-a1" }), control: control("STALE-1", { id: "stale-c1", title: "Stale Control" }), queries });
  const resolved = openQuery("sq2", "Still true?", { resolved: true });

  it("shows a stale Assessment's drawer with a note that it no longer applies", async () => {
    stubApi([], { stale: [staleOf()] });
    const { drawer } = await renderDrawer("STALE-1");
    expect(drawer.getByText(/No longer applicable to this System's current classification or Framework Scope/)).toBeInTheDocument();
    expect(drawer.getByLabelText("Evidence for STALE-1")).toHaveValue("Old evidence");
    // It has no effective status and nothing to answer or reset.
    expect(drawer.queryByText(/Source:/)).not.toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it.each([
    ["the System's owner", "SYSTEM_OWNER", "owner", "owner"],
    ["an owning Risk Owner", "RISK_OWNER", "ro", "ro"],
    ["an Admin who doesn't own the System", "ADMIN", "admin", "owner"],
  ] as const)("offers Remove to %s", async (_label, role, userId, ownerId) => {
    stubApi([], { stale: [staleOf()] });
    const { drawer } = await renderDrawer("STALE-1", { userRole: role, currentUserId: userId, systemOwnerId: ownerId });
    expect(drawer.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it.each([
    ["a SYSTEM_OWNER who doesn't own the System", "SYSTEM_OWNER", "other", "owner", false],
    ["a Reviewer", "REVIEWER", "reviewer", "owner", false],
    ["a Risk Owner who doesn't own the System", "RISK_OWNER", "ro", "owner", false],
    ["a Compliance Manager, even as the recorded owner", "COMPLIANCE_MANAGER", "cm", "cm", false],
    ["an Internal Auditor, even as the recorded owner", "INTERNAL_AUDITOR", "ia", "ia", false],
    ["an owner on a read-only page", "SYSTEM_OWNER", "owner", "owner", true],
  ] as const)("hides Remove from %s", async (_label, role, userId, ownerId, readOnly) => {
    stubApi([], { stale: [staleOf()] });
    const { drawer } = await renderDrawer("STALE-1", { userRole: role, currentUserId: userId, systemOwnerId: ownerId, readOnly });
    expect(drawer.getByRole("heading", { name: "Stale Control" })).toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows a note instead of the button while an open question exists, and offers it once only resolved ones remain", async () => {
    stubApi([], { stale: [staleOf([openQuery("sq1", "Still true?")])] });
    const open = await renderDrawer("STALE-1");
    expect(open.drawer.getByText(/can't be removed while it has an open question/)).toBeInTheDocument();
    expect(open.drawer.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    cleanup();

    stubApi([], { stale: [staleOf([resolved])] });
    const done = await renderDrawer("STALE-1");
    expect(done.drawer.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("never offers Remove on an applicable Assessment", async () => {
    stubApi([policiesRow()]);
    const { drawer } = await renderDrawer("A.5.1", { userRole: "ADMIN", currentUserId: "admin" });
    expect(drawer.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("asks to confirm, then removes the Assessment, closes the drawer and drops the row and the section", async () => {
    const { calls } = stubApi([], { stale: [staleOf()], handle: (call) => (call.method === "DELETE" ? json({ removed: true }) : undefined) });
    const confirm = vi.spyOn(window, "confirm");
    const { drawer } = await renderDrawer("STALE-1");

    // Declined: nothing is sent.
    confirm.mockReturnValueOnce(false);
    await userEvent.click(drawer.getByRole("button", { name: "Remove" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Confirmed: DELETE, then the drawer closes and the row and the now-empty section are gone.
    confirm.mockReturnValueOnce(true);
    await userEvent.click(drawer.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.find((call) => call.method === "DELETE")?.url).toBe("/api/systems/s1/assessments/stale-c1");
    expect(screen.queryByRole("region", { name: "No longer applicable" })).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#controls");
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the Assessment and shows the server's message when removal is refused", async () => {
    stubApi([], { stale: [staleOf()], handle: (call) => (call.method === "DELETE" ? json({ error: "This Control still applies; set its status instead" }, 409) : undefined) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { drawer } = await renderDrawer("STALE-1");
    await userEvent.click(drawer.getByRole("button", { name: "Remove" }));
    expect(await drawer.findByText("This Control still applies; set its status instead")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Control drawer: effective status and its source (#121)", () => {
  const ACCESS = control("A.5.15", { title: "Access control", mandatory: true });

  it("shows an untouched Both Control as Fulfilled, inherited from the Organization, while the form still edits the System's own status", async () => {
    stubApi([rowOf(ACCESS, assessment("NOT_STARTED", { assessedById: null }), [organization("FULFILLED")])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText("Organization", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Source: Inherited from Organization · Organization: Fulfilled/)).toBeInTheDocument();
    // The callout: the status shows live, and saving a status overrides it.
    expect(drawer.getByText(/Its status shows here live\. Saving a status below sets this System's own Assessment, which then overrides the inherited one\./)).toBeInTheDocument();
    expect(drawer.getByLabelText("Status for A.5.15")).toHaveValue("NOT_STARTED");
  });

  it("shows a Control with no Assessment row as inherited too", async () => {
    stubApi([rowOf(ACCESS, null, [organization("FULFILLED")])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Source: Inherited from Organization/)).toBeInTheDocument();
  });

  it("shows the Organization's status even when it gives no credit, and the Control as System-specific, with no callout", async () => {
    stubApi([rowOf(ACCESS, assessment("NOT_STARTED", { assessedById: null }), [organization("WAIVED")])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText("Not started", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Source: System-specific · Organization: Waived \(gives no credit\)/)).toBeInTheDocument();
    expect(drawer.queryByText(/Its status shows here live/)).not.toBeInTheDocument();
  });

  it("says in one line when the System's own person-set Assessment overrides a Fulfilled Organization", async () => {
    stubApi([rowOf(ACCESS, assessment("IN_PROGRESS"), [organization("FULFILLED")])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText(/Source: System-specific · Organization: Fulfilled/)).toBeInTheDocument();
    expect(drawer.getByText(/This System's own Assessment \(In Progress\) overrides the Organization's Fulfilled status\./)).toBeInTheDocument();
  });

  it("names a Per-System Control System-specific, with no other source", async () => {
    stubApi([rowOf(ACCESS, assessment("FULFILLED"), [])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText("Source: System-specific")).toBeInTheDocument();
  });

  it("after the owner saves a status, that own Assessment decides and the inherited one is overridden", async () => {
    stubApi([rowOf(ACCESS, assessment("NOT_STARTED", { assessedById: null }), [organization("FULFILLED")])], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.5.15");
    fireEvent.change(drawer.getByLabelText("Status for A.5.15"), { target: { value: "IN_PROGRESS" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    expect(await drawer.findByText(/overrides the Organization's Fulfilled status/)).toBeInTheDocument();
    expect(drawer.getByText(/Source: System-specific · Organization: Fulfilled/)).toBeInTheDocument();
    expect(drawer.getByText("In progress", { selector: "span" })).toBeInTheDocument();
  });

  it("falls back to the own status when the response carries no effective status", async () => {
    stubApi([{ control: ACCESS, assessment: assessment("WAIVED") }]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByText("Waived", { selector: "span" })).toBeInTheDocument();
    expect(drawer.queryByText(/Source:/)).not.toBeInTheDocument();
  });
});

describe("Control drawer: reset to inherited (#129)", () => {
  const ACCESS = control("A.5.15", { title: "Access control", mandatory: true });
  const person = () => assessment("IN_PROGRESS", { evidence: "Policy doc v2", notes: "Working on it", queries: [openQuery("rq1", "Which policy?")] });
  const untouched = () => assessment("NOT_STARTED", { assessedById: null, queries: [openQuery("rq1", "Which policy?")] });

  it.each([
    ["the System's owner", "SYSTEM_OWNER", "owner"],
    ["an owning Risk Owner", "RISK_OWNER", "owner"],
    ["an Admin who doesn't own the System", "ADMIN", "admin"],
  ] as const)("offers the action to %s on a person-set Assessment of a Control with a source", async (_label, role, userId) => {
    stubApi([rowOf(ACCESS, person(), [organization("FULFILLED")])]);
    const { drawer } = await renderDrawer("A.5.15", { userRole: role, currentUserId: userId });
    expect(drawer.getByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });

  it("offers it whatever the source's status, since the Control just goes back to what the source gives", async () => {
    stubApi([rowOf(ACCESS, person(), [organization("WAIVED")])]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });

  it.each([
    ["an untouched Assessment", () => rowOf(ACCESS, assessment("NOT_STARTED", { assessedById: null }), [organization("FULFILLED")])],
    ["a Control with no Assessment row", () => rowOf(ACCESS, null, [organization("FULFILLED")])],
    ["a Control with no inheritance source", () => rowOf(ACCESS, person(), [])],
    ["a row the API sent without an effective status", () => ({ control: ACCESS, assessment: person() })],
  ])("doesn't offer it on %s", async (_label, makeRow) => {
    stubApi([makeRow()]);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it.each([
    ["a SYSTEM_OWNER who doesn't own the System", { userRole: "SYSTEM_OWNER", currentUserId: "other" }],
    ["a Reviewer", { userRole: "REVIEWER", currentUserId: "reviewer", assessmentEditAccess: "none" }],
    ["a Risk Owner who doesn't own the System (waive-only)", { userRole: "RISK_OWNER", currentUserId: "ro", assessmentEditAccess: "waive-only" }],
    ["a Risk Owner who doesn't own the System, even given full access", { userRole: "RISK_OWNER", currentUserId: "ro" }],
    ["a Compliance Manager, even as the recorded owner", { userRole: "COMPLIANCE_MANAGER", currentUserId: "owner" }],
    ["an Internal Auditor, even as the recorded owner", { userRole: "INTERNAL_AUDITOR", currentUserId: "owner" }],
    ["an owner on a read-only page", { readOnly: true }],
  ] as const)("hides it from %s", async (_label, props) => {
    stubApi([rowOf(ACCESS, person(), [organization("FULFILLED")])]);
    const { drawer } = await renderDrawer("A.5.15", props);
    expect(drawer.getByRole("heading", { name: "Access control" })).toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it("asks first, saying what is cleared and what stays, and sends nothing when declined", async () => {
    const { calls } = stubApi([rowOf(ACCESS, person(), [organization("FULFILLED")])]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { drawer } = await renderDrawer("A.5.15");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain("A.5.15");
    expect(message).toMatch(/clears this System's own status, evidence, notes and Self-Assessment answer/);
    expect(message).toMatch(/Organization: Fulfilled/);
    expect(message).toMatch(/Assessment Queries and any Risks linked to it stay/);
    expect(message).toMatch(/Change Event log/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(drawer.getByLabelText("Status for A.5.15")).toHaveValue("IN_PROGRESS");
  });

  it("after a confirmed reset shows the effective status and source again, with the form back to Not Started and empty", async () => {
    const sources = [organization("FULFILLED")];
    const { calls } = stubApi([rowOf(ACCESS, person(), sources)], { handle: (call) => (call.url.endsWith("/reset") ? json(rowOf(ACCESS, untouched(), sources)) : undefined) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.getByLabelText("Status for A.5.15")).toHaveValue("IN_PROGRESS");
    expect(drawer.getByLabelText("Evidence for A.5.15")).toHaveValue("Policy doc v2");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));

    expect(await drawer.findByText(/Source: Inherited from Organization/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: "/api/systems/s1/assessments/c-A.5.15/reset" });
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByLabelText("Status for A.5.15")).toHaveValue("NOT_STARTED");
    expect(drawer.getByLabelText("Evidence for A.5.15")).toHaveValue("");
    expect(drawer.getByLabelText("Notes for A.5.15")).toHaveValue("");
    // Nothing left to reset, and the question stays.
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
    expect(drawer.getByText("Which policy?")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the Control as Not Started, System-specific, when the source gives no credit", async () => {
    const sources = [organization("WAIVED")];
    stubApi([rowOf(ACCESS, person(), sources)], { handle: (call) => (call.url.endsWith("/reset") ? json(rowOf(ACCESS, untouched(), sources)) : undefined) });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { drawer } = await renderDrawer("A.5.15");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));
    expect(await drawer.findByText(/Source: System-specific · Organization: Waived \(gives no credit\)/)).toBeInTheDocument();
    expect(drawer.getByText("Not started", { selector: "span" })).toBeInTheDocument();
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it("keeps the Assessment and shows the server's message when the reset is refused", async () => {
    stubApi([rowOf(ACCESS, person(), [organization("FULFILLED")])], {
      handle: (call) => (call.url.endsWith("/reset") ? json({ error: "This Assessment was not set by a person, so it already follows the Control's inheritance sources" }, 409) : undefined),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { drawer } = await renderDrawer("A.5.15");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));
    expect(await drawer.findByText(/was not set by a person/)).toBeInTheDocument();
    expect(drawer.getByLabelText("Status for A.5.15")).toHaveValue("IN_PROGRESS");
    expect(drawer.getByRole("button", { name: "Reset to inherited" })).toBeEnabled();
  });

  it("offers the action after the owner saves a status over an inherited Control", async () => {
    stubApi([rowOf(ACCESS, assessment("NOT_STARTED", { assessedById: null }), [organization("FULFILLED")])], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.5.15");
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
    fireEvent.change(drawer.getByLabelText("Status for A.5.15"), { target: { value: "IN_PROGRESS" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    expect(await drawer.findByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });
});

describe("Control drawer: Provider sources (#124, #125)", () => {
  const CRYPTO = control("A.8.24", { title: "Use of cryptography", category: "A.8 Technological", mandatory: true });

  it("shows a Per-System Control as Fulfilled, fully covered by the Provider, with the Provider's status", async () => {
    stubApi([rowOf(CRYPTO, assessment("NOT_STARTED", { assessedById: null }), [provider()])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText("Landing Zone", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Fully covered by Provider .*Nothing for this System to do\./)).toBeInTheDocument();
    expect(drawer.getByText(/Source: Inherited from Provider Landing Zone: Full · Provider "Landing Zone" \(Full\): Fulfilled/)).toBeInTheDocument();
    expect(drawer.getByLabelText("Status for A.8.24")).toHaveValue("NOT_STARTED");
  });

  it("lists every source: the Organization and two Providers, the one that gives no credit with its reason", async () => {
    stubApi([
      rowOf(CRYPTO, null, [
        organization("NOT_STARTED"),
        provider({ provider: { id: "pa", name: "Alpha" }, providerOnboarded: false }),
        provider({ provider: { id: "pb", name: "Beta" } }),
      ]),
    ]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText(/Source: Inherited from Provider Beta: Full/)).toBeInTheDocument();
    expect(drawer.getByText(/Organization: Not Started \(gives no credit\)/)).toBeInTheDocument();
    expect(drawer.getByText(/Provider "Alpha" \(Full\): Fulfilled \(pending: Provider not Onboarded\)/)).toBeInTheDocument();
    expect(drawer.getByText(/Provider "Beta" \(Full\): Fulfilled/)).toBeInTheDocument();
  });

  it("shows a pending Provider as pending, System-specific and Not started, with no 'covered' callout", async () => {
    stubApi([rowOf(CRYPTO, assessment("NOT_STARTED", { assessedById: null }), [provider({ providerOnboarded: false })])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("Not started", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Source: System-specific · Provider "Landing Zone" \(Full\): Fulfilled \(pending: Provider not Onboarded\)/)).toBeInTheDocument();
    expect(drawer.queryByText(/Fully covered/)).not.toBeInTheDocument();
  });

  it("says in one line when the System's own person-set Assessment overrides a Provider's Fulfilled status", async () => {
    stubApi([rowOf(CRYPTO, assessment("IN_PROGRESS"), [provider()])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText(/This System's own Assessment \(In Progress\) overrides Provider "Landing Zone"'s Fulfilled status\./)).toBeInTheDocument();
    expect(await drawer.findByRole("button", { name: "Reset to inherited" })).toBeInTheDocument();
  });

  it("after the owner saves, the own status decides and the Provider is named as overridden, using only what the API sent", async () => {
    stubApi([rowOf(CRYPTO, assessment("NOT_STARTED", { assessedById: null }), [provider()])], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.8.24");
    fireEvent.change(drawer.getByLabelText("Status for A.8.24"), { target: { value: "IN_PROGRESS" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    expect(await drawer.findByText(/overrides Provider "Landing Zone"'s Fulfilled status/)).toBeInTheDocument();
  });

  it("shows a Shared Offering's callout: each Provider's customer responsibility before the status field", async () => {
    stubApi([rowOf(CRYPTO, null, [shared(), shared({ provider: { id: "p3", name: "Alpha Cloud" }, customerResponsibility: "Rotate the keys yearly" })])]);
    const { drawer } = await renderDrawer("A.8.24");
    const note = drawer.getByRole("note", { name: "Customer responsibility for A.8.24" });
    expect(within(note).getByText('Provider "Landing Zone": The tenant manages its own keys')).toBeInTheDocument();
    expect(within(note).getByText('Provider "Alpha Cloud": Rotate the keys yearly')).toBeInTheDocument();
    expect(within(note).getByText("Set the status below to Fulfilled once this System has done it.")).toBeInTheDocument();
    expect(note.compareDocumentPosition(drawer.getByLabelText("Status for A.8.24")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no customer-responsibility callout for a Control with no Shared Offering", async () => {
    stubApi([rowOf(CRYPTO, null, [provider()])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.queryByRole("note")).not.toBeInTheDocument();
  });

  it("shows the callout to a read-only viewer too, without the hint to set a status", async () => {
    stubApi([rowOf(CRYPTO, null, [shared()])]);
    const { drawer } = await renderDrawer("A.8.24", { userRole: "VIEWER", currentUserId: "v", readOnly: true });
    const note = drawer.getByRole("note", { name: "Customer responsibility for A.8.24" });
    expect(within(note).getByText('Provider "Landing Zone": The tenant manages its own keys')).toBeInTheDocument();
    expect(within(note).queryByText(/Set the status below/)).not.toBeInTheDocument();
  });

  it("Shared and untouched: Not started, and the missing half is this System's own", async () => {
    stubApi([rowOf(CRYPTO, null, [shared()])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("Not started", { selector: "span" })).toBeInTheDocument();
    expect(
      drawer.getByText(/Source: System-specific · Provider "Landing Zone" \(Shared\): Fulfilled \(this System's own half is not Fulfilled; customer responsibility: The tenant manages its own keys\)/),
    ).toBeInTheDocument();
  });

  it("Shared, own half Fulfilled and the Provider's done: Fulfilled through the Provider, with no 'overrides' sentence", async () => {
    stubApi([rowOf(CRYPTO, assessment("FULFILLED"), [shared()])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/Source: Inherited from Provider Landing Zone: Shared/)).toBeInTheDocument();
    expect(drawer.queryByText(/overrides/)).not.toBeInTheDocument();
    expect(drawer.queryByText(/Fully covered/)).not.toBeInTheDocument();
  });

  it("Shared, own half Fulfilled and the Provider's half missing: In progress, and the page says who it waits for", async () => {
    stubApi([rowOf(CRYPTO, assessment("FULFILLED"), [shared({ status: "IN_PROGRESS" })])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("In progress", { selector: "span" })).toBeInTheDocument();
    expect(drawer.getByText(/This System's own half is Fulfilled, but it is waiting for Provider "Landing Zone" to provide its half, so the Control is In Progress\./)).toBeInTheDocument();
    expect(drawer.getByLabelText("Status for A.8.24")).toHaveValue("FULFILLED"); // the form still edits the own half
  });

  it("after the owner saves Fulfilled, the row is re-resolved from the sources the API sent: Fulfilled through the Shared Offering", async () => {
    stubApi([rowOf(CRYPTO, null, [shared()])], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.getByText("Not started", { selector: "span" })).toBeInTheDocument();
    fireEvent.change(drawer.getByLabelText("Status for A.8.24"), { target: { value: "FULFILLED" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(drawer.getByText("Fulfilled", { selector: "span" })).toBeInTheDocument());
    expect(drawer.getByText(/Source: Inherited from Provider Landing Zone: Shared/)).toBeInTheDocument();
  });

  it("doesn't offer Reset to inherited when only Shared Offerings cover the Control (D2)", async () => {
    stubApi([rowOf(CRYPTO, assessment("FULFILLED"), [shared(), shared({ provider: { id: "p3", name: "Alpha Cloud" } })])]);
    const { drawer } = await renderDrawer("A.8.24");
    expect(drawer.queryByRole("button", { name: "Reset to inherited" })).not.toBeInTheDocument();
  });

  it("the reset confirmation names only the Full sources it goes back to", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    stubApi([rowOf(CRYPTO, assessment("IN_PROGRESS"), [shared(), provider({ status: "NOT_STARTED", provider: { id: "p2", name: "Zed Cloud" } })])]);
    const { drawer } = await renderDrawer("A.8.24");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain('Provider "Zed Cloud" (Full): Not Started (gives no credit)');
    expect(message).not.toContain("Landing Zone");
  });
});

describe("Control drawer: what the System inherits (#244)", () => {
  it("is read on mount, so the page's key (a remount when a Provider dependency changes) shows the new sources", async () => {
    const crypto = control("A.8.24", { title: "Use of cryptography" });
    stubApi([rowOf(crypto, null, [])]);
    window.history.replaceState(null, "", "/systems/s1#controls");
    const first = renderControls();
    await screen.findByText("Use of cryptography");
    expect(within(document.querySelector<HTMLElement>('[data-control-code="A.8.24"]')!).getByText("Not started")).toBeInTheDocument();
    first.unmount();

    const { fetchMock } = stubApi([rowOf(crypto, null, [provider()])]);
    renderControls();
    await waitFor(() => expect(within(document.querySelector<HTMLElement>('[data-control-code="A.8.24"]')!).getByText("Landing Zone")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/assessments");
  });
});

describe("Control drawer after the page refreshes itself (#244)", () => {
  // Next's router writes its own stored URL back on router.refresh(), dropping the Control from the hash.
  const rewritesUrl = () => refresh.mockImplementation(() => window.history.replaceState(null, "", "/systems/s1#controls"));

  async function closesWithEscape() {
    await waitFor(() => expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#controls");
  }

  it("keeps the Control in the URL, focus inside, and closes on Escape after a save", async () => {
    rewritesUrl();
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.1");
    fireEvent.change(drawer.getByLabelText("Status for A.1"), { target: { value: "FULFILLED" } });
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    await drawer.findByRole("status");
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(window.location.hash).toBe("#controls/A.1"));
    await closesWithEscape();
  });

  it("closes with ✕ after a save", async () => {
    rewritesUrl();
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], { handle: saveAs() });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: "Save" }));
    await drawer.findByRole("status");
    await userEvent.click(drawer.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.location.hash).toBe("#controls");
  });

  it("closes after an answer", async () => {
    rewritesUrl();
    stubApi([rowOf(control("A.1", { question: "Is it encrypted?" }), null)], {
      handle: (call) => (call.url.endsWith("/answer") ? json({ assessment: assessment("FULFILLED", { selfAssessmentAnswer: "YES" }) }) : undefined),
    });
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: "Yes" }));
    await drawer.findByText("Recorded answer: Yes");
    await closesWithEscape();
  });

  it("closes after a question is raised", async () => {
    rewritesUrl();
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"))], { handle: (call) => (call.url.endsWith("/queries") ? json({ query: openQuery("qn", "Why?") }) : undefined) });
    const { drawer } = await renderDrawer("A.1", { userRole: "ADMIN", currentUserId: "admin" });
    await userEvent.click(drawer.getByRole("button", { name: "Ask a question" }));
    await userEvent.type(drawer.getByLabelText("New question"), "Why?");
    await userEvent.click(drawer.getByRole("button", { name: "Send" }));
    await drawer.findByText("Why?", { selector: "p" });
    await closesWithEscape();
  });

  it("closes after a reset to inherited", async () => {
    rewritesUrl();
    const sources = [organization("FULFILLED")];
    stubApi([rowOf(control("A.1"), assessment("IN_PROGRESS"), sources)], {
      handle: (call) => (call.url.endsWith("/reset") ? json(rowOf(control("A.1"), assessment("NOT_STARTED", { assessedById: null }), sources)) : undefined),
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { drawer } = await renderDrawer("A.1");
    await userEvent.click(drawer.getByRole("button", { name: "Reset to inherited" }));
    await drawer.findByText(/Source: Inherited from Organization/);
    await closesWithEscape();
  });
});
