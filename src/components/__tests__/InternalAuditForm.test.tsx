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

const filterOptions = {
  frameworks: [{ id: "f1", name: "NIS2", version: "2022" }],
  deploymentFacets: [{ id: "d1", name: "Cloud SaaS" }],
  businessUnits: [{ id: "b1", name: "Finance" }],
};

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
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

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
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

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
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

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
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

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
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

    await user.type(screen.getByLabelText("Search Systems by name or vendor"), "acme");
    expect(screen.getByLabelText("Payroll Acme")).toBeInTheDocument();
    expect(screen.queryByLabelText("Wiki")).not.toBeInTheDocument();
  });

  it("shows the API's message when the save is refused", async () => {
    vi.stubGlobal("fetch", mockFetch({ status: 409, body: { error: "Only a draft can be edited" } }));
    const user = userEvent.setup();
    render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

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
      launchedAt: null,
      launchedBy: null,
      controls: [{ ...controls[0], questions: [] }],
      systems: [{ id: "s1", name: "Payroll", status: "ONBOARDED" }],
    };

    it("starts from the saved values and PATCHes; an unchanged past due date isn't refused", async () => {
      vi.stubGlobal("fetch", mockFetch({ status: 200, body: { internalAudit: { id: "a9" } } }));
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} initial={initial} />);

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
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} initial={initial} />);

      await user.clear(screen.getByLabelText("Due date"));
      await user.type(screen.getByLabelText("Due date"), "2002-02-02");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(screen.getByRole("alert")).toHaveTextContent("The due date can't be in the past");
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("Select Systems by filter (#153)", () => {
    const match = (id: string, name: string, status = "ONBOARDED") => ({
      id,
      name,
      vendor: null,
      status,
      deploymentFacets: ["Cloud SaaS"],
      businessUnits: ["Finance"],
    });

    /** Answers the preview with `matches` and anything else (the save) with 201. */
    function stubFilter(matches: unknown[], previewStatus = 200, previewBody: unknown = { systems: matches }) {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) =>
          Promise.resolve(
            url.startsWith("/api/internal-audits/system-filter")
              ? new Response(JSON.stringify(previewBody), { status: previewStatus })
              : new Response(JSON.stringify({ internalAudit: { id: "a1" } }), { status: 201 }),
          ),
        ),
      );
    }

    it("offers the four criteria from the page's options", () => {
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      expect(screen.getByRole("option", { name: "NIS2 2022" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Cloud SaaS" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Finance" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "In Review" })).toBeInTheDocument();
    });

    it("previews the matches with the count and the ones already picked, and adds only the new ones", async () => {
      stubFilter([match("s1", "Payroll"), match("s2", "Wiki", "DRAFT"), match("s3", "Intranet")]);
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      await user.click(screen.getByLabelText("Payroll Acme")); // picked by hand
      await user.selectOptions(screen.getByLabelText("Deployment Facet"), "Cloud SaaS");
      await user.selectOptions(screen.getByLabelText("Onboarding status"), "Onboarded");
      await user.click(screen.getByRole("button", { name: "Show matching Systems" }));

      expect(await screen.findByRole("status")).toHaveTextContent("3 Systems match; 1 is already picked");
      const [previewUrl] = submitCalls()[0];
      expect(previewUrl).toBe("/api/internal-audits/system-filter?deploymentFacetId=d1&status=ONBOARDED");
      expect(within(screen.getByRole("list", { name: "Matching Systems" })).getByText(/Intranet/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add 2 Systems" }));

      const picked = within(screen.getByRole("list", { name: "Picked: Systems" }));
      expect(picked.getByText("Payroll")).toBeInTheDocument();
      expect(picked.getByText("Wiki")).toBeInTheDocument();
      expect(picked.getByText("Intranet")).toBeInTheDocument(); // not in the page's list: created since
      expect(screen.queryByRole("button", { name: /^Add \d+ Systems?$/ })).not.toBeInTheDocument();

      // Nothing is saved until the form is: then each System once, with the Controls and the rest.
      await user.type(screen.getByLabelText("Title"), "Cloud review");
      await user.type(screen.getByLabelText("Due date"), FUTURE);
      await user.click(screen.getByLabelText("SEC-001 Access control"));
      await user.click(screen.getByRole("button", { name: "Create draft" }));
      await waitFor(() => expect(push).toHaveBeenCalled());
      const [, init] = submitCalls().at(-1)!;
      expect(JSON.parse(init.body as string).systemIds).toEqual(["s1", "s2", "s3"]);
    });

    it("keeps the added Systems removable by hand", async () => {
      stubFilter([match("s2", "Wiki", "DRAFT")]);
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      await user.click(screen.getByRole("button", { name: "Show matching Systems" }));
      expect(await screen.findByRole("status")).toHaveTextContent("1 System matches; 0 are already picked");
      expect(screen.getByText("No criteria are set, so this is every System.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Add 1 System" }));
      await user.click(screen.getByRole("button", { name: "Remove Wiki" }));

      expect(screen.queryByRole("list", { name: "Picked: Systems" })).not.toBeInTheDocument();
    });

    it("says so when nothing matches, and offers nothing to add", async () => {
      stubFilter([]);
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      await user.selectOptions(screen.getByLabelText("Business Unit"), "Finance");
      await user.click(screen.getByRole("button", { name: "Show matching Systems" }));

      expect(await screen.findByRole("status")).toHaveTextContent("0 Systems match; 0 are already picked");
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });

    it("shows the server's refusal and adds nothing", async () => {
      stubFilter([], 403, { error: "Forbidden" });
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      await user.click(screen.getByRole("button", { name: "Show matching Systems" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });

    it("drops the preview when a criterion changes, so what is added is what was shown", async () => {
      stubFilter([match("s2", "Wiki", "DRAFT")]);
      const user = userEvent.setup();
      render(<InternalAuditForm controls={controls} systems={systems} filterOptions={filterOptions} />);

      await user.click(screen.getByRole("button", { name: "Show matching Systems" }));
      await screen.findByRole("status");
      await user.selectOptions(screen.getByLabelText("Framework"), "NIS2 2022");

      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
    });
  });
});
