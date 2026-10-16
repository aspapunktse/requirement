export type ChipTone = "success" | "warn" | "danger" | "neutral" | "accent";

const TONE_CLASSES: Record<ChipTone, string> = {
  success: "bg-rg-success-soft text-rg-success",
  warn: "bg-rg-gold-soft text-rg-gold-ink",
  danger: "bg-rg-danger-soft text-rg-danger",
  neutral: "bg-rg-paper text-rg-muted shadow-[inset_0_0_0_1px_var(--rg-line)]",
  accent: "bg-rg-accent-soft text-rg-accent",
};

/**
 * The Register StatusPill: a sentence-case word with a coloured dot. State is
 * always a word first; the tone only adds colour.
 */
export function StatusChip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--rg-radius-sm)] px-[9px] py-px text-[12.5px] leading-[18px] font-semibold ${TONE_CLASSES[tone]}`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}
