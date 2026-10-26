import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { resolveEffectiveStatus, type InheritanceSource, type ProviderSource } from "@/lib/effective-status";
import { SystemControls } from "../SystemControls";

/** Fixtures and helpers shared by the Controls tab's tests (#244). */

export type TestControl = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  question: string | null;
  intent?: string | null;
  examples?: string[];
};

export const control = (code: string, over: Partial<TestControl> = {}): TestControl => ({
  id: `c-${code}`,
  code,
  title: `Control ${code}`,
  description: `Description of ${code}.`,
  category: "A.5 Organizational",
  mandatory: false,
  question: null,
  intent: null,
  examples: [],
  ...over,
});

export type TestAssessment = {
  id: string;
  status: string;
  evidence: string | null;
  notes: string | null;
  selfAssessmentAnswer: string | null;
  assessedById: string | null;
  assessedBy?: { name: string } | null;
  assessedAt?: string | null;
  queries: unknown[];
};

/** An Assessment a person set (assessedById "owner") unless told otherwise. */
export const assessment = (status: string, over: Partial<TestAssessment> = {}): TestAssessment => ({
  id: `a-${Math.random().toString(36).slice(2, 8)}`,
  status,
  evidence: null,
  notes: null,
  selfAssessmentAnswer: null,
  assessedById: "owner",
  queries: [],
  ...over,
});

export const organization = (status: InheritanceSource["status"]): InheritanceSource => ({ kind: "ORGANIZATION", type: "FULL", status });
export const provider = (over: Partial<ProviderSource> = {}): ProviderSource => ({
  kind: "PROVIDER",
  type: "FULL",
  status: "FULFILLED",
  provider: { id: "p1", name: "Landing Zone" },
  providerOnboarded: true,
  appliesToProvider: true,
  customerResponsibility: null,
  ...over,
});
export const shared = (over: Partial<ProviderSource> = {}): ProviderSource => provider({ type: "SHARED", customerResponsibility: "The tenant manages its own keys", ...over });

/** A row as the API sends it, with the effective status resolved from the Assessment and the sources. */
export const rowOf = (c: TestControl, own: TestAssessment | null, sources: InheritanceSource[] = [], extra: Record<string, unknown> = {}) => ({
  control: c,
  assessment: own,
  effective: resolveEffectiveStatus(own ? { status: own.status as never, personSet: own.assessedById !== null } : null, sources),
  ...extra,
});

export const openQuery = (id = "q1", body = "Which version?", over: Record<string, unknown> = {}) => ({
  id,
  resolved: false,
  createdAt: "2026-09-01T00:00:00Z",
  messages: [{ id: `${id}-m1`, body, createdAt: "2026-09-01T00:00:00Z", attributedTo: null, author: { id: "reviewer", name: "Rita Reviewer", role: "REVIEWER" } }],
  ...over,
});

export const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

export type Call = { url: string; method: string; body: unknown };

/**
 * Stubs `fetch`: the list route serves `rows` and `stale`; anything else goes to `handle(call)`, which
 * answers a Response or nothing (a 404). Every call is recorded.
 */
export function stubApi(rows: unknown[], options: { stale?: unknown[]; handle?: (call: Call) => Promise<Response> | undefined } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    if (call.method === "GET" && url === "/api/systems/s1/assessments") return json({ assessments: rows, staleAssessments: options.stale ?? [] });
    return options.handle?.(call) ?? json({ error: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, sent: (method: string) => calls.filter((call) => call.method === method) };
}

type Props = Partial<React.ComponentProps<typeof SystemControls>>;

export const renderControls = (props: Props = {}) =>
  render(<SystemControls systemId="s1" userRole="SYSTEM_OWNER" currentUserId="owner" systemOwnerId="owner" {...props} />);

/** Renders the tab with the URL naming a Control, and returns queries scoped to its drawer. */
export async function renderDrawer(code: string, props: Props = {}) {
  window.history.replaceState(null, "", `/systems/s1#controls/${encodeURIComponent(code)}`);
  const view = renderControls(props);
  const dialog = await screen.findByRole("dialog");
  return { ...view, dialog, drawer: within(dialog) };
}
