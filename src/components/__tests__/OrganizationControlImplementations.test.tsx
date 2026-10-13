import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationControlRow } from "@/lib/organization-implementation";
import { OrganizationControlImplementations } from "../OrganizationControlImplementations";

const NOT_STARTED = { status: "NOT_STARTED", description: null, updatedBy: null, updatedAt: null } as const;

const controls: OrganizationControlRow[] = [
  {
    id: "c1",
    code: "A.5.1",
    title: "Policies for information security",
    applicability: "ORGANIZATIONAL",
    owner: { id: "u-owner", name: "Olga Owner" },
    implementation: {
      status: "IN_PROGRESS",
      description: "Policy is being drafted",
      updatedBy: { id: "u-admin", name: "Ada Admin" },
      updatedAt: "2026-09-30T10:15:00.000Z",
    },
  },
  {
    id: "c2",
    code: "A.5.3",
    title: "Segregation of duties",
    applicability: "BOTH",
    owner: null,
    implementation: { ...NOT_STARTED },
  },
  {
    id: "c3",
    code: "A.6.1",
    title: "Screening",
    applicability: "ORGANIZATIONAL",
    owner: { id: "u-other", name: "Otto Other" },
    implementation: {
      status: "FULFILLED",
      description: "Done at hiring",
      updatedBy: null,
      updatedAt: "2026-09-01T08:00:00.000Z",
    },
  },
];

const rowOf = (code: string) => screen.getByText(code).closest("tr") as HTMLElement;

function renderAs(
  user: { id: string; role: "ADMIN" | "COMPLIANCE_MANAGER" | "VIEWER" | "SYSTEM_OWNER" | "INTERNAL_AUDITOR" },
  props: { initialMine?: boolean } = {},
) {
  return render(<OrganizationControlImplementations controls={controls} user={user} {...props} />);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OrganizationControlImplementations (#120)", () => {
  it("lists code, title, applicability, Control Owner, status, description and last update", () => {
    renderAs({ id: "u-viewer", role: "VIEWER" });

    const first = within(rowOf("A.5.1"));
    expect(first.getByText("Policies for information security")).toBeInTheDocument();
    expect(first.getByText("Organizational")).toBeInTheDocument();
    expect(first.getByText("Olga Owner")).toBeInTheDocument();
    expect(first.getByText("In Progress")).toBeInTheDocument();
    expect(first.getByText("Policy is being drafted")).toBeInTheDocument();
    expect(first.getByText(/2026-09-30 by Ada Admin/)).toBeInTheDocument();

    const second = within(rowOf("A.5.3"));
    expect(second.getByText("Both")).toBeInTheDocument();
    expect(second.getByText("No Control Owner")).toBeInTheDocument();
    expect(second.getByText("Not Started")).toBeInTheDocument();
    expect(second.getByText("No description")).toBeInTheDocument();

    expect(within(rowOf("A.6.1")).getByText(/2026-09-01/)).toBeInTheDocument();
  });

  it("is read-only for a user who may not edit any row", () => {
    renderAs({ id: "u-viewer", role: "VIEWER" });
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it("lets a Control Owner edit only their own Controls, whatever their role", () => {
    renderAs({ id: "u-owner", role: "VIEWER" });
    expect(screen.getByRole("button", { name: "Edit A.5.1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit A.5.3" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit A.6.1" })).not.toBeInTheDocument();
  });

  it.each(["COMPLIANCE_MANAGER", "ADMIN"] as const)("lets a %s edit every Control", (role) => {
    renderAs({ id: "u-any", role });
    expect(screen.getAllByRole("button", { name: /^Edit / })).toHaveLength(3);
  });

  it("shows an Internal Auditor every row and no way to edit, also on a Control it is recorded as the owner of (#147)", () => {
    renderAs({ id: "u-owner", role: "INTERNAL_AUDITOR" });
    expect(screen.getByText("A.5.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });

  it("does not let a System Owner who owns no Control edit anything", () => {
    renderAs({ id: "u-sysowner", role: "SYSTEM_OWNER" });
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
  });

  describe("filters", () => {
    it("narrows by status", async () => {
      const user = userEvent.setup();
      renderAs({ id: "u-viewer", role: "VIEWER" });

      await user.selectOptions(screen.getByLabelText("Status filter"), "FULFILLED");
      expect(screen.getByText("A.6.1")).toBeInTheDocument();
      expect(screen.queryByText("A.5.1")).not.toBeInTheDocument();
      expect(screen.queryByText("A.5.3")).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Status filter"), "WAIVED");
      expect(screen.getByText("No Controls match.")).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Status filter"), "ALL");
      expect(screen.getByText("A.5.1")).toBeInTheDocument();
    });

    it("narrows to the Controls the user owns with 'Only Controls I own'", async () => {
      const user = userEvent.setup();
      renderAs({ id: "u-owner", role: "VIEWER" });
      expect(screen.getByText("A.5.3")).toBeInTheDocument();

      await user.click(screen.getByLabelText("Only Controls I own"));
      expect(screen.getByText("A.5.1")).toBeInTheDocument();
      expect(screen.queryByText("A.5.3")).not.toBeInTheDocument();
      expect(screen.queryByText("A.6.1")).not.toBeInTheDocument();
    });

    it("starts narrowed when opened from a Control Owner's task link", () => {
      renderAs({ id: "u-owner", role: "VIEWER" }, { initialMine: true });
      expect(screen.getByLabelText("Only Controls I own")).toBeChecked();
      expect(screen.getByText("A.5.1")).toBeInTheDocument();
      expect(screen.queryByText("A.5.3")).not.toBeInTheDocument();
    });

    it("combines the two filters", async () => {
      const user = userEvent.setup();
      renderAs({ id: "u-owner", role: "VIEWER" }, { initialMine: true });
      await user.selectOptions(screen.getByLabelText("Status filter"), "FULFILLED");
      expect(screen.getByText("No Controls match.")).toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("saves the status and description, then shows the saved row from the response", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              control: {
                ...controls[0],
                implementation: {
                  status: "FULFILLED",
                  description: "Published and approved",
                  updatedBy: { id: "u-owner", name: "Olga Owner" },
                  updatedAt: "2026-10-01T12:00:00.000Z",
                },
              },
            }),
            { status: 200 },
          ),
        ),
      );
      renderAs({ id: "u-owner", role: "VIEWER" });

      await user.click(screen.getByRole("button", { name: "Edit A.5.1" }));
      await user.selectOptions(screen.getByLabelText("Status of A.5.1"), "FULFILLED");
      const description = screen.getByLabelText("Description of A.5.1");
      expect(description).toHaveValue("Policy is being drafted");
      await user.clear(description);
      await user.type(description, "Published and approved");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => expect(within(rowOf("A.5.1")).getByText("Published and approved")).toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledWith("/api/organization/controls/c1", expect.objectContaining({ method: "PATCH" }));
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(JSON.parse(init.body as string)).toEqual({ status: "FULFILLED", description: "Published and approved" });
      expect(within(rowOf("A.5.1")).getByText("Fulfilled")).toBeInTheDocument();
      expect(within(rowOf("A.5.1")).getByText(/2026-10-01 by Olga Owner/)).toBeInTheDocument();
      // The editor closes.
      expect(screen.queryByLabelText("Status of A.5.1")).not.toBeInTheDocument();
    });

    it("does not save from the UI when Waived or Not Applicable has no description, and says why", async () => {
      const user = userEvent.setup();
      renderAs({ id: "u-any", role: "ADMIN" });

      await user.click(screen.getByRole("button", { name: "Edit A.5.3" }));
      await user.selectOptions(screen.getByLabelText("Status of A.5.3"), "WAIVED");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.getByText(/description is required/i)).toBeInTheDocument();

      await user.type(screen.getByLabelText("Description of A.5.3"), "Accepted by the board");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shows the server's refusal and keeps the editor open", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ error: "Only the Control Owner may edit" }), { status: 403 })),
      );
      renderAs({ id: "u-any", role: "COMPLIANCE_MANAGER" });

      await user.click(screen.getByRole("button", { name: "Edit A.5.3" }));
      await user.selectOptions(screen.getByLabelText("Status of A.5.3"), "IN_PROGRESS");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Only the Control Owner may edit")).toBeInTheDocument();
      expect(screen.getByLabelText("Status of A.5.3")).toHaveValue("IN_PROGRESS");
    });

    it("cancels without calling the API", async () => {
      const user = userEvent.setup();
      renderAs({ id: "u-any", role: "ADMIN" });

      await user.click(screen.getByRole("button", { name: "Edit A.5.1" }));
      await user.selectOptions(screen.getByLabelText("Status of A.5.1"), "FULFILLED");
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText("Status of A.5.1")).not.toBeInTheDocument();
      expect(within(rowOf("A.5.1")).getByText("In Progress")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
