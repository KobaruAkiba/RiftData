import type { Team, TeamId } from "../../../src/data/schema/index.js";
import type { RenameRow, TeamRow } from "../leaguepedia/queries.js";
import { createTerminalResolver, type Edge } from "./terminals.js";

export interface TeamOverrides {
  merge: { from: string; into: string }[];
}

export interface TeamIdentity {
  /** `null` for empty or placeholder names ("TBD", "TBA"). */
  resolve(name: string): TeamId | null;
  /** Teams reached by the names in use, sorted by id. */
  teams(): Team[];
}

const PLACEHOLDERS = new Set(["", "tbd", "tba"]);
const SAME_ORG = ["rename", "rebrand", "reband"]; // "reband" is a real typo in Leaguepedia
const OTHER_ORG = ["acquir", "acuir", "slot", "sold", "purchas", "partner"]; // "acuir" is a real typo too

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** True when the verb describes the same organisation under a new name. */
export function isSameOrgVerb(verb: string): boolean {
  const v = verb.toLowerCase();
  return SAME_ORG.some((s) => v.includes(s)) && !OTHER_ORG.some((s) => v.includes(s));
}

/** `from -> to` edges: latest rename per name, then overrides, which replace them and are marked `pinned`. */
function buildEdges(renames: RenameRow[], overrides: TeamOverrides): Map<string, Edge> {
  const edges = new Map<string, Edge>();
  for (const row of renames) {
    if (!isSameOrgVerb(row.Verb)) continue;
    const current = edges.get(row.OriginalName);
    if (!current || row.Date >= current.date) edges.set(row.OriginalName, { to: row.NewName, date: row.Date, pinned: false });
  }
  for (const { from, into } of overrides.merge) edges.set(from, { to: into, date: "", pinned: true });
  return edges;
}

export function buildTeamIdentity(renames: RenameRow[], teamRows: TeamRow[], namesInUse: string[], overrides: TeamOverrides): TeamIdentity {
  const edges = buildEdges(renames, overrides);
  const rowByName = new Map(teamRows.map((row) => [row.Name, row]));

  const terminalOf = createTerminalResolver(edges);

  // Terminals reached by the names in use, sorted so slug collisions resolve deterministically.
  const usedNames = namesInUse.filter((n) => !PLACEHOLDERS.has(n.trim().toLowerCase()));
  const terminals = [...new Set(usedNames.map(terminalOf))].sort();

  const idByTerminal = new Map<string, TeamId>();
  const taken = new Set<TeamId>();
  for (const terminal of terminals) {
    const base = slugify(terminal);
    const region = slugify(rowByName.get(terminal)?.Region ?? "");
    let id = base;
    if (taken.has(id)) id = region ? `${base}-${region}` : `${base}-2`;
    if (taken.has(id)) id = `${base}-2`;
    taken.add(id);
    idByTerminal.set(terminal, id);
  }

  const resolve = (name: string): TeamId | null => {
    if (PLACEHOLDERS.has(name.trim().toLowerCase())) return null;
    const terminal = terminalOf(name);
    return idByTerminal.get(terminal) ?? slugify(terminal);
  };

  /** Latest date of any rename touching `name`: ranks aliases by recency. */
  const lastSeen = (name: string): string =>
    renames.filter((x) => x.OriginalName === name || x.NewName === name).reduce((max, x) => (x.Date > max ? x.Date : max), "");

  const teams = (): Team[] => {
    // Aliases = names in use plus every name on a chain, grouped by the terminal they lead to.
    const aliasesByTerminal = new Map<string, Set<string>>(terminals.map((t) => [t, new Set([t])]));
    const addAlias = (name: string): void => {
      aliasesByTerminal.get(terminalOf(name))?.add(name);
    };
    usedNames.forEach(addAlias);
    for (const [from, edge] of edges) {
      addAlias(from);
      addAlias(edge.to);
    }

    return terminals
      .map((terminal): Team => {
        const aliases = [...aliasesByTerminal.get(terminal)!].sort();
        const byRecency = aliases.filter((a) => a !== terminal).sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)));
        const row = rowByName.get(terminal) ?? byRecency.map((a) => rowByName.get(a)).find((x) => x !== undefined);
        return {
          id: idByTerminal.get(terminal)!,
          name: terminal,
          ...(row?.Short ? { short: row.Short } : {}),
          ...(row?.Region ? { region: row.Region } : {}),
          aliases,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  };

  return { resolve, teams };
}
