import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemCatalogRelation } from "../SystemCatalogRelation";

describe("SystemCatalogRelation (Framework Scope)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/frameworks") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                frameworks: [
                  { id: "f1", name: "ISO/IEC 27001", version: "2022", description: null, status: "PUBLISHED" },
                  { id: "f2", name: "NIS2", version: "1", description: null, status: "DRAFT" },
                  { id: "f3", name: "GDPR", version: "2016", description: null, status: "PUBLISHED" },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(JSON.stringify({ frameworkScopes: [] }), { status: 200 }));
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not offer a Draft Framework to declare", async () => {
    render(
      <SystemCatalogRelation
        systemId="s1"
        canManage
        resourcePath="/api/systems/s1/framework-scopes"
        resourceKey="frameworkScopes"
        catalogPath="/api/frameworks"
        catalogKey="frameworks"
        idField="frameworkId"
        itemLabel="Framework"
      />,
    );

    const picker = await screen.findByLabelText("Declare a Framework");
    expect(within(picker).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Select a Framework…",
      "ISO/IEC 27001:2022",
      "GDPR:2016",
    ]);
  });

  it("shows the base Framework as fixed (no Remove button) and other declared Frameworks as removable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === "/api/frameworks") {
          return Promise.resolve(new Response(JSON.stringify({ frameworks: [] }), { status: 200 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              frameworkScopes: [
                { id: "f1", name: "ISO/IEC 27001", version: "2022", description: null, status: "PUBLISHED", isBase: true },
                { id: "f3", name: "GDPR", version: "2016", description: null, status: "PUBLISHED", isBase: false },
                { id: "f2", name: "NIS2", version: "1", description: null, status: "DRAFT", isBase: false },
              ],
            }),
            { status: 200 },
          ),
        );
      }),
    );
    render(
      <SystemCatalogRelation
        systemId="s1"
        canManage
        resourcePath="/api/systems/s1/framework-scopes"
        resourceKey="frameworkScopes"
        catalogPath="/api/frameworks"
        catalogKey="frameworks"
        idField="frameworkId"
        itemLabel="Framework"
      />,
    );

    const base = (await screen.findByText(/ISO\/IEC 27001:2022/)).closest("li")!;
    expect(within(base).getByText(/Base Framework, always in scope/)).toBeInTheDocument();
    expect(within(base).queryByRole("button", { name: "Remove" })).toBeNull();

    const published = screen.getByText(/GDPR:2016/).closest("li")!;
    expect(within(published).getByRole("button", { name: "Remove" })).toBeInTheDocument();

    // A Draft Framework's scope row is inert: labelled as such, but still removable.
    const draft = screen.getByText(/NIS2:1/).closest("li")!;
    expect(within(draft).getByText(/Draft, no effect until published/)).toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("hides Remove for everything, base included, when the viewer can't manage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              frameworkScopes: [
                { id: "f1", name: "ISO/IEC 27001", version: "2022", description: null, status: "PUBLISHED", isBase: true },
                { id: "f3", name: "GDPR", version: "2016", description: null, status: "PUBLISHED", isBase: false },
              ],
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    render(
      <SystemCatalogRelation
        systemId="s1"
        canManage={false}
        resourcePath="/api/systems/s1/framework-scopes"
        resourceKey="frameworkScopes"
        catalogPath="/api/frameworks"
        catalogKey="frameworks"
        idField="frameworkId"
        itemLabel="Framework"
      />,
    );

    await screen.findByText(/GDPR:2016/);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByLabelText("Declare a Framework")).toBeNull();
  });
});
