import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameworkCoverageView, type CoverageRequirement } from "../FrameworkCoverageView";

const framework = { id: "f1", name: "NIS2", version: "2022" };
const control = (code: string, originFramework: CoverageRequirement["mappings"][number]["control"]["originFramework"] = null) => ({
  id: `c-${code}`,
  code,
  title: `Control ${code}`,
  originFramework,
});
const requirement = (over: Partial<CoverageRequirement>): CoverageRequirement => ({
  id: "q",
  code: "1",
  section: "Article 21",
  title: "Title",
  state: "GAP",
  gapAcceptedAt: null,
  gapAcceptedBy: null,
  gapJustification: null,
  mappings: [],
  ...over,
});

let data: { summary: { total: number; covered: number; gaps: number; accepted: number }; requirements: CoverageRequirement[] };

function initialData() {
  return {
    summary: { total: 4, covered: 1, gaps: 2, accepted: 1 },
    requirements: [
      requirement({
        id: "q1",
        code: "Art. 1",
        state: "COVERED",
        mappings: [
          { id: "m1", coverage: "FULL", rationale: null, control: control("SUP-001", { id: "f1", name: "NIS2", version: "2022" }) },
          { id: "m2", coverage: "PARTIAL", rationale: null, control: control("A.5.1") },
        ],
      }),
      requirement({
        id: "q2",
        code: "Art. 2",
        state: "GAP",
        mappings: [{ id: "m3", coverage: "PARTIAL", rationale: null, control: control("A.5.2") }],
      }),
      requirement({ id: "q3", code: "Art. 3", state: "GAP" }),
      requirement({
        id: "q4",
        code: "Art. 4",
        section: "Article 22",
        state: "ACCEPTED_GAP",
        gapAcceptedAt: "2026-09-29T10:00:00.000Z",
        gapAcceptedBy: { id: "u1", name: "Carla Manager" },
        gapJustification: "Handled by contract",
      }),
    ],
  };
}

function calls(method: string) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === method);
}

function renderView(canCurate: boolean) {
  const initial = initialData();
  data = structuredClone(initial);
  return render(
    <FrameworkCoverageView
      framework={framework}
      initialSummary={initial.summary}
      initialRequirements={initial.requirements}
      canCurate={canCurate}
    />,
  );
}

const stat = (label: string) => within(screen.getByLabelText("Coverage of NIS2:2022")).getByText(label).nextElementSibling;
const row = (code: string) => within(screen.getByRole("listitem", { name: `Requirement ${code}` }));

describe("FrameworkCoverageView", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
        if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(new Response(JSON.stringify({}), { status: method === "POST" ? 201 : 200 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the header counts and each Requirement's state, grouped by section, with its mapped Controls", () => {
    renderView(false);

    expect(stat("Requirements")).toHaveTextContent("4");
    expect(stat("Covered")).toHaveTextContent("1");
    expect(stat("Gaps")).toHaveTextContent("2");
    expect(stat("Accepted")).toHaveTextContent("1");

    expect(screen.getByRole("region", { name: "Section Article 21" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Section Article 22" })).toBeInTheDocument();
    expect(row("Art. 1").getByText("Covered")).toBeInTheDocument();
    expect(row("Art. 2").getByText("Coverage Gap")).toBeInTheDocument();
    expect(row("Art. 4").getByText("Accepted gap")).toBeInTheDocument();

    expect(row("Art. 1").getByText(/Full coverage · Supplementary \(NIS2:2022\)/)).toBeInTheDocument();
    expect(row("Art. 1").getByText(/Partial coverage/)).toBeInTheDocument();
    expect(row("Art. 3").getByText("No mapped Controls.")).toBeInTheDocument();
    expect(row("Art. 4").getByText(/Accepted by Carla Manager on .*: Handled by contract/)).toBeInTheDocument();
  });

  it("'Gaps only' shows just the open gaps; 'Accepted gaps only' just the accepted", async () => {
    const user = userEvent.setup();
    renderView(false);

    await user.selectOptions(screen.getByLabelText("Coverage filter"), "GAPS");
    expect(screen.getByRole("listitem", { name: "Requirement Art. 2" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Requirement Art. 3" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Requirement Art. 1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Requirement Art. 4" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Coverage filter"), "ACCEPTED");
    expect(screen.getByRole("listitem", { name: "Requirement Art. 4" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Requirement Art. 2" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Coverage filter"), "ALL");
    expect(screen.getAllByRole("listitem", { name: /^Requirement / })).toHaveLength(4);
  });

  it("is read-only for someone who can't curate: no accept or create actions", () => {
    renderView(false);

    expect(screen.queryByRole("button", { name: /Accept gap/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Un-accept/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Supplementary Control/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit Requirements/ })).not.toBeInTheDocument();
  });

  it("offers actions on gaps only, not on covered Requirements", () => {
    renderView(true);

    expect(row("Art. 1").queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept gap Art. 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Supplementary Control for Art. 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Un-accept gap Art. 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit justification for Art. 4" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Edit Requirements/ })).toHaveAttribute("href", "/admin/frameworks/f1");
  });

  it("accepts a gap with a justification, then reloads the Coverage data", async () => {
    const user = userEvent.setup();
    renderView(true);

    // After the PUT, the reload returns Art. 3 as accepted with updated counts.
    data.summary = { total: 4, covered: 1, gaps: 1, accepted: 2 };
    data.requirements[2] = requirement({
      id: "q3",
      code: "Art. 3",
      state: "ACCEPTED_GAP",
      gapAcceptedAt: "2026-09-29T11:00:00.000Z",
      gapAcceptedBy: { id: "u1", name: "Carla Manager" },
      gapJustification: "Out of scope",
    });

    await user.click(screen.getByRole("button", { name: "Accept gap Art. 3" }));
    const form = within(screen.getByRole("form", { name: "Accept gap Art. 3" }));
    await user.type(form.getByLabelText("Justification"), "Out of scope");
    await user.click(form.getByRole("button", { name: "Save acceptance" }));

    await waitFor(() => expect(calls("PUT")).toHaveLength(1));
    expect(calls("PUT")[0][0]).toBe("/api/frameworks/f1/requirements/q3/gap-acceptance");
    expect(JSON.parse(calls("PUT")[0][1].body)).toEqual({ justification: "Out of scope" });

    expect(await screen.findByText(/Accepted by Carla Manager on .*: Out of scope/)).toBeInTheDocument();
    expect(row("Art. 3").getByText("Accepted gap")).toBeInTheDocument();
    expect(stat("Gaps")).toHaveTextContent("1");
    expect(stat("Accepted")).toHaveTextContent("2");
  });

  it("shows the server's error, e.g. when the justification is refused", async () => {
    const user = userEvent.setup();
    renderView(true);
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "A justification is required to accept a gap" }), { status: 400 })),
    );

    await user.click(screen.getByRole("button", { name: "Accept gap Art. 3" }));
    await user.type(screen.getByLabelText("Justification"), "x");
    await user.click(screen.getByRole("button", { name: "Save acceptance" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A justification is required to accept a gap");
  });

  it("un-accepts a gap", async () => {
    const user = userEvent.setup();
    renderView(true);
    data.summary = { total: 4, covered: 1, gaps: 3, accepted: 0 };
    data.requirements[3] = requirement({ id: "q4", code: "Art. 4", section: "Article 22", state: "GAP" });

    await user.click(screen.getByRole("button", { name: "Un-accept gap Art. 4" }));

    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/frameworks/f1/requirements/q4/gap-acceptance");
    await waitFor(() => expect(row("Art. 4").getByText("Coverage Gap")).toBeInTheDocument());
    expect(stat("Accepted")).toHaveTextContent("0");
  });

  it("creates a Supplementary Control from a gap: the form names the origin Framework and posts the Control", async () => {
    const user = userEvent.setup();
    renderView(true);
    data.summary = { total: 4, covered: 2, gaps: 1, accepted: 1 };
    data.requirements[2] = requirement({
      id: "q3",
      code: "Art. 3",
      state: "COVERED",
      mappings: [{ id: "m9", coverage: "FULL", rationale: null, control: control("SUP-002", framework) }],
    });

    await user.click(screen.getByRole("button", { name: "Create Supplementary Control for Art. 3" }));
    const form = within(screen.getByRole("form", { name: "New Supplementary Control for Art. 3" }));
    expect(form.getByText(/Origin Framework: NIS2:2022/)).toBeInTheDocument();

    await user.type(form.getByLabelText("Code"), "SUP-002");
    await user.type(form.getByLabelText("Title"), "Notify the CSIRT");
    await user.type(form.getByLabelText("Description"), "Notify within 24h");
    await user.type(form.getByLabelText("Category"), "Legal");
    await user.type(form.getByLabelText("Self-Assessment Question"), "Do you notify within 24h?");
    await user.click(form.getByRole("button", { name: "Create Control" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(calls("POST")[0][0]).toBe("/api/frameworks/f1/requirements/q3/supplementary-control");
    expect(JSON.parse(calls("POST")[0][1].body)).toMatchObject({
      code: "SUP-002",
      title: "Notify the CSIRT",
      category: "Legal",
      applicability: "PER_SYSTEM",
      question: "Do you notify within 24h?",
    });

    await waitFor(() => expect(row("Art. 3").getByText("Covered")).toBeInTheDocument());
    expect(row("Art. 3").getByText(/Supplementary \(NIS2:2022\)/)).toBeInTheDocument();
    expect(stat("Covered")).toHaveTextContent("2");
    // Many typed fields: slow under full-suite worker contention, so above the 5s default.
  }, 20000);
});
