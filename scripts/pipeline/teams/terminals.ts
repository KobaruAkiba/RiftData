/** A `from -> to` rename. `pinned` marks edges that come from overrides. */
export interface Edge {
  to: string;
  date: string;
  pinned: boolean;
}

/** True when `a` should win over `b`: pinned first, then the latest date, then the smallest target name. */
function isStronger(a: Edge, b: Edge): boolean {
  if (a.pinned !== b.pinned) return a.pinned;
  if (a.date !== b.date) return a.date > b.date;
  return a.to < b.to;
}

/** Terminal of a rename cycle: the target of its strongest edge, identical for every name on the cycle. */
function cycleTerminal(cycle: string[], edges: Map<string, Edge>): string {
  let best = edges.get(cycle[0]!)!;
  for (const name of cycle.slice(1)) {
    const edge = edges.get(name)!;
    if (isStronger(edge, best)) best = edge;
  }
  return best.to;
}

/**
 * Resolves a name to the most recent name of its organisation by following rename edges.
 * Each name has at most one outgoing edge, so a walk either ends at a name with no edge
 * or re-enters its own path (a cycle). Results are memoized for every name on the walk.
 */
export function createTerminalResolver(edges: Map<string, Edge>): (name: string) => string {
  const memo = new Map<string, string>();

  return (name) => {
    const path: string[] = [];
    const position = new Map<string, number>();
    let current = name;
    let terminal: string | undefined;

    while (terminal === undefined) {
      const known = memo.get(current);
      if (known !== undefined) {
        terminal = known;
        break;
      }
      position.set(current, path.length);
      path.push(current);
      const next = edges.get(current);
      if (!next) {
        terminal = current;
      } else if (position.has(next.to)) {
        // Cycle: the names from the first re-entered one onwards. Names before it are a tail into the cycle.
        terminal = cycleTerminal(path.slice(position.get(next.to)!), edges);
      } else {
        current = next.to;
      }
    }

    for (const visited of path) memo.set(visited, terminal);
    return terminal;
  };
}
