import type { CSSProperties } from "react";
import { MAX_SENSITIVITY_LEVEL, sensitivityToken } from "@/lib/sensitivity-level";

const BAR_HEIGHTS_PX = [5, 6.5, 8, 9.5, 11];

/**
 * A Sensitivity Level as a compact pill (#291, design proposal A): five small bars filled up to the level, then the label.
 * Colour is never the only signal: the bars give the position on the scale and the label is spelled out. The colours are
 * the `--rg-sensitivity-<n>-fg/-bg` tokens, which the root layout publishes from the database and which follow the mode.
 * `level` null is the "Not set" state: neutral and dashed, never one of the five colours.
 * `colors` overrides the tokens, for the Admin form's previews of a draft or of the derived dark pair.
 */
export function SensitivityChip({
  level,
  label,
  size = "md",
  colors,
}: {
  level: number | null;
  label?: string;
  size?: "sm" | "md" | "lg";
  colors?: { textColor: string; backgroundColor: string };
}) {
  const text = level === null ? "Not set" : (label ?? `Level ${level}`);
  const style: CSSProperties =
    level === null
      ? {}
      : {
          color: colors?.textColor ?? `var(${sensitivityToken(level, "fg")})`,
          background: colors?.backgroundColor ?? `var(${sensitivityToken(level, "bg")})`,
          borderColor: "color-mix(in srgb, currentColor 38%, transparent)",
        };
  const sizeClass = size === "sm" ? "gap-1 text-[0.7rem] px-2.5" : size === "lg" ? "gap-2 py-[3px] pl-2.5 pr-3 text-[0.95rem]" : "gap-1.5 py-px pl-2 pr-2.5 text-[0.78rem]";
  const colourClass = level === null ? "border-dashed border-rg-line text-rg-muted" : "";
  const barScale = size === "lg" ? 1.25 : 1;

  return (
    <span
      role="img"
      aria-label={level === null ? "Sensitivity Level: Not set" : `Sensitivity Level: ${text}`}
      data-level={level ?? undefined}
      className={`inline-flex items-center whitespace-nowrap rounded-full border align-middle font-bold leading-6 ${sizeClass} ${colourClass}`}
      style={style}
    >
      {size !== "sm" && (
        <span aria-hidden="true" className="inline-flex flex-none items-end gap-0.5" style={{ height: 11 * barScale }}>
          {BAR_HEIGHTS_PX.map((height, index) => {
            const on = level !== null && index + 1 <= Math.min(level, MAX_SENSITIVITY_LEVEL);
            return (
              <i
                key={height}
                data-on={on ? "true" : "false"}
                className={level === null ? "rounded-[1px] border border-dashed border-current opacity-35" : "rounded-[1px] bg-current"}
                style={{ width: 3 * barScale, height: height * barScale, opacity: level === null ? undefined : on ? 1 : 0.25 }}
              />
            );
          })}
        </span>
      )}
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
