// Pure Framework version lineage (F-FW.6, #146). No Prisma, so it is safe to import from client components.

export type LineageNode = {
  id: string;
  name: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  supersedesId: string | null;
};

export type LineageMember = {
  id: string;
  name: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  /** True for the Framework this lineage is shown for. */
  current: boolean;
};

/** One line of a lineage, oldest to newest. */
export type LineagePath = LineageMember[];

function byNameThenVersion(a: LineageNode, b: LineageNode): number {
  return a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true });
}

/**
 * The version lineage of every Framework the viewer may see that has one.
 *
 * `all` must be EVERY Framework, hidden Drafts included: the supersedes link
 * through a hidden Draft has to be followed before anything is filtered, so
 * with A <- B (Draft) <- C a viewer who can't see Drafts gets A -> C on both A
 * and C, and B appears nowhere. A Draft at the end of a chain is simply absent.
 * Callers pass `canSeeDrafts` from canSeeDraftFrameworks and must send only the
 * result (never `all`) to a client that can't see Drafts.
 *
 * A lineage is the whole family a Framework belongs to: from its oldest
 * ancestor down, as one path per branch. Normally that is a single path, the
 * same for every member (only `current` differs). A fork (two Frameworks
 * superseding the same one) is allowed by the data, so every branch is kept
 * as its own path, branches ordered by name then version. Decision (product
 * owner, 2026-10-13, comment on #146): forks are not refused on write; the list
 * shows every branch in this fixed order. A Framework that is
 * alone in its family has no entry.
 */
export function buildLineages(all: LineageNode[], canSeeDrafts: boolean): Map<string, LineagePath[]> {
  const byId = new Map(all.map((node) => [node.id, node]));
  const isVisible = (node: LineageNode) => canSeeDrafts || node.status === "PUBLISHED";

  // Each visible node's nearest visible predecessor, stepping over hidden ones.
  function visiblePredecessor(node: LineageNode): LineageNode | null {
    const seen = new Set([node.id]);
    let cursor = node.supersedesId ? byId.get(node.supersedesId) : undefined;
    while (cursor && !seen.has(cursor.id)) {
      if (isVisible(cursor)) return cursor;
      seen.add(cursor.id);
      cursor = cursor.supersedesId ? byId.get(cursor.supersedesId) : undefined;
    }
    return null;
  }

  const visible = all.filter(isVisible).sort(byNameThenVersion);
  const predecessorOf = new Map<string, LineageNode | null>(visible.map((node) => [node.id, visiblePredecessor(node)]));
  const successorsOf = new Map<string, LineageNode[]>();
  for (const node of visible) {
    const predecessor = predecessorOf.get(node.id);
    if (predecessor) successorsOf.set(predecessor.id, [...(successorsOf.get(predecessor.id) ?? []), node]);
  }

  function rootOf(node: LineageNode): LineageNode {
    const seen = new Set([node.id]);
    let cursor = node;
    for (let next = predecessorOf.get(cursor.id); next && !seen.has(next.id); next = predecessorOf.get(cursor.id)) {
      seen.add(next.id);
      cursor = next;
    }
    return cursor;
  }

  // Root-to-leaf paths below a root (visited guards against a loop in bad data).
  function pathsFrom(root: LineageNode): LineageNode[][] {
    const paths: LineageNode[][] = [];
    const walk = (trail: LineageNode[]) => {
      const last = trail[trail.length - 1];
      const next = (successorsOf.get(last.id) ?? []).filter((node) => !trail.includes(node));
      if (next.length === 0) paths.push(trail);
      for (const child of next) walk([...trail, child]);
    };
    walk([root]);
    return paths;
  }

  const familyPaths = new Map<string, LineageNode[][]>();
  const result = new Map<string, LineagePath[]>();
  for (const node of visible) {
    const root = rootOf(node);
    let paths = familyPaths.get(root.id);
    if (!paths) {
      paths = pathsFrom(root);
      familyPaths.set(root.id, paths);
    }
    if (paths.every((path) => path.length === 1)) continue;
    result.set(
      node.id,
      paths.map((path) =>
        path.map((member) => ({
          id: member.id,
          name: member.name,
          version: member.version,
          status: member.status,
          current: member.id === node.id,
        })),
      ),
    );
  }
  return result;
}
