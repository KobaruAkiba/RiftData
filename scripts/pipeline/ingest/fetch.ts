import type { CargoClient } from "../../lib/leaguepedia/client.js";
import {
  gamesQuery,
  matchesQuery,
  playersQuery,
  teamsQuery,
  type GameRow,
  type MatchRow,
  type PlayerRow,
  type TeamRow,
  type TournamentRow,
} from "../leaguepedia/queries.js";
import type { EditionInput } from "../worlds/normalize.js";

const TEAM_CHUNK_SIZE = 50;

/** Matches, games and player rows of one edition, fetched sequentially (the client paces requests). */
export async function fetchEditionInput(client: CargoClient, year: number, tournaments: TournamentRow[]): Promise<EditionInput> {
  const pages = [...new Set(tournaments.map((t) => t.OverviewPage))];
  const matches = (await client.query(matchesQuery(pages))) as unknown as MatchRow[];
  const games = (await client.query(gamesQuery(pages))) as unknown as GameRow[];
  const players = (await client.query(playersQuery(pages))) as unknown as PlayerRow[];
  return { year, tournaments, matches, games, players };
}

/** Every team name that appears in the fetched rows (placeholders are filtered by the identity builder). */
export function teamNamesOf(inputs: EditionInput[]): string[] {
  const names = new Set<string>();
  for (const { matches, games, players } of inputs) {
    for (const m of matches) [m.Team1, m.Team2].forEach((n) => names.add(n));
    for (const g of games) [g.Team1, g.Team2].forEach((n) => names.add(n));
    for (const p of players) names.add(p.Team);
  }
  names.delete("");
  return [...names].sort();
}

/** Team rows for the given names, queried in chunks so the Cargo `IN` list stays short. */
export async function fetchTeamRows(client: CargoClient, names: string[]): Promise<TeamRow[]> {
  const rows: TeamRow[] = [];
  for (let i = 0; i < names.length; i += TEAM_CHUNK_SIZE) {
    rows.push(...((await client.query(teamsQuery(names.slice(i, i + TEAM_CHUNK_SIZE)))) as unknown as TeamRow[]));
  }
  return rows;
}
