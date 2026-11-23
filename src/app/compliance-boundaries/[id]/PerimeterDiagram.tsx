import { useId } from "react";
import { HIDDEN_PROVIDER_LABEL, perimeterLines, type BoundaryPerimeter, type PerimeterMember } from "@/lib/boundary-perimeter-rules";

const W = 800;
const NH = 40;
const GAP = 14;
const BX = 214;
const BW = 380;
const TOP = 52;
const NX = BX + 40;
const NW = BW - 80;
const PROVIDER_W = 154;

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The perimeter of a Compliance Boundary (#433, design proposal C), in plain SVG: counted Systems inside the dashed box,
 * not-yet-operating ones astride its edge, Providers outside on the left with an arrow to each member that inherits Controls from
 * them, closed members on the right. A Provider that is a drawn member is inside, with arcs along the right of the box. The SVG has a
 * summary label, and the same facts follow as a list ("who inherits from whom") for screen readers and narrow screens.
 */
export function PerimeterDiagram({ perimeter, name }: { perimeter: BoundaryPerimeter; name: string }) {
  const markerId = useId().replace(/:/g, "");
  const { inside, edge, closed, providers, inherits } = perimeter;

  const pos = new Map<string, { y: number; member: PerimeterMember }>();
  inside.forEach((member, index) => pos.set(member.id, { y: TOP + 34 + index * (NH + GAP), member }));
  const bottom = TOP + 34 + Math.max(inside.length, 1) * (NH + GAP) + 10;
  edge.forEach((member, index) => pos.set(member.id, { y: bottom - NH / 2 + index * (NH + 10), member }));
  const edgeExtra = edge.length > 0 ? (edge.length - 1) * (NH + 10) + NH / 2 + 10 : 0;

  // Outside Providers sit at the average height of what they serve, pushed apart so they don't overlap.
  const placed = providers
    .map((provider) => {
      const heights = provider.dependentIds.map((id) => pos.get(id)?.y).filter((y): y is number => y !== undefined);
      return { provider, y: heights.length > 0 ? heights.reduce((a, b) => a + b, 0) / heights.length : TOP + 34 };
    })
    .sort((a, b) => a.y - b.y);
  placed.forEach((entry, index) => {
    if (index > 0 && entry.y < placed[index - 1].y + NH + 12) entry.y = placed[index - 1].y + NH + 12;
  });

  const right = closed.map((member, index) => ({ member, y: TOP + 34 + index * (NH + 12) }));
  const height = Math.max(bottom + 24 + edgeExtra, (placed.length > 0 ? placed[placed.length - 1].y + NH : 0) + 24, (right.length > 0 ? right[right.length - 1].y + NH : 0) + 24, 150);
  const label = `Perimeter of ${name}: ${plural(inside.length, "counted System", "counted Systems")} inside, ${edge.length} not yet operating on the edge, ${plural(providers.length, "Provider", "Providers")} outside`;
  const memberProviderIds = new Set(inherits.map((edgeRow) => edgeRow.from));

  return (
    <div className="cb-peri-wrap">
      <div className="cb-peri">
        <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
          <defs>
            <marker id={`ah-${markerId}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 1l8 4-8 4z" className="ahead" />
            </marker>
          </defs>
          <text className="lbl" x="8" y="26">Providers (outside)</text>
          <text className="lbl" x={BX} y="26">Perimeter</text>
          <text className="lbl" x={W - 8} y="26" textAnchor="end">Closed</text>
          <rect className="box" x={BX} y={TOP - 12} width={BW} height={bottom - TOP + 12} rx="16" />
          <text className="sb" x={BX + 16} y={TOP + 14}>{short(name, 44)}</text>
          {placed.flatMap(({ provider, y }) =>
            provider.dependentIds.flatMap((id) => {
              const target = pos.get(id);
              if (!target) return [];
              const y1 = y + NH / 2;
              const y2 = target.y + NH / 2;
              return [<path key={`${provider.key}-${id}`} className={provider.pending ? "arr pending" : "arr"} d={`M${8 + PROVIDER_W} ${y1} C ${BX - 10} ${y1}, ${BX - 10} ${y2}, ${NX - 2} ${y2}`} markerEnd={`url(#ah-${markerId})`} />];
            }),
          )}
          {inherits.map((row) => {
            const from = pos.get(row.from);
            const to = pos.get(row.to);
            if (!from || !to) return null;
            const x = NX + NW;
            const y1 = from.y + NH / 2;
            const y2 = to.y + NH / 2;
            const bulge = Math.min(34, 10 + Math.abs(y2 - y1) / 12);
            return <path key={`${row.from}-${row.to}`} className={row.pending ? "arr pending" : "arr"} d={`M${x} ${y1} C ${x + bulge} ${y1}, ${x + bulge} ${y2}, ${x + 2} ${y2}`} markerEnd={`url(#ah-${markerId})`} />;
          })}
          {placed.map(({ provider, y }) => (
            <g key={provider.key}>
              <rect className={provider.name === null ? "n-ghost" : "n-prov"} x="8" y={y} width={PROVIDER_W} height={NH} rx="10" />
              <text className="nm" x="20" y={y + 17}>{provider.name === null ? "Provider" : short(provider.name, 21)}</text>
              <text className="sb" x="20" y={y + 31}>
                {provider.name === null ? "Not visible to you" : "Provider"} · {plural(provider.dependentIds.length, "dependent", "dependents")}{provider.pending ? " · pending" : ""}
              </text>
              <title>{provider.name ?? HIDDEN_PROVIDER_LABEL}</title>
            </g>
          ))}
          {[...inside, ...edge].map((member) => {
            const y = pos.get(member.id)!.y;
            const counted = member.state === "OPERATING";
            return (
              <g key={member.id}>
                <rect className={counted ? "n-in" : "n-edge"} x={NX} y={y} width={NW} height={NH} rx="10" />
                <text className="nm" x={NX + 14} y={y + 17}>{short(member.name, 38)}</text>
                <text className="sb" x={NX + 14} y={y + 31}>
                  {counted ? "Counted" : "Not yet operating"}
                  {memberProviderIds.has(member.id) ? " · Provider" : ""}
                </text>
                <title>{member.name}</title>
              </g>
            );
          })}
          {right.map(({ member, y }) => (
            <g key={member.id}>
              <rect className="n-ghost" x={W - 168} y={y} width="160" height={NH} rx="10" />
              <text className="nm faint" x={W - 156} y={y + 17}>{short(member.name, 20)}</text>
              <text className="sb" x={W - 156} y={y + 31}>Closed</text>
              <title>{member.name}</title>
            </g>
          ))}
        </svg>
        <div className="cb-pkey">
          <span><i className="k-in" />Counted</span>
          <span><i className="k-edge" />Not yet operating</span>
          <span><i className="k-prov" />Provider</span>
          <span><i className="k-arrow" />Inherits Controls from</span>
          <span><i className="k-arrow dashed" />Pending: Provider not Onboarded, no credit yet</span>
          <span><i className="k-ghost" />Closed, or a Provider you can&apos;t open</span>
        </div>
      </div>
      <details className="cb-peri-list">
        <summary>The perimeter as a list: who inherits from whom</summary>
        {perimeterLines(perimeter).map((group) => (
          <div key={group.heading}>
            <b>{group.heading}</b>
            <ul>
              {group.items.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
        {inside.length + edge.length + closed.length === 0 && <p className="cb-empty">No Systems in this Compliance Boundary yet.</p>}
      </details>
    </div>
  );
}
