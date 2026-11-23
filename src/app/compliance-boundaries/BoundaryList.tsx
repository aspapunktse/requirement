"use client";

import Link from "next/link";
import { useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { boundariesHolding, boundaryFrameworkCounts, emptyListMessage, type BoundaryListRow } from "@/lib/compliance-boundary";

/**
 * The Compliance Boundary list (#433, design proposal C and A's stat cards): one card per Framework held by at least one active
 * Boundary, with how many active Boundaries hold it (a Boundary holding two counts under both, a retired one under none, also when
 * "Show retired" lists it), and an "All" card. The cards are filters: a click lists only the Boundaries holding that Framework,
 * a second click or "All" clears it. The choice is kept in the URL (`?framework=<id>`, with `?retired=1` untouched) without a
 * navigation. No counters by state.
 */
export function BoundaryList({ boundaries, showRetired, hiddenRetired, initialFramework }: { boundaries: BoundaryListRow[]; showRetired: boolean; hiddenRetired: number; initialFramework: string | null }) {
  const counts = boundaryFrameworkCounts(boundaries);
  const activeTotal = boundaries.filter((boundary) => boundary.retiredAt === null).length;
  const [chosen, setChosen] = useState<string | null>(initialFramework);
  // A Framework no active Boundary holds has no card, so a stale `?framework=` shows everything.
  const framework = counts.some((entry) => entry.id === chosen) ? chosen : null;
  const shown = boundariesHolding(boundaries, framework);
  const chosenLabel = counts.find((entry) => entry.id === framework);

  function choose(id: string | null) {
    const next = id === framework ? null : id;
    setChosen(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("framework", next);
    else url.searchParams.delete("framework");
    window.history.replaceState(window.history.state, "", url);
  }

  // The retired toggle keeps the chosen Framework, so the filter survives it. The page re-keys this component on the URL's
  // `retired` and `framework`, so a navigation that changes them starts from the URL, never from a stale choice.
  const toggleHref = (retiredOn: boolean) => {
    const query = new URLSearchParams();
    if (retiredOn) query.set("retired", "1");
    if (framework) query.set("framework", framework);
    return `/compliance-boundaries${query.size > 0 ? `?${query}` : ""}`;
  };

  return (
    <>
      {counts.length > 0 && (
        <section className="hc-stats" aria-label="Compliance Boundaries per Framework">
          <button type="button" className="hc-card hc-stat" aria-pressed={framework === null} onClick={() => choose(null)}>
            <span className="k">
              All Frameworks
              <em aria-hidden="true">Show all</em>
            </span>
            <span className="v">{activeTotal}</span>
          </button>
          {counts.map((entry) => (
            <button key={entry.id} type="button" className="hc-card hc-stat" aria-pressed={framework === entry.id} onClick={() => choose(entry.id)}>
              <span className="k">
                {frameworkLabel(entry)}
                <em aria-hidden="true">Filter →</em>
              </span>
              <span className="v">{entry.count}</span>
            </button>
          ))}
        </section>
      )}

      <section className="hc-card" aria-labelledby="cb-list-h">
        <div className="hc-card-h">
          <h2 id="cb-list-h">{showRetired ? "All Compliance Boundaries, retired included" : "Compliance Boundaries"}</h2>
          <p>{framework && chosenLabel ? `${shown.length} holding ${frameworkLabel(chosenLabel)}` : shown.length}</p>
        </div>
        <p className="cb-filter">
          {showRetired ? (
            <Link href={toggleHref(false)}>Hide retired Compliance Boundaries</Link>
          ) : (
            <Link href={toggleHref(true)}>Show retired Compliance Boundaries</Link>
          )}
          {counts.length > 0 && <span className="cb-fine"> The cards count active Compliance Boundaries only.</span>}
        </p>
        {shown.length === 0 ? (
          <p className="cb-empty">{boundaries.length === 0 ? emptyListMessage(hiddenRetired) : "No Compliance Boundary holds this Framework."}</p>
        ) : (
          <ul className="cb-list">
            {shown.map((boundary) => (
              <li key={boundary.id}>
                <Link href={`/compliance-boundaries/${boundary.id}`} className="cb-row">
                  <b>
                    {boundary.name}
                    {boundary.retiredAt && <span className="cb-tag warn cb-retired-tag">Retired</span>}
                  </b>
                  {boundary.description && <small>{boundary.description}</small>}
                  <small>
                    {boundary.businessUnit ? `${boundary.businessUnit.name} · ` : ""}
                    {boundary.boundaryOwner ? `Boundary Owner: ${boundary.boundaryOwner.name}` : "No Boundary Owner"}
                  </small>
                  <span className="cb-tags">
                    {boundary.frameworks.map((entry) => (
                      <span key={entry.id} className="cb-tag fw">
                        {frameworkLabel(entry)}
                      </span>
                    ))}
                  </span>
                  <span className="cb-count">
                    {boundary.systemCount} {boundary.systemCount === 1 ? "System" : "Systems"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
