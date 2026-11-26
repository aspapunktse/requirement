import { describe, expect, it } from "vitest";
import { addMonthsUtc, effectiveExpiry, isEvidenceStale, noteHasTextBeyondUrls, toEvidenceView, urlsIn } from "@/lib/evidence";

const d = (iso: string) => new Date(iso);

describe("addMonthsUtc", () => {
  it("adds calendar months and clamps the day to the end of a shorter month", () => {
    expect(addMonthsUtc(d("2026-01-15T10:00:00Z"), 12).toISOString()).toBe("2027-01-15T10:00:00.000Z");
    expect(addMonthsUtc(d("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonthsUtc(d("2024-01-31T00:00:00Z"), 1).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(addMonthsUtc(d("2026-11-30T00:00:00Z"), 3).toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });
});

describe("effectiveExpiry (#455)", () => {
  const collectedAt = d("2026-01-31T00:00:00Z");
  it("is the person's own date when one is set, whatever the Control's period", () => {
    const expiresAt = d("2026-03-01T00:00:00Z");
    expect(effectiveExpiry({ collectedAt, expiresAt }, 12)).toEqual(expiresAt);
    expect(effectiveExpiry({ collectedAt, expiresAt }, null)).toEqual(expiresAt);
  });
  it("is collected plus the Control's validity period otherwise", () => {
    expect(effectiveExpiry({ collectedAt, expiresAt: null }, 1)?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(effectiveExpiry({ collectedAt, expiresAt: null }, 12)?.toISOString()).toBe("2027-01-31T00:00:00.000Z");
  });
  it("is never when the Control has no period and nothing overrides it", () => {
    expect(effectiveExpiry({ collectedAt, expiresAt: null }, null)).toBeNull();
    expect(effectiveExpiry({ collectedAt, expiresAt: null }, 0)).toBeNull();
  });
});

describe("isEvidenceStale", () => {
  const evidence = { collectedAt: d("2025-01-01T00:00:00Z"), expiresAt: null };
  it("is stale from the effective expiry on, and not before", () => {
    expect(isEvidenceStale(evidence, 12, d("2025-12-31T23:59:59Z"))).toBe(false);
    expect(isEvidenceStale(evidence, 12, d("2026-01-01T00:00:00Z"))).toBe(true);
  });
  it("never goes stale without a period or an override", () => {
    expect(isEvidenceStale(evidence, null, d("2099-01-01T00:00:00Z"))).toBe(false);
  });
  it("an override beats the period in both directions", () => {
    expect(isEvidenceStale({ ...evidence, expiresAt: d("2025-02-01T00:00:00Z") }, 120, d("2025-03-01T00:00:00Z"))).toBe(true);
    expect(isEvidenceStale({ ...evidence, expiresAt: d("2030-01-01T00:00:00Z") }, 1, d("2026-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("evidence notes", () => {
  it("finds http(s) URLs without trailing punctuation", () => {
    expect(urlsIn("See https://a.example/x, and (https://b.example/y?z=1). ftp://no")).toEqual(["https://a.example/x", "https://b.example/y?z=1"]);
  });
  it("says whether a note has text beyond the URLs that are already records", () => {
    expect(noteHasTextBeyondUrls("https://a.example/x", ["https://a.example/x"])).toBe(false);
    expect(noteHasTextBeyondUrls("https://a.example/x, https://b.example/", ["https://a.example/x", "https://b.example/"])).toBe(false);
    expect(noteHasTextBeyondUrls("Audit report https://a.example/x", ["https://a.example/x"])).toBe(true);
    expect(noteHasTextBeyondUrls("https://a.example/x", [])).toBe(true);
  });
});

describe("toEvidenceView", () => {
  it("carries the effective expiry and the stale flag", () => {
    const view = toEvidenceView(
      { id: "e1", kind: "LINK", url: "https://a.example", title: null, systemDocumentId: null, collectedAt: d("2025-01-01T00:00:00Z"), expiresAt: null },
      6,
      d("2026-01-01T00:00:00Z"),
    );
    expect(view).toMatchObject({ effectiveExpiresAt: "2025-07-01T00:00:00.000Z", expiresAt: null, stale: true });
  });
});
