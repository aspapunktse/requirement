import { describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import {
  canManageProviderDependencies,
  creditedOfferings,
  dependencyOfferingSource,
  describeDependencyAdded,
  describeDependencyRemovalConfirmation,
  describeDependencyRemoved,
  type DependencyOffering,
  type ProviderDependencyRow,
} from "../provider-dependency-rules";

/** Pure rules of Provider dependencies (#124): who may, the Change Event wording, what the page may say. */

const ROLES: UserRole[] = ["ADMIN", "RISK_OWNER", "SYSTEM_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "COMPLIANCE_MANAGER"];

describe("canManageProviderDependencies", () => {
  it.each(ROLES)("%s: only an Admin, or the System's owner (never a Compliance Manager)", (role) => {
    const allowedAsOwner = role !== "COMPLIANCE_MANAGER";
    expect(canManageProviderDependencies({ id: "u", role }, { ownerId: "u" })).toBe(allowedAsOwner);
    expect(canManageProviderDependencies({ id: "u", role }, { ownerId: "someone-else" })).toBe(role === "ADMIN");
  });
});

describe("the Change Event wording", () => {
  it("names the Provider", () => {
    expect(describeDependencyAdded("Landing Zone")).toBe('Provider dependency on "Landing Zone" added');
    expect(describeDependencyRemoved("Landing Zone")).toBe('Provider dependency on "Landing Zone" removed');
  });
});

describe("what removing a dependency stops", () => {
  const offering = (code: string, over: Partial<DependencyOffering> = {}): DependencyOffering => ({
    control: { id: code, code, title: `Title ${code}` },
    type: "FULL",
    customerResponsibility: null,
    providerStatus: "FULFILLED",
    appliesToProvider: true,
    ...over,
  });
  const row = (over: Partial<ProviderDependencyRow> = {}): ProviderDependencyRow => ({
    providerId: "p1",
    name: "Landing Zone",
    onboarded: true,
    canSee: true,
    offerings: [
      offering("A.1"),
      offering("A.2", { providerStatus: "IN_PROGRESS" }),
      offering("A.3", { type: "SHARED", customerResponsibility: "x" }),
      offering("A.4", { appliesToProvider: false }),
    ],
    ...over,
  });

  it("is the Fulfilled Full Offerings that still apply, while the Provider is Onboarded", () => {
    expect(creditedOfferings(row()).map((o) => o.control.code)).toEqual(["A.1"]);
    expect(creditedOfferings(row({ onboarded: false }))).toEqual([]);
  });

  it("builds the same source the server resolves", () => {
    expect(dependencyOfferingSource(row(), offering("A.3", { type: "SHARED", customerResponsibility: "Keys" }))).toEqual({
      kind: "PROVIDER",
      type: "SHARED",
      status: "FULFILLED",
      provider: { id: "p1", name: "Landing Zone" },
      providerOnboarded: true,
      appliesToProvider: true,
      customerResponsibility: "Keys",
    });
  });

  it("the confirmation names the Controls that stop being inherited, or says nothing changes", () => {
    // Full only: the wording is what it was before Shared Offerings could give credit.
    const fullOnly = row({ offerings: [offering("A.1"), offering("A.2", { providerStatus: "IN_PROGRESS" })] });
    expect(describeDependencyRemovalConfirmation(fullOnly)).toBe(
      'Remove the dependency on Provider "Landing Zone"? These Controls stop being inherited from it: A.1 (unless another source still gives them credit). Nothing is changed on this System\'s own Assessments.',
    );
    // A Shared Offering that counts is named too (#125): its Control is then judged by the System's own Assessment alone.
    expect(describeDependencyRemovalConfirmation(row())).toBe(
      'Remove the dependency on Provider "Landing Zone"? These Controls stop being inherited from it: A.1 (unless another source still gives them credit). Its Shared Offerings (A.3) stop counting: those Controls are then judged by this System\'s own Assessment alone. Nothing is changed on this System\'s own Assessments.',
    );
    const sharedOnly = row({ offerings: [offering("A.3", { type: "SHARED", customerResponsibility: "x", providerStatus: "NOT_STARTED" })] });
    expect(describeDependencyRemovalConfirmation(sharedOnly)).toBe(
      'Remove the dependency on Provider "Landing Zone"? Its Shared Offerings (A.3) stop counting: those Controls are then judged by this System\'s own Assessment alone. Nothing is changed on this System\'s own Assessments.',
    );
    // One that can't count (pending Provider, Control no longer applies) changes nothing.
    expect(describeDependencyRemovalConfirmation(row({ onboarded: false, offerings: [offering("A.3", { type: "SHARED", customerResponsibility: "x" })] }))).toBe(
      'Remove the dependency on Provider "Landing Zone"? It gives this System no credit right now, so no Control\'s status changes.',
    );
    expect(describeDependencyRemovalConfirmation(row({ onboarded: false }))).toBe(
      'Remove the dependency on Provider "Landing Zone"? It gives this System no credit right now, so no Control\'s status changes.',
    );
  });
});
