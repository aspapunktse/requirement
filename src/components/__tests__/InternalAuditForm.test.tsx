import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InternalAuditForm } from "../InternalAuditForm";
import type { InternalAuditDetail } from "@/lib/internal-audits";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back: vi.fn() }),
}));

const controls = [
  { id: "c1", code: "SEC-001", title: "Access control", applicability: "PER_SYSTEM" as const },
  { id: "c2", code: "ORG-002", title: "Policy review", applicability: "ORGANIZATIONAL" as const },
];
const systems = [
  { id: "s1", name: "Payroll", vendor: "Acme", status: "ONBOARDED" as const },
  { id: "s2", name: "Wiki", vendor: null, status: "DRAFT" as const },
];

const FUTURE = "2999-01-01";

function mockFetch(response: { status: number; body: unknown } = { status: 201, body: { internalAudit: { id: "a1" } } }) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(response.body), { status: response.status })));
}

function submitCalls() {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls as unknown as [string, RequestInit][];
}

describe("InternalAuditForm (#152)", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names everything missing and sends nothing when submitted empty", async () => {
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.click(screen.getByRole("button", { name: "Create draft" }));

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("A title is required")).toBeInTheDocument();
    expect(within(alert).getByText("Pick at least one Control")).toBeInTheDocument();
    expect(within(alert).getByText("A due date is required")).toBeInTheDocument();
    expect(within(alert).getByText("Pick at least one System or include the Organization")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a past due date", async () => {
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.type(screen.getByLabelText("Title"), "Access review");
    await user.click(screen.getByLabelText("SEC-001 Access control"));
    await user.click(screen.getByLabelText("Include the Organization Control Implementations"));
    await user.type(screen.getByLabelText("Due date"), "2001-01-01");
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The due date can't be in the past");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts the Organization instead of a System, posts the picks and goes to the new audit", async () => {
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.type(screen.getByLabelText("Title"), "Access review");
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    await user.click(screen.getByLabelText("ORG-002 Policy review"));
    await user.click(screen.getByLabelText("Include the Organization Control Implementations"));
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/internal-audits/a1"));
    const [url, init] = submitCalls()[0];
    expect(url).toBe("/api/internal-audits");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Access review",
      dueDate: FUTURE,
      includeOrganization: true,
      controlIds: ["c2"],
      systemIds: [],
    });
  });

  it("filters the Controls by code or title, and keeps the picked ones visible", async () => {
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.type(screen.getByLabelText("Search Controls by code or title"), "policy");
    expect(screen.queryByLabelText("SEC-001 Access control")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("ORG-002 Policy review"));
    await user.clear(screen.getByLabelText("Search Controls by code or title"));

    const picked = screen.getByRole("list", { name: "Picked: Controls to audit" });
    expect(within(picked).getByText("ORG-002")).toBeInTheDocument();
    await user.click(within(picked).getByRole("button", { name: "Remove ORG-002" }));
    expect(screen.queryByRole("list", { name: "Picked: Controls to audit" })).not.toBeInTheDocument();
  });

  it("filters the Systems by vendor", async () => {
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.type(screen.getByLabelText("Search Systems by name or vendor"), "acme");
    expect(screen.getByLabelText("Payroll Acme")).toBeInTheDocument();
    expect(screen.queryByLabelText("Wiki")).not.toBeInTheDocument();
  });

  it("shows the API's message when the save is refused", async () => {
    vi.stubGlobal("fetch", mockFetch({ status: 409, body: { error: "Only a draft can be edited" } }));
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} />);

    await user.type(screen.getByLabelText("Title"), "Access review");
    await user.type(screen.getByLabelText("Due date"), FUTURE);
    await user.click(screen.getByLabelText("SEC-001 Access control"));
    await user.click(screen.getByLabelText("Payroll Acme"));
    await user.click(screen.getByRole("button", { name: "Create draft" }));

    expect(await screen.findByText("Only a draft can be edited")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  describe("editing", () => {
    const initial: InternalAuditDetail = {
      id: "a9",
      title: "Existing audit",
      scopeDescription: "Scope",
      dueDate: "2001-02-03",
      status: "DRAFT",
      includeOrganization: false,
      createdBy: { id: "u1", name: "Auditor" },
      createdAt: "2026-10-13T00:00:00.000Z",
      updatedAt: "2026-10-13T00:00:00.000Z",
      controls: [controls[0]],
      systems: [{ id: "s1", name: "Payroll", status: "ONBOARDED" }],
    };

    it("starts from the saved values and PATCHes; an unchanged past due date isn't refused", async () => {
      vi.stubGlobal("fetch", mockFetch({ status: 200, body: { internalAudit: { id: "a9" } } }));
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} initial={initial} />);

      expect(screen.getByLabelText("Title")).toHaveValue("Existing audit");
      await user.type(screen.getByLabelText("Title"), " v2");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(push).toHaveBeenCalledWith("/internal-audits/a9"));
      const [url, init] = submitCalls()[0];
      expect(url).toBe("/api/internal-audits/a9");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toMatchObject({ title: "Existing audit v2", controlIds: ["c1"], systemIds: ["s1"] });
    });

    it("refuses changing the due date to a past one", async () => {
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} initial={initial} />);

      await user.clear(screen.getByLabelText("Due date"));
      await user.type(screen.getByLabelText("Due date"), "2002-02-02");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("alert")).toHaveTextContent("The due date can't be in the past");
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
