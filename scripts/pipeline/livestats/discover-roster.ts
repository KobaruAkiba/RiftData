import type { CargoClient, Row } from "../../lib/leaguepedia/client.js";
import type { LolesportsClient } from "../../lib/lolesports/client.js";
import { inList, tournamentsQuery } from "../leaguepedia/queries.js";
import type { PairedGame } from "./discover-durations.js";
import { parseWindow } from "./parse.js";

/*
 * Checks design rule 7.4 on every game: a feed participant matches exactly one ScoreboardPlayers row
 * by side + role, and the champion names agree once normalized.
 */

const FEED_TO_LEAGUEPEDIA_ROLE: Record<string, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  bottom: "Bot",
  support: "Support",
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface RosterCheck {
  games: number;
  participants: number;
  noRow: number;
  duplicateRows: number;
  /** "feedKey -> Leaguepedia name" with the number of participants, for names that differ once normalized. */
  championMismatches: Map<string, number>;
  /** "feedRole -> Leaguepedia Role" pairs actually seen. */
  rolePairs: Set<string>;
  sidePairs: Set<string>;
}

async function fetchPlayers(cargo: CargoClient, year: number): Promise<Row[]> {
  const tournaments = await cargo.query(tournamentsQuery());
  const pages = tournaments.filter((t) => (t.DateStart ?? "").startsWith(`${year}-`)).map((t) => t.OverviewPage!);
  return cargo.query({
    tables: "ScoreboardPlayers",
    fields: "GameId, Team, Name, Link, Champion, Role, Side",
    where: `ScoreboardPlayers.OverviewPage IN ${inList(pages)}`,
    orderBy: "ScoreboardPlayers.GameId, ScoreboardPlayers.Side, ScoreboardPlayers.Role_Number",
  });
}

export async function checkRosterMatching(
  lol: LolesportsClient,
  cargo: CargoClient,
  year: number,
  games: PairedGame[],
): Promise<RosterCheck> {
  const players = await fetchPlayers(cargo, year);
  const byGame = new Map<string, Row[]>();
  for (const row of players) byGame.set(row.GameId!, [...(byGame.get(row.GameId!) ?? []), row]);

  const check: RosterCheck = {
    games: 0,
    participants: 0,
    noRow: 0,
    duplicateRows: 0,
    championMismatches: new Map(),
    rolePairs: new Set(),
    sidePairs: new Set(),
  };
  for (const game of games) {
    const { metadata } = parseWindow(await lol.window(game.lolGameId));
    if (metadata === null) continue;
    check.games++;
    const rows = byGame.get(game.leaguepediaGameId) ?? [];
    for (const p of metadata.participants) {
      check.participants++;
      const side = p.participantId <= 5 ? "1" : "2";
      const role = FEED_TO_LEAGUEPEDIA_ROLE[p.role];
      const matching = rows.filter((r) => r.Side === side && r.Role === role);
      if (matching.length === 0) check.noRow++;
      if (matching.length > 1) check.duplicateRows++;
      const row = matching[0];
      if (row === undefined) continue;
      check.rolePairs.add(`${p.role} -> ${row.Role}`);
      check.sidePairs.add(`participant ${p.participantId <= 5 ? "1-5" : "6-10"} -> Side ${row.Side}`);
      if (normalize(p.championId) !== normalize(row.Champion ?? "")) {
        const key = `${p.championId} -> ${row.Champion}`;
        check.championMismatches.set(key, (check.championMismatches.get(key) ?? 0) + 1);
      }
    }
  }
  return check;
}

export function describeRoster(c: RosterCheck): string[] {
  const mismatches = [...c.championMismatches].map(([k, n]) => `${k} (${n})`).join("; ");
  return [
    `roster matching by side + role: ${c.games} games, ${c.participants} participants, without a row ${c.noRow}, with several rows ${c.duplicateRows}`,
    `  role pairs: ${[...c.rolePairs].sort().join("; ")}`,
    `  side pairs: ${[...c.sidePairs].sort().join("; ")}`,
    `  champion names that differ after normalization: ${mismatches || "none"}`,
  ];
}
