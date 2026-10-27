"use client";

import type { CSSProperties } from "react";
import { ApprovalPanel } from "@/components/ApprovalPanel";
import { ago } from "@/app/home/home-format";
import { formatDay } from "./system-page-logic";
import type { TimelineItem } from "./system-page-types";

const DAY_MS = 86_400_000;
const TONE_COLOR = { ok: "var(--rg-success)", warn: "var(--rg-gold)", danger: "var(--rg-danger)", accent: "var(--rg-accent)" };

/**
 * The Approval and activity tab (design proposal A, #245): the full approval panel (the current Review Round,
 * its Review Steps and decisions with comments; `ApprovalPanel`, on the same API the header's shortcuts use),
 * and below it a timeline of every Change Event on the System, newest first. Each entry shows who, what, the
 * event's detail as it was written (a classification change says what changed there: scope, Business Unit,
 * dependency, Impact Level) and when. A System older than the `SYSTEM_CREATED` event ends in a "Created" entry
 * from its creation date, without an actor. `now` is when the page was read, so the server and the browser agree.
 */
export function SystemActivity({ systemId, timeline, now }: { systemId: string; timeline: TimelineItem[]; now: string }) {
  const nowMs = Date.parse(now);
  return (
    <div className="sc-stackgap">
      <section className="hc-card" aria-labelledby="sc-approval-h">
        <div className="hc-card-h">
          <h2 id="sc-approval-h">Approval</h2>
        </div>
        <div className="hc-card-b">
          <ApprovalPanel systemId={systemId} />
        </div>
      </section>

      <section className="hc-card" aria-labelledby="sc-timeline-h">
        <div className="hc-card-h">
          <h2 id="sc-timeline-h">Activity</h2>
          <p>Every change recorded on this System, newest first</p>
        </div>
        {timeline.length === 0 ? (
          <p className="hc-card-b hc-empty">Nothing has changed on this System yet.</p>
        ) : (
          <ol className="hc-feed sc-timeline" aria-label="Activity timeline">
            {timeline.map((item) => (
              <li key={item.id} style={{ "--c": TONE_COLOR[item.tone] } as CSSProperties}>
                <i aria-hidden="true" />
                <span>
                  {item.who === null ? <b>System created</b> : <><b>{item.who}</b> {item.what}</>}
                  {item.detail && <small className="sc-detail">{item.detail}</small>}
                </span>
                <time dateTime={item.at} title={ago(Math.max(0, Math.floor((nowMs - Date.parse(item.at)) / DAY_MS)))}>
                  {formatDay(item.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
