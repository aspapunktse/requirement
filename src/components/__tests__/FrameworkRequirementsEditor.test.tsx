import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameworkRequirementsEditor, type RequirementRow } from "../FrameworkRequirementsEditor";

const controls = [{ id: "c1", code: "A.5.1", title: "Policies" }];
const requirement = (over: Partial<RequirementRow>): RequirementRow => ({
  id: "q",
  code: "1",
  section: "Section",
  title: "Title",
  text: "Own words",
  mappings: [],
  ...over,
});

let stored: RequirementRow[];

function calls(method: string) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === method);
}

function renderEditor(licensing: "PARAPHRASE_ONLY" | "QUOTABLE" = "PARAPHRASE_ONLY") {
  return render(
    <FrameworkRequirementsEditor
      frameworkId="f1"
      licensing={licensing}
      initialRequirements={stored}
      controls={controls}
    />,
  );
}

function addForm() {
  return within(screen.getByRole("heading", { name: "Add a Requirement" }).closest("form")!);
}

describe("FrameworkRequirementsEditor", () => {
  beforeEach(() => {
    stored = [
      requirement({ id: "q10", code: "Art. 10", section: "Chapter 2" }),
      requirement({ id: "q2", code: "Art. 2", section: "Chapter 2", title: "Second" }),
      requirement({
        id: "q1",
        code: "Art. 1",
        section: "Chapter 1",
        title: "First",
        mappings: [
          { id: "m1", coverage: "PARTIAL", rationale: null, control: { id: "c1", code: "A.5.1", title: "Policies" } },
        ],
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          return Promise.resolve(new Response(JSON.stringify({ requirements: stored }), { status: 200 }));
        }
        if (method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(new Response(JSON.stringify({ requirement: {} }), { status: 200 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("groups Requirements by section, in natural order of section and code", () => {
    renderEditor();
    const sections = screen.getAllByRole("region").map((s) => s.getAttribute("aria-label"));
    expect(sections).toEqual(["Section Chapter 1", "Section Chapter 2"]);

    const chapter2 = within(screen.getByRole("region", { name: "Section Chapter 2" }));
    const codes = chapter2.getAllByRole("button", { name: /^Edit / }).map((b) => b.getAttribute("aria-label"));
    expect(codes).toEqual(["Edit Art. 2", "Edit Art. 10"]);
  });

  it("shows the own-words hint for a PARAPHRASE_ONLY Framework and not for a quotable one", () => {
    const { unmount } = renderEditor("PARAPHRASE_ONLY");
    expect(screen.getByText(/Own-words paraphrase, no verbatim text/)).toBeInTheDocument();
    unmount();

    renderEditor("QUOTABLE");
    expect(screen.queryByText(/Own-words paraphrase, no verbatim text/)).not.toBeInTheDocument();
    expect(screen.getByText(/public domain/)).toBeInTheDocument();
  });

  it("creates a Requirement and reloads the list", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(addForm().getByLabelText("Code"), "Art. 3");
    await user.type(addForm().getByLabelText("Section"), "Chapter 3");
    await user.type(addForm().getByLabelText("Title"), "Third");
    await user.type(addForm().getByLabelText("Text"), "In my own words");
    await user.click(addForm().getByRole("button", { name: "Add Requirement" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    const [url, init] = calls("POST")[0];
    expect(url).toBe("/api/frameworks/f1/requirements");
    expect(JSON.parse(init.body)).toEqual({
      code: "Art. 3",
      section: "Chapter 3",
      title: "Third",
      text: "In my own words",
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/frameworks/f1/requirements"));
  });

  it("edits a Requirement in place with a PATCH", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Edit Art. 1" }));
    const title = screen.getAllByLabelText("Title")[0];
    await user.clear(title);
    await user.type(title, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save Requirement" }));

    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    const [url, init] = calls("PATCH")[0];
    expect(url).toBe("/api/frameworks/f1/requirements/q1");
    expect(JSON.parse(init.body)).toMatchObject({ code: "Art. 1", section: "Chapter 1", title: "Renamed" });
  });

  it("deletes a Requirement only after a confirm that warns about its mappings", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete Art. 1" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 Control Mapping will be removed too/));
    expect(calls("DELETE")).toHaveLength(0);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete Art. 1" }));
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/frameworks/f1/requirements/q1");
  });

  it("shows the server's error when a create is refused", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "This Framework already has a Requirement with that code" }), {
          status: 409,
        }),
      ),
    );
    const user = userEvent.setup();
    renderEditor();
    await user.type(addForm().getByLabelText("Code"), "Art. 1");
    await user.type(addForm().getByLabelText("Section"), "S");
    await user.type(addForm().getByLabelText("Title"), "T");
    await user.type(addForm().getByLabelText("Text"), "t");
    await user.click(addForm().getByRole("button", { name: "Add Requirement" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already has a Requirement with that code");
  });
});
