import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderChoice, ProviderDependencyRow } from "@/lib/provider-dependency-rules";
import { SystemProviders } from "../SystemProviders";

const refresh = vi.fn();
const writeHash = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("../system-hash", () => ({ writeHash: (hash: string) => writeHash(hash) }));

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

function renderSection(props: Partial<React.ComponentProps<typeof SystemProviders>> = {}) {
  return render(
    <SystemProviders
      systemId="s1"
      systemName="This System"
      canManageDependencies={false}
      canManageProvider={false}
      initialDependencies={[landingZone, pendingHidden]}
      choices={choices}
      isProvider={false}
      offerings={[]}
      offerable={[]}
      dependents={[]}
      controlTotals={{ total: 40, organization: 20, system: 15 }}
      {...props}
    />,
  );
}

const cardOf = (name: string) => within(screen.getByRole("article", { name: `Provider ${name}` }));
/** "+ Depend on a Provider" reveals the picker. */
const openPicker = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "+ Depend on a Provider" }));

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refresh.mockClear();
  writeHash.mockClear();
  fetchMock = vi.fn(() => respond({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SystemProviders (#124, #245)", () => {
  describe("what everyone who can see the System reads", () => {
    it("shows each Provider as a card with its Full and Shared Offering counts and the Control codes it covers", () => {
      renderSection();

      // Landing Zone: A.5.15 Full, A.8.24 Shared, A.7.8 Full (no longer applies to the Provider, but still an Offering on this System).
      const card = cardOf("Landing Zone");
      expect(card.getByText("Onboarded")).toBeInTheDocument();
      expect(card.getByLabelText("Offerings of Landing Zone")).toHaveTextContent("Full Offerings 2");
      expect(card.getByLabelText("Offerings of Landing Zone")).toHaveTextContent("Shared 1");
      expect(card.getAllByRole("button", { name: /^A\./ }).map((button) => button.textContent)).toEqual(["A.5.15", "A.7.8", "A.8.24"]);

      const hidden = cardOf("Hidden Cloud");
      expect(hidden.getByLabelText("Offerings of Hidden Cloud")).toHaveTextContent("Full Offerings 1");
      expect(hidden.getByLabelText("Offerings of Hidden Cloud")).toHaveTextContent("Shared 0");
    });

    it("opens the Control drawer of a code on the Controls tab", async () => {
      const user = userEvent.setup();
      renderSection();
      await user.click(cardOf("Landing Zone").getByRole("button", { name: "A.8.24" }));
      expect(writeHash).toHaveBeenCalledWith("#controls/A.8.24");
    });

    it("links a Provider's name only when the viewer can see it as a System", () => {
      renderSection();

      expect(screen.getByRole("link", { name: "Landing Zone" })).toHaveAttribute("href", "/systems/p1");
      expect(screen.getByRole("heading", { name: "Hidden Cloud" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Hidden Cloud" })).not.toBeInTheDocument();
    });

    it("shows a Provider that is not Onboarded as pending, saying its Offerings give no credit yet", () => {
      renderSection();

      const card = cardOf("Hidden Cloud");
      expect(card.getByText("pending: Provider not Onboarded")).toBeInTheDocument();
      expect(card.getByText(/give this System no credit until the Provider is Onboarded/)).toBeInTheDocument();
      expect(cardOf("Landing Zone").queryByText(/pending/)).not.toBeInTheDocument();
    });

    it("marks, in a code's tooltip, an Offering whose Control no longer applies to the Provider", () => {
      renderSection();
      expect(cardOf("Landing Zone").getByRole("button", { name: "A.7.8" })).toHaveAttribute("title", expect.stringMatching(/no longer applies to the Provider, so it gives no credit/));
      expect(cardOf("Landing Zone").getByRole("button", { name: "A.5.15" })).not.toHaveAttribute("title", expect.stringMatching(/no longer applies/));
    });

    it("says so when the System depends on no Provider, or the Provider offers nothing that applies", () => {
      renderSection({ initialDependencies: [] });
      expect(screen.getByText("This System doesn't depend on any Provider.")).toBeInTheDocument();
      cleanup();

      renderSection({ initialDependencies: [{ ...landingZone, offerings: [] }] });
      expect(screen.getByText("It offers none of the Controls that apply to this System.")).toBeInTheDocument();
    });

    it("offers no way to change the dependencies to someone who may not manage them, and fetches nothing on mount", () => {
      renderSection({ canManageDependencies: false });
      expect(screen.queryByRole("button", { name: /Remove dependency/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ Depend on a Provider" })).not.toBeInTheDocument();
      expect(screen.getByText(/Only the System's owner or an Admin can declare a Provider dependency/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("where the Controls come from", () => {
    it("sizes the flow by count: the Organization, each Provider (its Full plus Shared Offerings) and This System", () => {
      renderSection();
      const flow = screen.getByRole("img", { name: /Where this System's Controls come from/ });
      expect(flow).toHaveAccessibleName("Where this System's Controls come from: Organization 20, Hidden Cloud 1, Landing Zone 3, This System 15; 40 applicable Controls");
      const inside = within(flow as unknown as HTMLElement);
      expect(inside.getByText("20 Controls")).toBeInTheDocument();
      expect(inside.getByText("3 Controls")).toBeInTheDocument();
      expect(inside.getByText("1 Control, pending")).toBeInTheDocument();
      expect(inside.getByText("40 applicable Controls")).toBeInTheDocument();
    });

    it("leaves the Organization and This System out when they supply nothing, and says so when nothing applies", () => {
      renderSection({ initialDependencies: [], controlTotals: { total: 0, organization: 0, system: 0 } });
      expect(screen.queryByRole("img", { name: /Where this System's Controls come from/ })).not.toBeInTheDocument();
      expect(screen.getByText(/No Control applies to this System yet/)).toBeInTheDocument();
    });
  });

  describe("the System as a Provider", () => {
    it("shows the System's side below the cards, for a System that is not a Provider", () => {
      renderSection();
      expect(screen.getByRole("heading", { name: "This System as a Provider" })).toBeInTheDocument();
      expect(screen.getByText("This System is not a Provider.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Mark as a Provider" })).not.toBeInTheDocument();
    });

    it("lets the owner or an Admin mark it as a Provider", () => {
      renderSection({ canManageProvider: true });
      expect(screen.getByRole("button", { name: "Mark as a Provider" })).toBeInTheDocument();
    });

    it("lists the Control Offerings and the Systems that depend on it, as before", () => {
      renderSection({
        isProvider: true,
        canManageProvider: true,
        offerings: [{ id: "o1", control: { id: "c1", code: "A.5.15", title: "Access control" }, type: "FULL", customerResponsibility: null, providerStatus: "FULFILLED", applies: true }],
        dependents: [{ id: "d1", name: "Payroll", canSee: true }],
      });
      expect(screen.getByRole("heading", { name: "Control Offerings" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Payroll" })).toHaveAttribute("href", "/systems/d1");
    });
  });

  describe("declaring a dependency", () => {
    it("offers every Provider that is not this System and not already declared, pending ones marked", async () => {
      const user = userEvent.setup();
      renderSection({ canManageDependencies: true });
      await openPicker(user);

      const options = within(screen.getByLabelText("Provider")).getAllByRole("option").map((option) => option.textContent);
      expect(options).toEqual(["Select a Provider", "Shared Storage", "Waiting Room (pending: Provider not Onboarded)"]);
    });

    it("keeps Add off until a Provider is chosen, then posts it, shows its card and takes it out of the picker", async () => {
      const user = userEvent.setup();
      const added: ProviderDependencyRow = { ...landingZone, providerId: "p3", name: "Shared Storage", offerings: [] };
      fetchMock.mockImplementation(() => respond({ dependency: added }, 201));
      renderSection({ canManageDependencies: true });
      await openPicker(user);
      expect(screen.getByRole("button", { name: "Add dependency" })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText("Provider"), "p3");
      await user.click(screen.getByRole("button", { name: "Add dependency" }));

      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/dependencies", expect.objectContaining({ method: "POST", body: JSON.stringify({ providerId: "p3" }) }));
      expect(await screen.findByRole("article", { name: "Provider Shared Storage" })).toBeInTheDocument();
      await openPicker(user);
      expect(within(screen.getByLabelText("Provider")).queryByRole("option", { name: "Shared Storage" })).not.toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
    });

    it("shows the server's refusal and keeps the picker", async () => {
      const user = userEvent.setup();
      fetchMock.mockImplementation(() => respond({ error: "A System can only depend on a System that is marked as a Provider" }, 409));
      renderSection({ canManageDependencies: true });
      await openPicker(user);

      await user.selectOptions(screen.getByLabelText("Provider"), "p3");
      await user.click(screen.getByRole("button", { name: "Add dependency" }));

      expect(await screen.findByText(/can only depend on a System that is marked as a Provider/)).toBeInTheDocument();
      expect(screen.queryByRole("article", { name: "Provider Shared Storage" })).not.toBeInTheDocument();
      expect(screen.getByLabelText("Provider")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("says so when there is nothing left to pick", () => {
      renderSection({ canManageDependencies: true, choices: [{ id: "s1", name: "This System", onboarded: true }, ...choices.slice(0, 2)] });
      expect(screen.getByText(/Every Provider is already declared/)).toBeInTheDocument();
      cleanup();
      renderSection({ canManageDependencies: true, choices: [] });
      expect(screen.getByText("No System is marked as a Provider yet.")).toBeInTheDocument();
    });
  });

  describe("removing a dependency", () => {
    it("asks first, naming the Controls that stop being inherited, and sends nothing when declined", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderSection({ canManageDependencies: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(confirm).toHaveBeenCalledTimes(1);
      const message = confirm.mock.calls[0][0] as string;
      expect(message).toContain('Provider "Landing Zone"');
      // Only the Fulfilled Full Offering that applies stops being inherited; the Shared one is named as no longer counting (#125).
      expect(message).toContain("These Controls stop being inherited from it: A.5.15 (");
      expect(message).toContain("Its Shared Offerings (A.8.24) stop counting");
      expect(message).not.toContain("A.7.8");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole("article", { name: "Provider Landing Zone" })).toBeInTheDocument();
    });

    it("says no status changes when the Provider gives no credit right now", async () => {
      const user = userEvent.setup();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderSection({ canManageDependencies: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Hidden Cloud" }));

      expect(confirm.mock.calls[0][0]).toMatch(/gives this System no credit right now, so no Control's status changes/);
    });

    it("deletes it, drops the card, offers the Provider in the picker again and refreshes the page", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ id: "p1" }));
      renderSection({ canManageDependencies: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(fetchMock).toHaveBeenCalledWith("/api/systems/s1/dependencies/p1", expect.objectContaining({ method: "DELETE" }));
      await waitFor(() => expect(screen.queryByRole("article", { name: "Provider Landing Zone" })).not.toBeInTheDocument());
      await openPicker(user);
      expect(within(screen.getByLabelText("Provider")).getByRole("option", { name: "Landing Zone" })).toBeInTheDocument();
      expect(refresh).toHaveBeenCalled();
    });

    it("keeps the card and shows the server's message when removal is refused", async () => {
      const user = userEvent.setup();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      fetchMock.mockImplementation(() => respond({ error: "This System doesn't depend on that Provider" }, 404));
      renderSection({ canManageDependencies: true });

      await user.click(screen.getByRole("button", { name: "Remove dependency on Landing Zone" }));

      expect(await screen.findByText("This System doesn't depend on that Provider")).toBeInTheDocument();
      expect(screen.getByRole("article", { name: "Provider Landing Zone" })).toBeInTheDocument();
    });
  });
});
