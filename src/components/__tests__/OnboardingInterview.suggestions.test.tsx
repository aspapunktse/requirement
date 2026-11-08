import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingInterview } from "../OnboardingInterview";
import type { OnboardingCatalog } from "@/lib/onboarding-interview";

/** Information Types suggest Frameworks in the interview (#300, ADR 0013): the suggestion replaces the Framework's own question. */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const catalog: OnboardingCatalog = {
  sensitivityLevels: [
    { level: 1, label: "Public", description: "Anyone may see it." },
    { level: 3, label: "Sensitive", description: "Would cause harm if it leaked." },
  ],
  informationTypes: [
    { id: "it-cust", name: "Customer personal data", description: null, sensitivityLevel: 3, suggestedFrameworkIds: ["gdpr"] },
    { id: "it-code", name: "Source code", description: null, sensitivityLevel: 3, suggestedFrameworkIds: [] },
  ],
  deploymentFacets: [{ id: "f-saas", name: "Software as a service", description: null }],
  frameworks: [
    { id: "base", name: "ISO/IEC 27001", version: "2022", description: null, isBase: true, onboardingQuestion: null, onboardingHint: null },
    { id: "gdpr", name: "GDPR", version: "1", description: null, isBase: false, onboardingQuestion: "Does it hold personal data about people?", onboardingHint: null },
    { id: "nis", name: "NIS2", version: "1", description: null, isBase: false, onboardingQuestion: "Is it essential to a service?", onboardingHint: null },
  ],
  providers: [],
  controls: [],
};

const posted = () => {
  const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "POST");
  return call ? JSON.parse(call[1].body) : null;
};

async function toLaws(declareType: boolean) {
  const user = userEvent.setup();
  render(<OnboardingInterview />);
  await screen.findByRole("heading", { name: "How do you get the system?" });
  await user.click(screen.getByRole("checkbox", { name: "Software as a service" }));
  await user.click(screen.getByRole("button", { name: "Sensitivity" }));
  if (declareType) await user.click(screen.getByRole("checkbox", { name: "Customer personal data" }));
  await user.click(screen.getByRole("radio", { name: "Sensitivity Level: Sensitive" }));
  await user.click(screen.getByRole("button", { name: "Laws and standards" }));
  return user;
}

const suggestionRadios = () => screen.getByText(/usually falls under GDPR/).closest("fieldset")!.querySelectorAll<HTMLInputElement>('input[type="radio"]');

async function create(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Review" }));
  await user.click(screen.getByLabelText("System name"));
  await user.paste("Test System");
  await user.click(screen.getByRole("button", { name: "Create System" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/systems/sys1"));
}

describe("OnboardingInterview: suggested Frameworks (#300)", () => {
  beforeEach(() => {
    push.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/system-onboarding")) return Promise.resolve(new Response(JSON.stringify(catalog), { status: 200 }));
        if (url.endsWith("/api/systems") && init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ system: { id: "sys1" } }), { status: 201 }));
        if (url.endsWith("/api/systems/bso-candidates")) return Promise.resolve(new Response(JSON.stringify({ users: [] }), { status: 200 }));
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks the Framework's own question when no declared type suggests it", async () => {
    await toLaws(false);
    expect(screen.getByText("Does it hold personal data about people?")).toBeInTheDocument();
    expect(screen.queryByText(/usually falls under GDPR/)).toBeNull();
  }, 15000);

  it("skips the question a declared type covers and asks the suggestion instead, naming the type", async () => {
    await toLaws(true);
    expect(screen.queryByText("Does it hold personal data about people?")).toBeNull();
    expect(screen.getByText(/Customer personal data usually falls under GDPR\. Put GDPR in scope\?/)).toBeInTheDocument();
    // A Framework no type suggests keeps its own question.
    expect(screen.getByText("Is it essential to a service?")).toBeInTheDocument();
  }, 15000);

  it("Yes puts the Framework in the scope and sends no decline", async () => {
    const user = await toLaws(true);
    await user.click(suggestionRadios()[0]);
    await create(user);
    expect(posted()).toMatchObject({ frameworkScopeIds: ["gdpr"], informationTypeIds: ["it-cust"] });
    expect(posted()).not.toHaveProperty("declinedFrameworkIds");
  }, 20000);

  it("No sends the Framework as declined and leaves it out of the scope", async () => {
    const user = await toLaws(true);
    await user.click(suggestionRadios()[1]);
    await create(user);
    expect(posted()).toMatchObject({ frameworkScopeIds: [], declinedFrameworkIds: ["gdpr"] });
  }, 20000);

  it("unanswered sends neither, so the System is created flagged", async () => {
    const user = await toLaws(true);
    await create(user);
    expect(posted()).toMatchObject({ frameworkScopeIds: [] });
    expect(posted()).not.toHaveProperty("declinedFrameworkIds");
  }, 20000);

  it("drops a No when the type is un-ticked, so the server is never sent a decline nothing suggests", async () => {
    const user = await toLaws(true);
    await user.click(suggestionRadios()[1]);
    await user.click(screen.getByRole("button", { name: "Sensitivity" }));
    await user.click(screen.getByRole("checkbox", { name: "Customer personal data" }));
    await user.click(screen.getByRole("button", { name: "Laws and standards" }));
    expect(screen.getByText("Does it hold personal data about people?")).toBeInTheDocument();
    await create(user);
    expect(posted()).not.toHaveProperty("declinedFrameworkIds");
  }, 25000);
});
