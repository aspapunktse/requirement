import { RISK_LEVELS } from "./system-page-types";

export const SEVERITY_TEXT: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };
const SEVERITY_LETTER: Record<string, string> = { LOW: "L", MEDIUM: "M", HIGH: "H", CRITICAL: "C" };

/** Heat of a cell in the Risk grid: worse towards the high-severity, high-likelihood corner. */
function heat(severity: number, likelihood: number): string {
  const sum = severity + likelihood;
  if (sum >= 6) return "var(--rg-danger)";
  if (sum >= 4) return "var(--rg-gold)";
  if (sum >= 2) return "color-mix(in srgb, var(--rg-gold) 45%, var(--rg-surface))";
  return "var(--rg-success-soft)";
}

/**
 * Open Risks by severity (rows, worst first) and likelihood (columns): the Overview's Risks tile and the Risks
 * tab's register. `grid[severity][likelihood]`, both indexed by `RISK_LEVELS`; `size` is a cell's side in px.
 */
export function RiskGrid({ grid, open, size = 30 }: { grid: number[][]; open: number; size?: number }) {
  return (
    <div
      className="sc-rgrid"
      style={{ "--cell": `${size}px` } as React.CSSProperties}
      role="img"
      aria-label={`Open Risks by severity and likelihood: ${open} open`}
    >
      {[...RISK_LEVELS.keys()].reverse().map((severity) => (
        <div key={severity} className="rg-row">
          <span className="rg-y">{SEVERITY_LETTER[RISK_LEVELS[severity]]}</span>
          {RISK_LEVELS.map((level, likelihood) => {
            const n = grid[severity]?.[likelihood] ?? 0;
            return (
              <span key={level} className="rg-c" style={{ background: heat(severity, likelihood) }} title={`${SEVERITY_TEXT[RISK_LEVELS[severity]]} severity, ${SEVERITY_TEXT[level].toLowerCase()} likelihood: ${n}`}>
                {n > 0 && <b>{n}</b>}
              </span>
            );
          })}
        </div>
      ))}
      <div className="rg-row">
        <span />
        {RISK_LEVELS.map((level) => (
          <span key={level} className="rg-x">
            {SEVERITY_LETTER[level]}
          </span>
        ))}
      </div>
    </div>
  );
}
