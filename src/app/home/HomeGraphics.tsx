import type { HomeIconKey } from "./home-types";

const ICON_PATHS: Record<HomeIconKey, string> = {
  plus: "M10 4v12M4 10h12",
  stack: "M3 6l7-3 7 3-7 3-7-3zM3 10l7 3 7-3M3 14l7 3 7-3",
  check: "M4 10.5l3.5 3.5L16 6",
  book: "M4 4h5a2 2 0 0 1 2 2v10a2 2 0 0 0-2-2H4zM16 4h-5M16 4v10h-5",
  doc: "M6 3h6l3 3v11H6zM12 3v3h3M8 10h5M8 13h5",
  search: "M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4",
  grid: "M4 4h5v5H4zM11 4h5v5h-5zM4 11h5v5H4zM11 11h5v5h-5z",
  alert: "M10 3l8 14H2zM10 8v4M10 14.5v.5",
  chart: "M4 16V9M8 16V5M12 16v-6M16 16V7",
  layers: "M10 3l7 4-7 4-7-4zM3 11l7 4 7-4",
  building: "M4 17V4h8v13M12 8h4v9M7 7h2M7 10h2M7 13h2",
  system: "M3 4h14v9H3zM7 17h6M10 13v4",
  query: "M4 4h12v9H9l-4 3v-3H4zM8 8h4",
  risk: "M10 3l6 3v4c0 4-3 6-6 7-3-1-6-3-6-7V6z",
  control: "M4 10l4 4 8-8M3 3h14v14H3z",
  checkup: "M6 3h8v14H6zM8 7h4M8 10l1.5 1.5L12 9",
  audit: "M4 4h9l3 3v10H4zM8 11a2 2 0 1 0 4 0 2 2 0 0 0-4 0M11.5 12.5L14 15",
  arrow: "M5 10h10M11 6l4 4-4 4",
  bolt: "M11 2L4 11h5l-1 7 7-9h-5z",
};

export function Icon({ name, size = 18 }: { name: HomeIconKey; size?: number }) {
  return (
    <svg
      className="hc-ico"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name] ?? ICON_PATHS.grid} />
    </svg>
  );
}

/** The icon and hue of a task's kind, as in the design's KIND badges. */
export const KIND: Record<string, { icon: HomeIconKey; hue: string }> = {
  System: { icon: "system", hue: "var(--rg-accent)" },
  Query: { icon: "query", hue: "#6c7fd8" },
  Risk: { icon: "risk", hue: "var(--rg-danger)" },
  Control: { icon: "control", hue: "var(--rg-success)" },
  "Check-up": { icon: "checkup", hue: "#b07a12" },
  Audit: { icon: "audit", hue: "#8a5cc2" },
};
export const kindOf = (kind: string) => KIND[kind] ?? { icon: "grid" as const, hue: "var(--rg-muted)" };

/** A progress ring; segments are [fraction, colour] pairs laid end to end. */
export function Ring({
  segments,
  size = 64,
  stroke = 8,
  center,
  sub,
  label,
}: {
  segments: [number, string][];
  size?: number;
  stroke?: number;
  center?: string;
  sub?: string;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const lengths = segments.map(([fraction]) => Math.max(0, Math.min(1, fraction)) * c);
  const arcs = segments.map(([, color], index) => {
    const len = lengths[index];
    const offset = lengths.slice(0, index).reduce((sum, n) => sum + n, 0);
    return (
      <circle
        key={index}
        className="hc-ring-arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap={len > 0 ? "round" : "butt"}
        strokeDasharray={`${len} ${c}`}
        strokeDashoffset={-offset}
      />
    );
  });
  return (
    <svg className="hc-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${center ?? ""} ${sub ?? ""}`.trim()}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hc-line-soft)" strokeWidth={stroke} />
        {arcs}
      </g>
      {center && (
        <text x="50%" y={sub ? "47%" : "53%"} textAnchor="middle" dominantBaseline="middle" className="hc-ring-num" style={{ fontSize: Math.round(size / 4.2) }}>
          {center}
        </text>
      )}
      {sub && (
        <text x="50%" y="66%" textAnchor="middle" className="hc-ring-sub">
          {sub}
        </text>
      )}
    </svg>
  );
}

/** A sparkline with a soft area and an end dot. Drawn only when `SHOW_STAT_TRENDS` is on and a stat has a trend. */
export function Spark({ values, width = 86, height = 30, color = "var(--rg-accent)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((value, index): [number, number] => [(index * (width - 4)) / (values.length - 1) + 2, height - 3 - ((value - min) / span) * (height - 8)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <polygon points={`2,${height} ${line} ${width - 2},${height}`} fill={color} opacity="0.12" />
      <polyline className="hc-spark-line" points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <circle cx={lastX} cy={lastY} r="2.6" fill={color} />
    </svg>
  );
}
