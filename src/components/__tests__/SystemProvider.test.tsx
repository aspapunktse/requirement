import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlOfferingRow, OfferableControl } from "@/lib/control-offerings";
import type { DependentRow } from "@/lib/provider-dependency-rules";
import { SystemProvider } from "../SystemProvider";

const full: ControlOfferingRow = {
  id: "o1",
  control: { id: "c1", code: "A.5.15", title: "Access control" },
  type: "FULL",
  customerResponsibility: null,
  applies: true,
  providerStatus: "FULFILLED",
};
const shared: ControlOfferingRow = {
  id: "o2",
  control: { id: "c2", code: "A.8.24", title: "Use of cryptography" },
  type: "SHARED",
  customerResponsibility: "The tenant manages its own keys",
  applies: true,
  providerStatus: "IN_PROGRESS",
};
const stale: ControlOfferingRow = {
  id: "o3",
  control: { id: "c3", code: "A.7.8", title: "Equipment siting" },
  type: "FULL",
  customerResponsibility: null,
  applies: false,
  providerStatus: "NOT_STARTED",
};

const offerable: OfferableControl[] = [
  { id: "c4", code: "A.5.16", title: "Identity management" },
  { id: "c5", code: "A.8.5", title: "Secure authentication" },
];

function renderSection(
  props: Partial<{
    canManage: boolean;
    initialIsProvider: boolean;
    initialOfferings: ControlOfferingRow[];
    initialOfferable: OfferableControl[];
    dependents: DependentRow[];
  }> = {},
) {
  return render(
    <SystemProvider
      systemId="s1"
      canManage={false}
      initialIsProvider
      initialOfferings={[full, shared, stale]}
      initialOfferable={offerable}
      {...props}
    />,
  );
}

const itemOf = (code: string) => screen.getByText(code).closest("li") as HTMLElement;

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => respond({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemProvider (#123)", () => {
  describe("what everyone who can see the System reads", () => {
    it("says so, in one line, when the System is not a Provider", () => {
      renderSection({ initialIsProvider: false, initialOfferings: [] });
      expect(screen.getByText("This System is not a Provider.")).toBeInTheDocument();
      expect(screen.queryByText("Control Offerings")).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("lists each Offering with its Control, type, customer responsibility and the Provider's own status", () => {
      renderSection();

      const first = within(itemOf("A.5.15"));
      expect(first.getByText("Access control")).toBeInTheDocument();
      expect(first.getByText("Full")).toBeInTheDocument();
      expect(first.getByText("Fulfilled")).toBeInTheDocument();
      expect(first.queryByText(/Customer responsibility/)).not.toBeInTheDocument();

      const second = within(itemOf("A.8.24"));
      expect(second.getByText("Shared")).toBeInTheDocument();
      expect(second.getByText("The tenant manages its own keys")).toBeInTheDocument();
      expect(second.getByText("In Progress")).toBeInTheDocument();

      expect(within(itemOf("A.7.8")).getByText("Not Started")).toBeInTheDocument();
    });

    it("marks an Offering whose Control no longer applies to the Provider", () => {
      renderSection();
      expect(within(itemOf("A.7.8")).getByText(/no longer applies to this Provider/)).toBeInTheDocument();
      expect(within(itemOf("A.5.15")).queryByText(/no longer applies/)).not.toBeInTheDocument();
    });

    it("says there are none yet for a Provider without Offerings", () => {
      renderSection({ initialOfferings: [] });
      expect(screen.getByText("No Control Offerings yet.")).toBeInTheDocument();
    });

    it("offers no controls to someone who may not manage the Provider", () => {
      renderSection({ canManage: false });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText("Add a Control Offering")).not.toBeInTheDocument();
    });

    it("fetches nothing on mount: the data arrives as props", () => {
      renderSection({ canManage: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("marking and unmarking", () => {
    it("lets the owner mark a System as a Provider", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ isProvider: true }));
      renderSection({ canManage: true, initialIsProvider: false, initialOfferings: [] });

      await user.click(screen.getByRole("button", { name: "Mark as a Provider" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/provider",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isProvider: true }) }),
      );
      expect(await screen.findByText(/This System is a Provider/)).toBeInTheDocument();
      expect(screen.getByText("No Control Offerings yet.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeInTheDocument();
    });

    it("disables 'Stop being a Provider' with an explanation while Offerings exist", () => {
      renderSection({ canManage: true });
      expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeDisabled();
      expect(screen.getByText(/Remove its Control Offerings first/)).toBeInTheDocument();
    });

    it("lets the owner stop being a Provider once there are no Offerings", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ isProvider: false }));
      renderSection({ canManage: true, initialOfferings: [] });

      await user.click(screen.getByRole("button", { name: "Stop being a Provider" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/provider",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isProvider: false }) }),
      );
      expect(await screen.findByText("This System is not a Provider.")).toBeInTheDocument();
    });

    it("shows the server's refusal and keeps the state", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ error: "Remove this Provider's Control Offerings before it stops being a Provider" }, 409));
      renderSection({ canManage: true, initialOfferings: [] });

      await user.click(screen.getByRole("button", { name: "Stop being a Provider" }));

      expect(await screen.findByText(/Remove this Provider's Control Offerings/)).toBeInTheDocument();
      expect(screen.getByText(/This System is a Provider/)).toBeInTheDocument();
    });
  });

  describe("adding an Offering", () => {
    it("lists only the Controls that can still be offered", () => {
      renderSection({ canManage: true });
      const picker = screen.getByLabelText("Control");
      expect(within(picker).getByRole("option", { name: "A.5.16 Identity management" })).toBeInTheDocument();
      expect(within(picker).getByRole("option", { name: "A.8.5 Secure authentication" })).toBeInTheDocument();
      expect(within(picker).queryByRole("option", { name: /A.5.15/ })).not.toBeInTheDocument();
    });

    it("adds a Full Offering, shows it in order and takes the Control out of the picker", async () => {
      const user = userEvent.setup();
      const added: ControlOfferingRow = {
        id: "o4",
        control: { id: "c4", code: "A.5.16", title: "Identity management" },
        type: "FULL",
        customerResponsibility: null,
        applies: true,
        providerStatus: "NOT_STARTED",
      };
      fetchMock.mockImplementation(() => respond({ offering: added }, 201));
      renderSection({ canManage: true });

      await user.selectOptions(screen.getByLabelText("Control"), "c4");
      await user.click(screen.getByRole("button", { name: "Add Offering" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/offerings",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ controlId: "c4", type: "FULL" }) }),
      );
      expect(await screen.findByText("Identity management")).toBeInTheDocument();
      const codes = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
      expect(codes.findIndex((text) => text.includes("A.5.15"))).toBeLessThan(codes.findIndex((text) => text.includes("A.5.16")));
      expect(within(screen.getByLabelText("Control")).queryByRole("option", { name: /A.5.16/ })).not.toBeInTheDocument();
    });

    it("keeps Add off until a Control is chosen, and needs a customer responsibility for Shared", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ offering: { ...shared, id: "o9", control: offerable[0] } }, 201));
      renderSection({ canManage: true });
      const add = screen.getByRole("button", { name: "Add Offering" });
      expect(add).toBeDisabled();

      await user.selectOptions(screen.getByLabelText("Control"), "c4");
      expect(add).toBeEnabled();
      expect(screen.queryByLabelText("Customer responsibility")).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Type"), "SHARED");
      expect(screen.getByText(/needs a customer responsibility text/)).toBeInTheDocument();
      expect(add).toBeDisabled();

      await user.type(screen.getByLabelText("Customer responsibility"), "   ");
      expect(add).toBeDisabled();

      await user.type(screen.getByLabelText("Customer responsibility"), "Keys are the tenant's");
      expect(add).toBeEnabled();
      await user.click(add);

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/offerings",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ controlId: "c4", type: "SHARED", customerResponsibility: "   Keys are the tenant's" }),
        }),
      );
    });

    it("shows the server's refusal and keeps the form", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ error: "A Provider can only offer a Control that applies to it" }, 409));
      renderSection({ canManage: true });

      await user.selectOptions(screen.getByLabelText("Control"), "c4");
      await user.click(screen.getByRole("button", { name: "Add Offering" }));

      expect(await screen.findByText("A Provider can only offer a Control that applies to it")).toBeInTheDocument();
      expect(screen.getByLabelText("Control")).toHaveValue("c4");
    });

    it("says so when every applicable Control is already offered", () => {
      renderSection({ canManage: true, initialOfferable: [] });
      expect(screen.getByText(/Every Control that applies to this Provider is already offered/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add Offering" })).not.toBeInTheDocument();
    });
  });

  describe("editing an Offering", () => {
    it("changes a Shared Offering's text and updates the row from the response", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ offering: { ...shared, customerResponsibility: "Keys and backups" } }));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Edit Offering A.8.24" }));
      const text = screen.getByLabelText("Customer responsibility of A.8.24");
      expect(text).toHaveValue("The tenant manages its own keys");
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing changed yet

      await user.clear(text);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(); // a Shared Offering needs its text
      await user.type(text, "Keys and backups");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/offerings/o2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ type: "SHARED", customerResponsibility: "Keys and backups" }),
        }),
      );
      expect(await screen.findByText("Keys and backups")).toBeInTheDocument();
      expect(screen.queryByLabelText("Customer responsibility of A.8.24")).not.toBeInTheDocument();
    });

    it("turns Shared into Full without sending the text", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ offering: { ...shared, type: "FULL", customerResponsibility: null } }));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Edit Offering A.8.24" }));
      await user.selectOptions(screen.getByLabelText("Type of A.8.24"), "FULL");
      expect(screen.queryByLabelText("Customer responsibility of A.8.24")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/offerings/o2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ type: "FULL" }) }),
      );
      await waitFor(() => expect(within(itemOf("A.8.24")).getByText("Full")).toBeInTheDocument());
      expect(screen.queryByText("The tenant manages its own keys")).not.toBeInTheDocument();
    });

    it("needs a text to turn a Full Offering into Shared", async () => {
      const user = userEvent.setup();
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Edit Offering A.5.15" }));
      await user.selectOptions(screen.getByLabelText("Type of A.5.15"), "SHARED");

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      await user.type(screen.getByLabelText("Customer responsibility of A.5.15"), "Keys");
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("can be cancelled without a request", async () => {
      const user = userEvent.setup();
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Edit Offering A.8.24" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByLabelText("Customer responsibility of A.8.24")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("can edit an Offering whose Control no longer applies", () => {
      renderSection({ canManage: true });
      expect(within(itemOf("A.7.8")).getByRole("button", { name: "Edit Offering A.7.8" })).toBeEnabled();
    });
  });

  describe("removing an Offering", () => {
    it("asks for confirmation, and does nothing if declined", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove Offering A.5.15" }));

      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("A.5.15"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByText("A.5.15")).toBeInTheDocument();
    });

    it("removes the Offering and offers its Control again when it still applies", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ id: "o1" }));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove Offering A.5.15" }));

      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/offerings/o1", expect.objectContaining({ method: "DELETE" }));
      await waitFor(() => expect(screen.queryByText("A.5.15")).not.toBeInTheDocument());
      expect(within(screen.getByLabelText("Control")).getByRole("option", { name: "A.5.15 Access control" })).toBeInTheDocument();
    });

    it("does not offer the Control again when it no longer applies to the Provider", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ id: "o3" }));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove Offering A.7.8" }));

      await waitFor(() => expect(screen.queryByText("A.7.8")).not.toBeInTheDocument());
      expect(within(screen.getByLabelText("Control")).queryByRole("option", { name: /A.7.8/ })).not.toBeInTheDocument();
    });

    it("lets the owner stop being a Provider once the last Offering is removed", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ id: "o1" }));
      renderSection({ canManage: true, initialOfferings: [full] });
      expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "Remove Offering A.5.15" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeEnabled());
    });
  });

  describe("the Systems that depend on this Provider (#124)", () => {
    const dependents: DependentRow[] = [
      { id: "d1", name: "Jira", canSee: true },
      { id: "d2", name: "Secret Project", canSee: false },
    ];

    it("lists them for its owner or an Admin: a name only, linked only when the viewer can see the System", () => {
      renderSection({ canManage: true, dependents });

      expect(screen.getByText("Systems depending on this Provider")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Jira" })).toHaveAttribute("href", "/systems/d1");
      expect(screen.getByText("Secret Project")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Secret Project" })).not.toBeInTheDocument();
    });

    it("says none depend on it yet", () => {
      renderSection({ canManage: true, dependents: [] });
      expect(screen.getByText("No System depends on this Provider yet.")).toBeInTheDocument();
    });

    it("does not list them for anyone who may not manage the Provider", () => {
      renderSection({ canManage: false, dependents });
      expect(screen.queryByText("Systems depending on this Provider")).not.toBeInTheDocument();
      expect(screen.queryByText("Jira")).not.toBeInTheDocument();
    });

    it("disables Stop being a Provider while a System depends on it, with an explanation, even with no Offerings", () => {
      renderSection({ canManage: true, initialOfferings: [], dependents });

      expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeDisabled();
      expect(screen.getByText(/Systems depend on it/)).toBeInTheDocument();
      expect(screen.queryByText(/Remove its Control Offerings first/)).not.toBeInTheDocument();
    });

    it("enables it again when nothing depends on it and there are no Offerings", () => {
      renderSection({ canManage: true, initialOfferings: [], dependents: [] });
      expect(screen.getByRole("button", { name: "Stop being a Provider" })).toBeEnabled();
    });
  });
});
