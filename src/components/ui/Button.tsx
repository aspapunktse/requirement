import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline";

const VARIANT_CLASSES: Record<Variant, string> = {
  // Primary action — the ported design system's canonical CTA color.
  primary:
    "border border-ems-amber-hover bg-ems-amber text-ems-ink-0 hover:bg-ems-amber-hover disabled:opacity-50",
  // Secondary action / affirmative-but-not-primary — the canonical link/CTA blue.
  secondary:
    "border border-ems-blue bg-transparent text-ems-blue hover:bg-ems-blue-tint disabled:opacity-50",
  // Neutral / destructive-leaning action (Remove, Retire, Reject).
  outline:
    "border border-zinc-300 dark:border-zinc-700 bg-transparent text-ems-ink-2 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 disabled:opacity-50",
};

export function Button({
  variant = "outline",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`self-start rounded-[var(--ems-radius-2)] px-3 py-1 text-sm font-medium transition-colors ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
}
