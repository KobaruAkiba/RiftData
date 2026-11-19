import { writeFixture } from "./discover-io.js";
import { CARGO_INTERVAL_MS, type CargoClient, type Row } from "../../lib/leaguepedia/client.js";
import { LEAGUEPEDIA_API } from "../../lib/sources.js";
import { httpRequest, sleep } from "../../lib/http.js";
import { cargoString } from "../../lib/leaguepedia/cargo.js";
import type { QueryDef } from "../leaguepedia/queries.js";

/*
 * Leaguepedia side of the livestats discovery: which fields could link a game to lolesports
 * and which ScoreboardPlayers fields identify players. Read-only, never touches data/.
 */

const TABLES = ["MatchScheduleGame", "ScoreboardGames", "ScoreboardPlayers"];
const INTERESTING = /riot|link|champion|role|side|lolesports|esports|^name$|^team$|vod|history/i;

/** `cargofields` for each table, paced at the Cargo interval. Returns the names matching INTERESTING. */
export async function reportCargoFields(): Promise<string[]> {
  const lines: string[] = [];
  for (const [i, table] of TABLES.entries()) {
    if (i > 0) await sleep(CARGO_INTERVAL_MS);
    const res = await httpRequest(`${LEAGUEPEDIA_API}?action=cargofields&table=${table}&format=json`);
    if (res.status !== 200) throw new Error(`cargofields ${table}: status ${res.status}`);
    const body = JSON.parse(res.text) as { cargofields?: Record<string, unknown> };
    const names = Object.keys(body.cargofields ?? {});
    lines.push(`${table} (${names.length} fields): ${names.filter((n) => INTERESTING.test(n)).join(", ")}`);
  }
  return lines;
}

const PLAYER_FIELDS =
  "GameId, Team, Name, Link, Champion, Role, Role_Number=RoleNumber, IngameRole, Side, Kills, Deaths, Assists";

export function finalPlayersQuery(overviewPage: string): QueryDef {
  return {
    tables: "ScoreboardPlayers",
    fields: PLAYER_FIELDS,
    where: `ScoreboardPlayers.OverviewPage = ${cargoString(overviewPage)} AND ScoreboardPlayers.GameId LIKE "%Main Event_Finals_1_%"`,
    orderBy: "ScoreboardPlayers.GameId, ScoreboardPlayers.Role_Number, ScoreboardPlayers.Side",
  };
}

/** Saves the ScoreboardPlayers rows of the final and returns them. */
export async function saveFinalPlayers(cargo: CargoClient, overviewPage: string): Promise<Row[]> {
  const rows = await cargo.query(finalPlayersQuery(overviewPage));
  await writeFixture("scoreboard-players-final.json", rows, true);
  return rows;
}
