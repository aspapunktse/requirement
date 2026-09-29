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
});
