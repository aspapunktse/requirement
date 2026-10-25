/** Small display helpers shared by the Home page and the Systems list. Pure, safe in client components. */

/** "today", "yesterday", "5 d ago", "3 mo ago"; a task with no date shows a dash. */
export function ago(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} d ago`;
  if (days < 365) return `${Math.round(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}

export const initialsOf = (name: string) => {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : name).slice(0, 2);
};
