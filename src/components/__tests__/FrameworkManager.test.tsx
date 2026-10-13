import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameworkManager, type FrameworkRow } from "../FrameworkManager";

const iso: FrameworkRow = {
  id: "f-iso",
  name: "ISO/IEC 27001",
  version: "2022",
  description: null,
  strictComplianceRequired: false,
  licensing: "PARAPHRASE_ONLY",
  supersedesId: null,
  isBase: true,
  status: "PUBLISHED",
  _count: { requirements: 93 },
  coverage: { total: 93, covered: 93, gaps: 0, accepted: 0 },
};
const nis2: FrameworkRow = {
  id: "f-nis2",
  name: "NIS2",
  version: "1",
  description: null,
  strictComplianceRequired: false,
  licensing: "QUOTABLE",
  supersedesId: null,
  isBase: false,
  status: "DRAFT",
  _count: { requirements: 2 },
  coverage: { total: 2, covered: 1, gaps: 1, accepted: 0 },
};

let frameworks: FrameworkRow[];

function calls(method: string) {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === method);
}

describe("FrameworkManager", () => {
  beforeEach(() => {
    frameworks = [iso, nis2];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method === "GET") return Promise.resolve(new Response(JSON.stringify({ frameworks }), { status: 200 }));
        return Promise.resolve(new Response(JSON.stringify({ framework: {} }), { status: 200 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows each Framework's status, links to its authoring page, and offers Publish only for a Draft", () => {
    render(<FrameworkManager initialFrameworks={frameworks} />);

    expect(screen.getByText("Base Framework")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Requirements and Control Mappings for NIS2:1" })).toHaveAttribute(
      "href",
      "/admin/frameworks/f-nis2",
    );
    expect(screen.getAllByRole("button", { name: "Publish" })).toHaveLength(1);
  });

  it("shows covered / gap / accepted counts per Framework and links to its Coverage view", () => {
    render(<FrameworkManager initialFrameworks={frameworks} />);

    expect(screen.getByText("93/93 covered")).toBeInTheDocument();
    expect(screen.getByText("0 gaps")).toBeInTheDocument();
    expect(screen.getByText("1/2 covered")).toBeInTheDocument();
    expect(screen.getByText("1 gap")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Coverage of NIS2:1" })).toHaveAttribute("href", "/frameworks/f-nis2/coverage");
  });

  it("publishes a Draft only after the confirm is accepted", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<FrameworkManager initialFrameworks={frameworks} />);

    await user.click(screen.getByRole("button", { name: "Publish" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("NIS2:1 (2 Requirements)"));
    expect(calls("POST")).toHaveLength(0);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(calls("POST")[0][0]).toBe("/api/frameworks/f-nis2/publish");
  });

  it("saves metadata: name, version, supersedes, licensing and the strict flag", async () => {
    const user = userEvent.setup();
    render(<FrameworkManager initialFrameworks={frameworks} />);

    await user.clear(screen.getByLabelText("Version for NIS2:1"));
    await user.type(screen.getByLabelText("Version for NIS2:1"), "2");
    await user.selectOptions(screen.getByLabelText("Supersedes for NIS2:1"), "f-iso");
    await user.selectOptions(screen.getByLabelText("Licensing for NIS2:1"), "PARAPHRASE_ONLY");
    const card = screen.getByLabelText("Name for NIS2:1").closest("li")!;
    await user.click(card.querySelector('input[type="checkbox"]')!);
    await user.click(screen.getAllByRole("button", { name: "Save" })[1]);

    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    const [url, init] = calls("PATCH")[0];
    expect(url).toBe("/api/frameworks/f-nis2");
    expect(JSON.parse(init.body)).toEqual({
      name: "NIS2",
      version: "2",
      description: "",
      strictComplianceRequired: true,
      licensing: "PARAPHRASE_ONLY",
      supersedesId: "f-iso",
    });
  });

  it("creates a Draft Framework with its licensing and supersedes link", async () => {
    const user = userEvent.setup();
    render(<FrameworkManager initialFrameworks={frameworks} />);

    await user.type(screen.getByLabelText("Name"), "CMMC");
    await user.type(screen.getByLabelText("Version"), "2.0");
    await user.selectOptions(screen.getByLabelText("New Framework licensing"), "QUOTABLE");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1].body)).toMatchObject({
      name: "CMMC",
      version: "2.0",
      licensing: "QUOTABLE",
      supersedesId: null,
    });
  });

  it("disables Retire for the base Framework", () => {
    render(<FrameworkManager initialFrameworks={frameworks} />);
    const retire = screen.getAllByRole("button", { name: "Retire" });
    expect(retire[0]).toBeDisabled();
    expect(retire[1]).toBeEnabled();
  });
});

describe("FrameworkManager: version lineage (#146)", () => {
  const v = (id: string, version: string, supersedesId: string | null, status: "DRAFT" | "PUBLISHED" = "PUBLISHED"): FrameworkRow => ({
    ...iso,
    id,
    version,
    supersedesId,
    status,
    isBase: false,
  });

  it("shows a three-version chain in order on every member, marking the current one and the Draft", () => {
    const items = [v("f3", "2030", "f2"), v("f1", "2013", null), v("f2", "2022", "f1", "DRAFT")];
    render(<FrameworkManager initialFrameworks={items} />);

    const lines = screen.getAllByText(/Version lineage:/);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.textContent).toBe(
        "Version lineage: ISO/IEC 27001:2013 → ISO/IEC 27001:2022 (Draft) → ISO/IEC 27001:2030",
      );
    }
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(3);
  });

  it("shows no lineage for Frameworks that supersede nothing and are superseded by nothing", () => {
    render(<FrameworkManager initialFrameworks={[iso, nis2]} />);
    expect(screen.queryByText(/Version lineage:/)).not.toBeInTheDocument();
  });
});
