import type { CSSProperties } from "react";

/** A horizontal stacked bar. Zero-width parts are left out; with nothing to show it is an empty track. */
export function Stack({ parts, label, height = 10 }: { parts: { value: number; color: string; label: string }[]; label: string; height?: number }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <div className="sc-stack" role="img" aria-label={label} style={{ height }}>
      {total > 0 &&
        parts
          .filter((part) => part.value > 0)
          .map((part) => <i key={part.label} title={`${part.label}: ${part.value}`} style={{ "--w": `${(part.value / total) * 100}%`, background: part.color } as CSSProperties} />)}
    </div>
  );
}
