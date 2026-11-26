import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OscalPackage } from "@/lib/oscal/package-builder";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { OscalPackageReview } from "../OscalPackageReview";

afterEach(cleanup);

const NS = "https://github.com/aspapunktse/requirement/ns/oscal";
const GAP = "No implementation description recorded.";
const prop = (value: string) => ({ name: "control-assessment-status", ns: NS, value });
const app = (name: string, value: string) => ({ name, ns: NS, value });

const pkg = {
  catalog: {
    catalog: {
      controls: [
        { id: "a-5-15", title: "Access control", props: [{ name: "label", value: "A.5.15" }] },
        { id: "a-8-2", title: "Privileged access", props: [{ name: "label", value: "A.8.2" }] },
        { id: "a-8-9", title: "Configuration management", props: [{ name: "label", value: "A.8.9" }] },
        { id: "a-5-1", title: "Policies", props: [{ name: "label", value: "A.5.1" }] },
      ],
    },
  },
  profile: {},
  ssp: {
    "system-security-plan": {
      metadata: { "last-modified": "2026-11-24T10:00:00.000Z", version: "unreleased", "document-ids": [{ scheme: `${NS}/document-id`, identifier: "11111111-1111-5111-8111-111111111111" }] },
      "system-characteristics": { "system-name": "Test Payroll", status: { state: "operational" } },
      "system-implementation": {
        components: [
          { uuid: "c-system", title: "Test Payroll" },
          { uuid: "c-provider", title: "Test Hosting Provider" },
          { uuid: "c-shared", title: "Test Shared Provider" },
        ],
      },
      "control-implementation": {
        "implemented-requirements": [
          {
            uuid: "req-1",
            "control-id": "a-5-15",
            "by-components": [
              { "component-uuid": "c-system", description: "Roles are reviewed quarterly.", props: [prop("FULFILLED")], "implementation-status": { state: "implemented" } },
              { "component-uuid": "c-provider", description: "Hosting access is managed by the Provider.", props: [prop("IN_PROGRESS")], "implementation-status": { state: "partial" } },
            ],
          },
          {
            uuid: "req-3",
            "control-id": "a-8-9",
            props: [app("effective-status", "IN_PROGRESS"), app("effective-source", "SYSTEM")],
            "by-components": [
              { "component-uuid": "c-shared", description: GAP, props: [app("offering-type", "SHARED"), app("provider-status", "FULFILLED")], "implementation-status": { state: "implemented" } },
              { "component-uuid": "c-system", description: "Customer responsibility: configure the tenant.", props: [prop("IN_PROGRESS"), app("customer-half", "open")], "implementation-status": { state: "partial" } },
            ],
          },
          {
            uuid: "req-4",
            "control-id": "a-5-1",
            props: [app("effective-status", "WAIVED"), app("effective-source", "SYSTEM"), app("overrides-inherited", "true")],
            "by-components": [{ "component-uuid": "c-system", description: GAP, props: [prop("WAIVED"), app("risk", "risk-uuid-1")] }],
          },
          { uuid: "req-2", "control-id": "a-8-2", "by-components": [{ "component-uuid": "c-system", description: GAP, props: [prop("NOT_STARTED")] }] },
        ],
      },
    },
  },
} as unknown as OscalPackage;

describe("the OSCAL Package review page (#445)", () => {
  it("shows the System, its state, the generation time and the download and Requirements links", () => {
    render(<OscalPackageReview pkg={pkg} systemId="s1" appNs={NS} />);
    expect(screen.getByText("operational")).toBeInTheDocument();
    expect(screen.getByText("2026-11-24T10:00:00.000Z")).toBeInTheDocument();
    expect(screen.getByText("unreleased")).toBeInTheDocument();
    expect(screen.getByText("11111111-1111-5111-8111-111111111111")).toBeInTheDocument();
    expect(screen.getAllByText("Test Payroll").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Download this OSCAL Package" })).toHaveAttribute("href", "/api/systems/s1/oscal-package");
    expect(screen.getByRole("link", { name: "System's Requirements" })).toHaveAttribute("href", "/systems/s1#requirements");
  });

  it("lists code, control id, UUID, both statuses and every component for a Control", () => {
    render(<OscalPackageReview pkg={pkg} systemId="s1" appNs={NS} />);
    const row = screen.getByText("A.5.15").closest("tr") as HTMLElement;
    expect(within(row).getByText("Access control")).toBeInTheDocument();
    expect(within(row).getByText("a-5-15")).toBeInTheDocument();
    expect(within(row).getByText("req-1")).toBeInTheDocument();
    expect(within(row).getByText("Test Payroll")).toBeInTheDocument();
    expect(within(row).getByText("Test Hosting Provider")).toBeInTheDocument();
    expect(within(row).getByText("OSCAL status: implemented; app status: FULFILLED")).toBeInTheDocument();
    expect(within(row).getByText("OSCAL status: partial; app status: IN_PROGRESS")).toBeInTheDocument();
    expect(within(row).getByText("Roles are reviewed quarterly.")).toBeInTheDocument();
    expect(within(row).getByText("Hosting access is managed by the Provider.")).toBeInTheDocument();
  });

  it("shows the gap text as the package holds it, and no OSCAL status when the package makes no claim", () => {
    render(<OscalPackageReview pkg={pkg} systemId="s1" appNs={NS} />);
    const row = screen.getByText("A.8.2").closest("tr") as HTMLElement;
    expect(within(row).getByText(GAP)).toBeInTheDocument();
    expect(within(row).getByText("OSCAL status: None; app status: NOT_STARTED")).toBeInTheDocument();
    expect(within(row).getByText("req-2")).toBeInTheDocument();
  });

  it("shows the effective status and source, each part's own status, the open customer half and the Risk", () => {
    render(<OscalPackageReview pkg={pkg} systemId="s1" appNs={NS} />);
    const shared = screen.getByText("A.8.9").closest("tr") as HTMLElement;
    expect(within(shared).getByText("Effective status: IN_PROGRESS; source: SYSTEM")).toBeInTheDocument();
    expect(within(shared).getByText("OSCAL status: implemented; app status: FULFILLED")).toBeInTheDocument();
    expect(within(shared).getByText("OSCAL status: partial; app status: IN_PROGRESS")).toBeInTheDocument();
    expect(within(shared).getByText("Test Shared Provider")).toBeInTheDocument();
    expect(within(shared).getByText("Customer half: open")).toBeInTheDocument();

    const waived = screen.getByText("A.5.1").closest("tr") as HTMLElement;
    expect(within(waived).getByText("Effective status: WAIVED; source: SYSTEM; overrides an inherited status")).toBeInTheDocument();
    expect(within(waived).getByText("risk-uuid-1")).toBeInTheDocument();
  });
});
