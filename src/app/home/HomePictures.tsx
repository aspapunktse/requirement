import Link from "next/link";
import type { CSSProperties } from "react";
import { Ring } from "./HomeGraphics";
import type { HomePicture } from "./home-types";

const STAGE_TONE = ["var(--hc-stage-0)", "var(--hc-stage-1)", "var(--hc-stage-2)", "var(--hc-stage-3)"];

const pctTone = (pct: number) => (pct >= 90 ? "var(--rg-success)" : pct >= 70 ? "var(--rg-accent)" : pct >= 50 ? "var(--rg-gold)" : "var(--rg-danger)");

/** The heat colour of a cell: higher likelihood (row 0 is highest) and higher severity (column 3 is highest) run hotter. */
function heatTone(row: number, col: number): string {
  const score = 3 - row + col;
  return score >= 5 ? "var(--rg-danger)" : score >= 4 ? "#d9693f" : score >= 2 ? "var(--rg-gold)" : "var(--rg-success)";
}

const initials = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : name).slice(0, 2);
};

function StageHead({ stage, label, count }: { stage: number; label: string; count: number }) {
  return (
    <h3 className="hc-pp-h">
      <i style={{ background: STAGE_TONE[stage] }} aria-hidden="true" />
      {label}
      <b>{count}</b>
    </h3>
  );
}

/** The picture of a role's world, one renderer per picture type; `empty` is shown when there is nothing to draw. */
export function HomePictureView({ picture }: { picture: HomePicture }) {
  switch (picture.type) {
    case "pipeline":
      if (picture.items.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-pipe">
          {picture.stages.map((stage, index) => {
            const items = picture.items.filter((item) => item.stage === index);
            return (
              <div className="hc-pp-col" key={stage}>
                <StageHead stage={index} label={stage} count={items.length} />
                {items.map((item) => (
                  <Link key={item.id} href={item.href} className="hc-pp-item">
                    <span className="nm">{item.name}</span>
                    {item.flag && <em>{item.flag}</em>}
                    <span className="hc-pp-bar" aria-hidden="true">
                      <i style={{ "--w": `${item.pct ?? 0}%` } as CSSProperties} />
                    </span>
                    <small>{item.pct === null ? "No Controls apply" : `${item.pct}% assessed`}</small>
                  </Link>
                ))}
                {items.length === 0 && <div className="hc-pp-empty">—</div>}
              </div>
            );
          })}
        </div>
      );

    case "bars": {
      if (picture.items.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      const max = Math.max(1, ...picture.items.map((item) => item.value), picture.target ?? 0);
      return (
        <ul className="hc-bars">
          {picture.items.map((item) => (
            <li className="hc-pb-row" key={item.id}>
              {item.href ? (
                <Link className="hc-pb-n" href={item.href}>
                  {item.name}
                </Link>
              ) : (
                <span className="hc-pb-n">{item.name}</span>
              )}
              <span className="hc-pb-track" aria-hidden="true">
                {picture.target ? <i className="hc-pb-target" style={{ left: `${(picture.target / max) * 100}%` }} /> : null}
                <i className={`hc-pb-fill${picture.target && item.value > picture.target ? " over" : ""}`} style={{ "--w": `${(item.value / max) * 100}%` } as CSSProperties} />
              </span>
              <b>
                {item.value}
                {picture.unit ? ` ${picture.unit}` : ""}
              </b>
            </li>
          ))}
        </ul>
      );
    }

    case "heat": {
      const total = picture.cells.flat().reduce((sum, n) => sum + n, 0);
      if (total === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-heat" role="group" aria-label="Open Risks by likelihood and severity">
          <span className="hc-ph-y" aria-hidden="true">
            Likelihood
          </span>
          <div className="hc-ph-grid">
            {picture.cells.map((row, r) => (
              <div key={picture.rows[r]} style={{ display: "contents" }}>
                <span className="hc-ph-l">{picture.rows[r]}</span>
                {row.map((n, c) => (
                  <span
                    key={picture.cols[c]}
                    {...(n > 0 ? { role: "img", "aria-label": `${n} open Risk${n === 1 ? "" : "s"}, likelihood ${picture.rows[r]}, severity ${picture.cols[c]}` } : { "aria-hidden": true })}
                    className={`hc-ph-c${n ? "" : " zero"}`}
                    style={{ "--c": heatTone(r, c) } as CSSProperties}
                    title={`${n} open Risk${n === 1 ? "" : "s"}: likelihood ${picture.rows[r]}, severity ${picture.cols[c]}`}
                  >
                    {n ? <b>{n}</b> : null}
                  </span>
                ))}
              </div>
            ))}
            <span />
            {picture.cols.map((col) => (
              <span key={col} className="hc-ph-x">
                {col}
              </span>
            ))}
          </div>
          <span className="hc-ph-xl">Severity</span>
        </div>
      );
    }

    case "portfolio":
      if (picture.items.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-port">
          {picture.stages.map((stage, index) => {
            const items = picture.items.filter((item) => item.stage === index);
            return (
              <div className="hc-po-col" key={stage}>
                <StageHead stage={index} label={stage} count={items.length} />
                <div className="hc-po-cells">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="hc-po-c"
                      style={{ "--c": item.pct === null ? "var(--rg-muted)" : pctTone(item.pct) } as CSSProperties}
                      title={`${item.name}${item.pct === null ? "" : ` · ${item.pct}% compliant`}${item.risks ? ` · ${item.risks} open Risk${item.risks > 1 ? "s" : ""}` : ""}`}
                    >
                      <b>{item.pct === null ? "–" : item.pct}</b>
                      {item.risks > 0 && <em aria-hidden="true">{item.risks}</em>}
                      <small>{item.name}</small>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );

    case "rings":
      if (picture.items.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-rings">
          {picture.items.map((item) => (
            <Link key={item.id} href={item.href} className="hc-pr-i">
              <Ring segments={[[item.value / 100, pctTone(item.value)]]} size={66} stroke={7} center={`${item.value}%`} label={`${item.name}: ${item.value}% covered`} />
              <span>{item.name}</span>
            </Link>
          ))}
        </div>
      );

    case "audits":
      if (picture.items.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-audits">
          {picture.items.map((item) => {
            const total = item.parts.reduce((sum, n) => sum + n, 0);
            return (
              <div className="hc-pa-row" key={item.id}>
                <div className="hc-pa-h">
                  <Link href={item.href}>
                    <b>{item.name}</b>
                  </Link>
                  <span>
                    {item.parts[0]}/{total} evaluated
                  </span>
                </div>
                <span className="hc-pa-bar" role="img" aria-label={picture.legend.map((entry, i) => `${item.parts[i]} ${entry.label.toLowerCase()}`).join(", ")}>
                  {item.parts.map((n, i) => (n ? <i key={i} style={{ "--w": `${(n / total) * 100}%`, background: picture.legend[i].tone } as CSSProperties} title={`${n} ${picture.legend[i].label.toLowerCase()}`} /> : null))}
                </span>
              </div>
            );
          })}
          <div className="hc-legend">
            {picture.legend.map((entry) => (
              <span key={entry.label}>
                <i style={{ background: entry.tone }} aria-hidden="true" />
                {entry.label}
              </span>
            ))}
          </div>
        </div>
      );

    case "mosaic":
      if (picture.groups.length === 0) return <p className="hc-empty">{picture.empty}</p>;
      return (
        <div className="hc-mosaic">
          {picture.groups.map((group) => (
            <div key={group.name}>
              <h3 className="hc-pm-h">
                {group.name}
                <b>{group.items.length}</b>
              </h3>
              <div className="hc-pm-cells">
                {group.items.map((item, index) => (
                  <Link key={item.id} href={item.href} className="hc-pm-c" style={{ "--d": `${Math.min(index, 30) * 30}ms` } as CSSProperties} title={item.name} aria-label={item.name}>
                    {initials(item.name)}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
  }
}
