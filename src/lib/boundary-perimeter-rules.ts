/**
 * The perimeter of a Compliance Boundary (#433, design proposal C): the shapes and the pure parts, safe for client components.
 * Counted Systems sit inside, not-yet-operating ones on the edge, closed ones are listed outside, and Providers (Systems the
 * member Systems inherit Controls from, ADR 0008) sit outside with an arrow to each member that depends on them. A Provider that is
 * itself a drawn member is drawn inside, once.
 */

/** A member System. Names of members are read by every role (ADR 0016); `linkable` says whether the acting user may open it. */
export type PerimeterMember = { id: string; name: string; state: "OPERATING" | "NOT_YET_OPERATING" | "CLOSED"; status: string; linkable: boolean };

/**
 * A Provider outside the perimeter. `name` and `onboarded` are null when the acting user may not see the System: such a Provider
 * is drawn anonymously and never named (`key` is then a position, not its id). `id` is null in that case too. `pending` is true
 * while the Provider is not Onboarded: its Offerings give the dependents no credit yet (ADR 0008), so the arrows are drawn as
 * pending. It is the only Onboarded-related fact a hidden Provider reveals, and the arrows alone carry it.
 */
export type PerimeterProvider = { key: string; id: string | null; name: string | null; onboarded: boolean | null; pending: boolean; dependentIds: string[] };

export type BoundaryPerimeter = {
  /** Counted members. */
  inside: PerimeterMember[];
  /** Not yet operating members. */
  edge: PerimeterMember[];
  /** Closed members: listed, never counted, and no arrows to them. */
  closed: PerimeterMember[];
  /** Providers that are not drawn members, outside the perimeter. */
  providers: PerimeterProvider[];
  /** A drawn member Provider inherited from: `from` is the member's id, `to` the dependent member's id. */
  inherits: { from: string; to: string; pending: boolean }[];
};

export const HIDDEN_PROVIDER_LABEL = "A Provider you can't open";

export const PENDING_NOTE = "pending: Provider not Onboarded";

/** The text fallback of the diagram: who inherits from whom, one line per member. A pending dependency says it gives no credit yet. */
export function perimeterLines(perimeter: BoundaryPerimeter): { heading: string; items: string[] }[] {
  const providerLabel = (provider: PerimeterProvider) => provider.name ?? HIDDEN_PROVIDER_LABEL;
  const nameOf = new Map([...perimeter.inside, ...perimeter.edge].map((member) => [member.id, member.name]));
  const inheritsFrom = (memberId: string) => [
    ...perimeter.providers.filter((provider) => provider.dependentIds.includes(memberId)).map((provider) => ({ label: providerLabel(provider), pending: provider.pending })),
    ...perimeter.inherits.filter((edge) => edge.to === memberId).map((edge) => ({ label: nameOf.get(edge.from) ?? "", pending: edge.pending })),
  ];
  const line = (member: PerimeterMember) => {
    const from = inheritsFrom(member.id);
    const now = from.filter((entry) => !entry.pending).map((entry) => entry.label);
    const later = from.filter((entry) => entry.pending).map((entry) => entry.label);
    const parts = [
      now.length > 0 && `inherits Controls from ${now.join(", ")}`,
      later.length > 0 && `will inherit from ${later.join(", ")} once it is Onboarded (${PENDING_NOTE})`,
    ].filter(Boolean);
    return parts.length > 0 ? `${member.name}, ${parts.join("; ")}` : member.name;
  };
  const groups = [
    { heading: "Inside the perimeter (counted)", items: perimeter.inside.map(line) },
    { heading: "On the edge (not yet operating)", items: perimeter.edge.map(line) },
    {
      heading: "Providers outside the perimeter",
      items: perimeter.providers.map((provider) => {
        const dependents = provider.dependentIds.map((id) => nameOf.get(id)).filter(Boolean);
        return `${providerLabel(provider)}${provider.pending ? ` (${PENDING_NOTE})` : ""}, provides to ${dependents.join(", ")}`;
      }),
    },
    { heading: "Closed (listed, not counted)", items: perimeter.closed.map((member) => member.name) },
  ];
  return groups.filter((group) => group.items.length > 0);
}
