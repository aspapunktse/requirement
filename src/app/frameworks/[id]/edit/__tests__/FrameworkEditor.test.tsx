import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogRow } from "../../../frameworks-types";
import { FrameworkEditor, type FrameworkDraft } from "../FrameworkEditor";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// A plain anchor: the real Link prefetches and updates state outside act().
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ROW: CatalogRow = {
  id: "f-nis2",
  name: "NIS2",
  version: "1",
  description: "EU directive",
  isBase: false,
  strict: false,
  status: "DRAFT",
  group: "Other Frameworks",
  family: null,
  level: null,
  requirements: 2,
  covered: 1,
  accepted: 0,
  gaps: 1,
  partialOnly: 0,
  systems: null,
  reviewGroup: "Network Review",
  ownerName: "Olive",
  canCurate: true,
  supplementary: 1,
  updatedAt: "2026-10-20T09:00:00.000Z",
  lineage: [],
};
const INITIAL: FrameworkDraft = {
  name: "NIS2",
  version: "1",
  description: "EU directive",
  strictComplianceRequired: false,
  licensing: "PARAPHRASE_ONLY",
  supersedesId: "",
  onboardingQuestion: "Do you operate essential services?",
  onboardingHint: "Energy, transport, health.",
};
const OTHERS = [{ id: "f-old", name: "NIS", version: "0" }];

function renderEditor(props: { row?: Partial<CatalogRow>; initial?: Partial<FrameworkDraft>; catalogManager?: boolean } = {}) {
  return render(
    <FrameworkEditor row={{ ...ROW, ...props.row }} catalogManager={props.catalogManager ?? true} initial={{ ...INITIAL, ...props.initial }} supersedesOptions={OTHERS} requirementCount={2}>
      <p>children go here</p>
    </FrameworkEditor>,
  );
}

const reply = (status: number, body: unknown) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status }));
function calls(method: string) {
  return vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === method);
}

beforeEach(() => {
  router.push.mockClear();
  router.refresh.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => reply(200, { framework: {} })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FrameworkEditor: header", () => {
  it("shows the status, licensing and Requirement count, the Draft notice, and renders its children", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: "Edit NIS2:1" })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Paraphrase only")).toBeInTheDocument();
    expect(screen.getByText("· 2 Requirements")).toBeInTheDocument();
    expect(screen.getByText(/This Framework is a Draft/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Coverage of NIS2:1" })).toHaveAttribute("href", "/frameworks/f-nis2/coverage");
    expect(screen.getByText("children go here")).toBeInTheDocument();
  });

  it("has no Draft notice and no Publish or Delete for a Published Framework", () => {
    renderEditor({ row: { status: "PUBLISHED" } });
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.queryByText(/This Framework is a Draft/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("FrameworkEditor: save", () => {
  it("sends every field for a Compliance Manager, only when something changed", async () => {
    renderEditor();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Version"));
    await userEvent.type(screen.getByLabelText("Version"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Licensing"), "QUOTABLE");
    await userEvent.selectOptions(screen.getByLabelText("Supersedes"), "f-old");
    await userEvent.click(screen.getByRole("checkbox", { name: /Requires 100% Fulfilled/ }));
    await userEvent.click(save);

    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0][0]).toBe("/api/frameworks/f-nis2");
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toEqual({
      name: "NIS2",
      version: "2",
      description: "EU directive",
      strictComplianceRequired: true,
      licensing: "QUOTABLE",
      supersedesId: "f-old",
      onboardingQuestion: "Do you operate essential services?",
      onboardingHint: "Energy, transport, health.",
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("clears the hint with a blank onboarding question", async () => {
    renderEditor();
    await userEvent.clear(screen.getByLabelText(/Onboarding question/));
    expect(screen.queryByLabelText("Onboarding hint")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toMatchObject({ onboardingQuestion: null, onboardingHint: null });
  });

  it("shows a refusal in place and keeps what was typed", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(409, { error: "A Framework with that name and version already exists" }));
    renderEditor();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "ISO/IEC 27001");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A Framework with that name and version already exists");
    expect(screen.getByLabelText("Name")).toHaveValue("ISO/IEC 27001");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows a network failure in place and keeps what was typed", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    renderEditor();
    await userEvent.type(screen.getByLabelText("Description"), " more");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not reach the server/);
    expect(screen.getByLabelText("Description")).toHaveValue("EU directive more");
  });

  it("won't save a blank name or version", async () => {
    renderEditor();
    await userEvent.clear(screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("FrameworkEditor: a Framework Owner", () => {
  it("edits only the description and the onboarding question and hint, the rest is read-only", async () => {
    renderEditor({ catalogManager: false });
    for (const label of ["Name", "Version", "Licensing", "Supersedes"]) expect(screen.getByLabelText(label)).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Requires 100% Fulfilled/ })).toBeDisabled();
    expect(screen.getByLabelText("Description")).toBeEnabled();
    expect(screen.getByLabelText(/Onboarding question/)).toBeEnabled();

    await userEvent.type(screen.getByLabelText("Description"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1]!.body as string)).toEqual({
      description: "EU directive!",
      onboardingQuestion: "Do you operate essential services?",
      onboardingHint: "Energy, transport, health.",
    });
  });

  it("gets Publish on a Draft but never Delete", () => {
    renderEditor({ catalogManager: false });
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("FrameworkEditor: base Framework", () => {
  const base = { row: { isBase: true, status: "PUBLISHED" as const, name: "ISO/IEC 27001", version: "2022" }, initial: { onboardingQuestion: "", onboardingHint: "" } };

  it("has no onboarding question and no Delete, and sends none", async () => {
    renderEditor(base);
    expect(screen.getByText("Base Framework")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Onboarding question/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Description"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    const body = JSON.parse(calls("PATCH")[0][1]!.body as string);
    expect(body).not.toHaveProperty("onboardingQuestion");
    expect(body).not.toHaveProperty("onboardingHint");
  });

  it("disables Delete if it were ever offered for a base Draft", () => {
    renderEditor({ ...base, row: { ...base.row, status: "DRAFT" } });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});

describe("FrameworkEditor: delete", () => {
  it("asks first, and does nothing when declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("NIS2:1"));
    expect(calls("DELETE")).toHaveLength(0);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("deletes a Draft once confirmed and goes to /frameworks", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(fetch).mockImplementation(() => reply(204, null));
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/frameworks"));
    expect(calls("DELETE")).toHaveLength(1);
    expect(calls("DELETE")[0][0]).toBe("/api/frameworks/f-nis2");
  });

  it("shows the API's refusal in place and stays", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(fetch).mockImplementation(() => reply(409, { error: "This Framework is in use by Systems, or has Requirements or Supplementary Controls, and can't be retired" }));
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("in use by Systems, or has Requirements");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });
});

describe("FrameworkEditor: publish", () => {
  it("opens the Publish dialog for a Draft, publishes, and refreshes", async () => {
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog", { name: "Publish NIS2:1?" });
    expect(dialog).toHaveTextContent("1 Coverage Gap is still open.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(calls("POST")[0][0]).toBe("/api/frameworks/f-nis2/publish");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("NIS2:1 published");
  });

  it("shows the refusal inside the dialog and Cancel sends nothing", async () => {
    vi.mocked(fetch).mockImplementation(() => reply(409, { error: "Already published" }));
    renderEditor();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Already published");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
