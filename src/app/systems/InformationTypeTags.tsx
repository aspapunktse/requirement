import { sensitivityToken, type SensitivityLevelInfo } from "@/lib/sensitivity-level";

/** A small square in the Sensitivity Level's own colour, before an Information Type's name (design proposal A, #302). */
export function LevelSquare({ level }: { level: number }) {
  return <i className="it-lvsq" aria-hidden="true" style={{ background: `var(${sensitivityToken(level, "fg")})` }} />;
}

type TagType = { id: string; name: string; sensitivityLevel: number };

/**
 * A System's Information Types as small tags: the first `max` (two, as in the design), then "+N" with the rest in its
 * tooltip; "None declared" when there are none. Each tag's tooltip names its level.
 */
export function InformationTypeTags({ types, levels, max = 2 }: { types: TagType[]; levels: readonly Pick<SensitivityLevelInfo, "level" | "label">[]; max?: number }) {
  if (types.length === 0) return <span className="muted">None declared</span>;
  const labelOf = (level: number) => levels.find((info) => info.level === level)?.label ?? `Level ${level}`;
  return (
    <span className="it-tags">
      {types.slice(0, max).map((type) => (
        <span key={type.id} className="it-tag" title={`${type.name}: ${labelOf(type.sensitivityLevel)}`}>
          <LevelSquare level={type.sensitivityLevel} />
          {type.name}
        </span>
      ))}
      {types.length > max && (
        <span className="it-tag more" title={types.slice(max).map((type) => type.name).join(", ")}>
          +{types.length - max}
        </span>
      )}
    </span>
  );
}
