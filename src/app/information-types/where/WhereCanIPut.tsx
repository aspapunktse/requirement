"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import { SensitivityChip } from "@/components/SensitivityChip";
import { declaresBelow, whereGroupOf, type WhereGroup } from "@/lib/information-type-where";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "../information-types.css";
import type { WhereSystem, WhereView } from "./where-data";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * "Where can I put this information?" (#305, design proposal A): a pick list of Information Types on one side, and on
 * the other the picked type with the Systems that already declare it, the ones that may hold it, and the ones below it.
 * The Systems listed are the ones the acting user may see; the counts are over every System, with "N more not visible
 * to you" where the list is shorter. The picked type is kept in the URL (`?type=<id>`) so the view can be linked.
 * "May hold it" is about the level only: the owner still has to declare the type on the System's Profile tab.
 */
export function WhereCanIPut({ view, initialTypeId }: { view: WhereView; initialTypeId: string | null }) {
  const { types, levels, systems, counts } = view;
  const [typeId, setTypeId] = useState(initialTypeId);
  const [query, setQuery] = useState("");
  const type = types.find((item) => item.id === typeId) ?? null;
  const labelOf = (level: number) => levels.find((info) => info.level === level)?.label ?? `Level ${level}`;

  const pickList = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? types.filter((item) => item.name.toLowerCase().includes(q)) : types;
  }, [types, query]);

  function pick(id: string) {
    setTypeId(id);
    window.history.replaceState(null, "", `${window.location.pathname}?type=${encodeURIComponent(id)}`);
  }

  const groups = useMemo(() => {
    const out: Record<WhereGroup, WhereSystem[]> = { declared: [], hold: [], below: [] };
    if (!type) return out;
    for (const system of systems) out[whereGroupOf(type.sensitivityLevel, { sensitivityLevel: system.sensitivityLevel, declares: system.typeIds.includes(type.id) })].push(system);
    return out;
  }, [systems, type]);
  const total = type ? counts[type.id] : undefined;

  function hiddenNote(group: WhereGroup) {
    const hidden = total ? total[group] - groups[group].length : 0;
    return hidden > 0 ? <li className="it-hidden">{hidden} more not visible to you.</li> : null;
  }

  function line(system: WhereSystem, mark: React.ReactNode) {
    return (
      <li key={system.id} className="it-sysrow">
        <span className="nm">
          <Link href={`/systems/${system.id}`}>{system.name}</Link>
          {system.isProvider && <span className="kindtag">Provider</span>}
        </span>
        <span className="it-sysrow-end">
          <SensitivityChip level={system.sensitivityLevel} label={system.sensitivityLevel === null ? undefined : labelOf(system.sensitivityLevel)} size="sm" />
          {mark}
        </span>
      </li>
    );
  }

  return (
    <div className="hc sy it" data-page-id="INFORMATION TYPES . WHERE CAN I PUT IT">
      <section className="hc-hero" aria-labelledby="itw-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Information Types</span>
          </div>
          <h1 id="itw-title">Where can I put this information?</h1>
          <p className="hc-lede">
            Pick a kind of information to see which Systems may hold it: those whose Sensitivity Level is at or above the type&apos;s. You see the Systems you
            have access to.
          </p>
          <div className="actions">
            <Link href="/information-types" className="hc-btn">
              Back to the catalogue
            </Link>
          </div>
        </div>
      </section>

      <section className="hc-card" aria-labelledby="itw-h">
        <h2 id="itw-h" className="sr-only">
          Where it may go
        </h2>
        <div className="it-whereg">
          <div>
            <h3 className="it-h3">Pick the information</h3>
            <p className="muted it-sub">Everyone can use this view.</p>
            <label className="hc-search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Search Information Types" aria-label="Search Information Types" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div role="radiogroup" aria-label="Information Type" className="it-pick">
              {pickList.map((item) => (
                <label key={item.id} className="it-trow">
                  <input type="radio" name="where-type" value={item.id} checked={item.id === typeId} onChange={() => pick(item.id)} />
                  <span className="t">{item.name}</span>
                  <SensitivityChip level={item.sensitivityLevel} label={labelOf(item.sensitivityLevel)} size="sm" />
                </label>
              ))}
              {pickList.length === 0 && <p className="muted">{types.length === 0 ? "No Information Types in the catalogue yet." : "No Information Type matches."}</p>}
            </div>
          </div>

          <div className="it-res" aria-live="polite">
            {!type || !total ? (
              <p className="muted">Pick an Information Type to see where it may go.</p>
            ) : (
              <>
                <h3 className="it-h3">
                  {type.name} <SensitivityChip level={type.sensitivityLevel} label={labelOf(type.sensitivityLevel)} size="lg" />
                </h3>
                <p className="muted it-sub">{type.description ?? "No description."}</p>
                <p className="it-sumline">
                  <b>{plural(total.atOrAbove, "System")}</b> may hold it: their level is <SensitivityChip level={type.sensitivityLevel} label={labelOf(type.sensitivityLevel)} size="sm" /> or
                  above. {total.declared} declare{total.declared === 1 ? "s" : ""} it
                  {total.declaredBelow > 0 ? `, ${total.declaredBelow} of them below that level` : ""}.
                </p>

                <h4>
                  Already declare it <span className="cnt">{total.declared}</span>
                </h4>
                <ul className="it-rlist">
                  {groups.declared.map((system) =>
                    line(system, declaresBelow(type, system.sensitivityLevel) ? <span className="it-below">Below its Information Types</span> : <span className="it-mark">Declared</span>),
                  )}
                  {total.declared === 0 && <li className="muted">No System declares it yet.</li>}
                  {hiddenNote("declared")}
                </ul>

                <h4>
                  May hold it <span className="cnt">{total.hold}</span>
                </h4>
                <ul className="it-rlist">
                  {groups.hold.map((system) => line(system, <span className="it-mark hold">At or above</span>))}
                  {total.hold === 0 && <li className="muted">No other System is at this level.</li>}
                  {hiddenNote("hold")}
                </ul>

                <h4>
                  Below it, so no <span className="cnt">{total.below}</span>
                </h4>
                <ul className="it-rlist no">
                  {groups.below.map((system) => line(system, <span className="it-mark no">{system.sensitivityLevel === null ? "No level declared" : "Below"}</span>))}
                  {total.below === 0 && <li>None.</li>}
                  {hiddenNote("below")}
                </ul>

                <p className="muted it-sub it-note">
                  &quot;May hold it&quot; is about the level only. A System&apos;s owner still has to declare the type on its Profile tab before the System counts as holding it.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
