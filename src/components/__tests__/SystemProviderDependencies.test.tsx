import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderChoice, ProviderDependencyRow } from "@/lib/provider-dependency-rules";
import { SystemProviderDependencies } from "../SystemProviderDependencies";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const landingZone: ProviderDependencyRow = {
  providerId: "p1",
  name: "Landing Zone",
  onboarded: true,
  canSee: true,
  offerings: [
    {
      control: { id: "c1", code: "A.5.15", title: "Access control" },
      type: "FULL",
      customerResponsibility: null,
      providerStatus: "FULFILLED",
      appliesToProvider: true,
    },
    {
      control: { id: "c2", code: "A.8.24", title: "Use of cryptography" },
      type: "SHARED",
      customerResponsibility: "The tenant manages its own keys",
      providerStatus: "IN_PROGRESS",
      appliesToProvider: true,
    },
    {
      control: { id: "c3", code: "A.7.8", title: "Equipment siting" },
      type: "FULL",
      customerResponsibility: null,
      providerStatus: "FULFILLED",
      appliesToProvider: false,
    },
  ],
};
const pendingHidden: ProviderDependencyRow = {
  providerId: "p2",
  name: "Hidden Cloud",
  onboarded: false,
  canSee: false,
  offerings: [
    {
      control: { id: "c1", code: "A.5.15", title: "Access control" },
      type: "FULL",
      customerResponsibility: null,
      providerStatus: "FULFILLED",
      appliesToProvider: true,
    },
  ],
};
const choices: ProviderChoice[] = [
  { id: "p1", name: "Landing Zone", onboarded: true },
  { id: "p2", name: "Hidden Cloud", onboarded: false },
  { id: "p3", name: "Shared Storage", onboarded: true },
  { id: "p4", name: "Waiting Room", onboarded: false },
  { id: "s1", name: "This System", onboarded: true },
];

function renderSection(props: Partial<React.ComponentProps<typeof SystemProviderDependencies>> = {}) {
  return render(
    <SystemProviderDependencies
      systemId="s1"
      canManage={false}
      initialDependencies={[landingZone, pendingHidden]}
      choices={choices}
      {...props}
    />,
  );
}

const itemOf = (name: string) => within(screen.getByRole("listitem", { name: `Provider ${name}` }));

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  fetchMock = vi.fn(() => respond({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemProviderDependencies (#124)", () => {
  describe("what everyone who can see the System reads", () => {
    it("lists each declared Provider with its Offerings, their type and the Provider's own status", () => {
      renderSection();

      const item = itemOf("Landing Zone");
      expect(item.getByText("Onboarded")).toBeInTheDocument();
      expect(item.getByText("A.5.15")).toBeInTheDocument();
      expect(item.getAllByText("Full", { selector: "span" })).toHaveLength(2); // A.5.15 and A.7.8
      expect(item.getAllByText("Fulfilled")).toHaveLength(2);
      expect(item.getByText("Shared")).toBeInTheDocument();
      expect(item.getByText("In Progress")).toBeInTheDocument();
    });

    it("links a Provider's name only when the viewer can see it as a System", () => {
      renderSection();

      expect(screen.getByRole("link", { name: "Landing Zone" })).toHaveAttribute("href", "/systems/p1");
      expect(screen.getByText("Hidden Cloud")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Hidden Cloud" })).not.toBeInTheDocument();
    });

    it("shows a Provider that is not Onboarded as pending, saying its Offerings give no credit yet", () => {
      renderSection();

      const item = itemOf("Hidden Cloud");
      expect(item.getByText("pending: Provider not Onboarded")).toBeInTheDocument();
      expect(item.getByText(/give this System no credit until the Provider is Onboarded/)).toBeInTheDocument();
      expect(itemOf("Landing Zone").queryByText(/pending/)).not.toBeInTheDocument();
    });

    it("shows a Shared Offering's customer responsibility with a note that it gives no credit yet", () => {
      renderSection();
      expect(screen.getByText(/Customer responsibility: The tenant manages its own keys\. A Shared Offering gives no credit yet\./)).toBeInTheDocument();
    });

    it("marks an Offering whose Control no longer applies to the Provider", () => {
      renderSection();
      expect(screen.getByText(/This Control no longer applies to the Provider, so the Offering gives no credit/)).toBeInTheDocument();
    });

    it("says so when the System depends on no Provider, or the Provider offers nothing that applies", () => {
      renderSection({ initialDependencies: [] });
      expect(screen.getByText("This System doesn't depend on any Provider.")).toBeInTheDocument();

      renderSection({ initialDependencies: [{ ...landingZone, offerings: [] }] });
      expect(screen.getByText("It offers none of the Controls that apply to this System.")).toBeInTheDocument();
    });

    it("offers no controls to someone who may not manage the dependencies, and fetches nothing on mount", () => {
      renderSection({ canManage: false });
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByText("Depend on a Provider")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("declaring a dependency", () => {
    it("offers every Provider that is not this System and not already declared, pending ones marked", () => {
      renderSection({ canManage: true });

      const options = within(screen.getByLabelText("Provider")).getAllByRole("option").map((option) => option.textContent);
      expect(options).toEqual(["Select a Provider", "Shared Storage", "Waiting Room (pending: Provider not Onboarded)"]);
    });

    it("keeps Add off until a Provider is chosen, then posts it, lists it and takes it out of the picker", async () => {
      const user = userEvent.setup();
      const added: ProviderDependencyRow = { ...landingZone, providerId: "p3", name: "Shared Storage", offerings: [] };
      fetchMock.mockImplementation(() => respond({ dependency: added }, 201));
      renderSection({ canManage: true });
      expect(screen.getByRole("button", { name: "Add dependency" })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText("Provider"), "p3");
      await user.click(screen.getByRole("button", { name: "Add dependency" }));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/systems/s1/dependencies",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ providerId: "p3" }) }),
      );
      expect(await screen.findByRole("listitem", { name: "Provider Shared Storage" })).toBeInTheDocument();
      expect(within(screen.getByLabelText("Provider")).queryByRole("option", { name: "Shared Storage" })).not.toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
    });

    it("shows the server's refusal and keeps the picker", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ error: "A System can only depend on a System that is marked as a Provider" }, 409));
      renderSection({ canManage: true });

      await user.selectOptions(screen.getByLabelText("Provider"), "p3");
      await user.click(screen.getByRole("button", { name: "Add dependency" }));

      expect(await screen.findByText(/can only depend on a System that is marked as a Provider/)).toBeInTheDocument();
      expect(screen.queryByRole("listitem", { name: "Provider Shared Storage" })).not.toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("says so when there is nothing left to pick", () => {
      renderSection({ canManage: true, choices: [{ id: "s1", name: "This System", onboarded: true }, ...choices.slice(0, 2)] });
      expect(screen.getByText(/Every Provider is already declared/)).toBeInTheDocument();
      renderSection({ canManage: true, choices: [] });
      expect(screen.getByText("No System is marked as a Provider yet.")).toBeInTheDocument();
    });
  });

  describe("removing a dependency", () => {
    it("asks first, naming the Controls that stop being inherited, and sends nothing when declined", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(confirm).toHaveBeenCalledTimes(1);
      const message = confirm.mock.calls[0][0] as string;
      expect(message).toContain('Provider "Landing Zone"');
      // Only the Fulfilled Full Offering that applies gives credit: not the Shared one, nor the one that no longer applies.
      expect(message).toContain("A.5.15");
      expect(message).not.toContain("A.8.24");
      expect(message).not.toContain("A.7.8");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("listitem", { name: "Provider Landing Zone" })).toBeInTheDocument();
    });

    it("says no status changes when the Provider gives no credit right now", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Hidden Cloud" }));

      expect(confirm.mock.calls[0][0]).toMatch(/gives this System no credit right now, so no Control's status changes/);
    });

    it("deletes it, drops the row, offers the Provider in the picker again and refreshes the page", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ id: "p1" }));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/dependencies/p1", expect.objectContaining({ method: "DELETE" }));
      await waitFor(() => expect(screen.queryByRole("listitem", { name: "Provider Landing Zone" })).not.toBeInTheDocument());
      expect(within(screen.getByLabelText("Provider")).getByRole("option", { name: "Landing Zone" })).toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
    });

    it("keeps the row and shows the server's message when removal is refused", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ error: "This System doesn't depend on that Provider" }, 404));
      renderSection({ canManage: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(await screen.findByText("This System doesn't depend on that Provider")).toBeInTheDocument();
      expect(screen.getByRole("listitem", { name: "Provider Landing Zone" })).toBeInTheDocument();
    });
  });
});
