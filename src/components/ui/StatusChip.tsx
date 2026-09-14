export type ChipTone = "success" | "warn" | "danger" | "neutral" | "accent";

const TONE_CLASSES: Record<ChipTone, string> = {
  success: "bg-ems-success-tint text-ems-success",
  warn: "bg-ems-warn-tint text-ems-warn",
  danger: "bg-ems-danger-tint text-ems-danger",
  neutral: "bg-zinc-200 dark:bg-zinc-800 text-ems-ink-3",
  accent: "bg-ems-blue-tint text-ems-blue",
};

/** The ported design system's signature look: mono, uppercase, letter-spaced status labels. */
export function StatusChip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  return (
    <span className={`ems-mono-label inline-block rounded-[var(--ems-radius-1)] px-2 py-0.5 ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
