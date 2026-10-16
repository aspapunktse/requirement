import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "outline";

const VARIANT_CLASSES: Record<Variant, string> = {
  // Primary action: accent fill, on-accent text.
  primary:
    "border border-rg-accent bg-rg-accent text-rg-on-accent hover:brightness-110 disabled:opacity-45",
  // Secondary action / affirmative-but-not-primary: the Register default,
  // an outlined accent button on the surface colour.
  secondary:
    "border border-rg-accent bg-rg-surface text-rg-accent hover:bg-rg-accent-soft disabled:opacity-45",
  // Neutral / destructive-leaning action (Remove, Retire, Reject): outlined
  // in ink on a line border, so destructive actions don't all turn teal.
  outline:
    "border border-rg-line bg-rg-surface text-rg-ink hover:border-rg-accent hover:bg-rg-accent-soft disabled:opacity-45",
};

/** The classes of a Button, for a link that should look like one. */
export function buttonClassName(variant: Variant = "outline", extra = ""): string {
  return `self-start inline-flex items-center gap-2 rounded-[var(--rg-radius-md)] px-[15px] py-[7px] text-sm font-semibold no-underline transition-colors disabled:cursor-default ${VARIANT_CLASSES[variant]} ${extra}`;
}

export function Button({
  variant = "outline",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, className)}
      {...props}
    />
  );
}
