"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { formatDay } from "./system-page-logic";
import { useRemote } from "./use-remote";

export type OscalReleaseRow = {
  id: string;
  number: number;
  trigger: "MANUAL" | "INTERNAL_AUDIT_CLOSE";
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  sha256: string;
};
type Releases = { releases: OscalReleaseRow[]; canCreate: boolean };

export const TRIGGER_LABEL: Record<OscalReleaseRow["trigger"], string> = { MANUAL: "By hand", INTERNAL_AUDIT_CLOSE: "Internal Audit closed" };

/**
 * The System's OSCAL Releases (#453), newest first: number, date, how it was made, who made it, the start of the zip's SHA-256
 * and a download. Each number links to the release's own page. For the System's owner or an Admin (`canCreate`, from the list
 * route) also "Make release", which stores the package as it is now as the next release. Releases are never edited or deleted.
 */
export function SystemOscalReleases({ systemId }: { systemId: string }) {
  const read = useCallback(async (): Promise<Releases> => {
    const response = await fetch(`/api/systems/${systemId}/oscal-releases`);
    if (!response.ok) throw new Error("Failed to load the releases");
    const body = await response.json();
    return { releases: body.releases ?? [], canCreate: !!body.canCreate };
  }, [systemId]);
  const { data, failed, reload } = useRemote(read);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setMaking(true);
    setError(null);
    try {
      const response = await fetch(`/api/systems/${systemId}/oscal-releases`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body?.error === "string" ? body.error : "Failed to make the release");
        return;
      }
      reload();
    } catch {
      setError("Failed to make the release");
    } finally {
      setMaking(false);
    }
  }

  return (
    <section className="hc-card" aria-labelledby="sc-releases-h">
      <div className="hc-card-h">
        <h2 id="sc-releases-h">OSCAL Releases</h2>
        {data?.canCreate && (
          <button type="button" className="hc-btn" disabled={making} onClick={make}>
            {making ? "Making release…" : "Make release"}
          </button>
        )}
      </div>
      <div className="hc-card-b">
        <p className="muted">A release keeps the System&apos;s OSCAL Package as it was on one day, unchanged, with a hash of every file. Releases are kept for good.</p>
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {failed && (
          <p role="alert" className="sc-err">
            Couldn&apos;t load the releases.{" "}
            <button type="button" className="sc-link" onClick={reload}>
              Try again
            </button>
          </p>
        )}
        {data === null ? (
          !failed && (
            <p role="status" className="hc-empty">
              Loading releases…
            </p>
          )
        ) : data.releases.length === 0 ? (
          <p className="hc-empty">No release has been made yet.</p>
        ) : (
          <div className="sc-tablewrap">
            <table className="sc-rt">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Date</th>
                  <th className="hide-sm">Made</th>
                  <th className="hide-sm">By</th>
                  <th>SHA-256</th>
                  <th>
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.releases.map((release) => (
                  <tr key={release.id}>
                    <td>
                      <Link className="sc-link" href={`/systems/${systemId}/oscal-releases/${release.number}`}>
                        Release {release.number}
                      </Link>
                    </td>
                    <td>{formatDay(release.createdAt)}</td>
                    <td className="hide-sm">{TRIGGER_LABEL[release.trigger]}</td>
                    <td className="hide-sm">{release.createdBy?.name ?? "Unknown"}</td>
                    <td>
                      <code title={release.sha256}>{release.sha256.slice(0, 12)}</code>
                    </td>
                    <td>
                      <a className="sc-link" href={`/api/systems/${systemId}/oscal-releases/${release.number}`} download aria-label={`Download release ${release.number}`}>
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
