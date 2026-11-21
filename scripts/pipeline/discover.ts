import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { httpRequest, sleep } from "../lib/http.js";
import { CARGO_INTERVAL_MS, connectCargo, type CargoClient, type Row } from "../lib/leaguepedia/client.js";
import { LEAGUEPEDIA_API } from "../lib/sources.js";
import {
  gamesQuery,
  matchesQuery,
  playersQuery,
  renamesQuery,
  tournamentsQuery,
  type QueryDef,
} from "./leaguepedia/queries.js";
import { reportFatal } from "./cli.js";

/*
 * Network discovery, run by hand (`npm run discover`). Verifies that the Cargo fields used by
 * queries.ts exist, and saves reduced real rows as test fixtures. Not used by the pipeline.
 */

const FIXTURES_DIR = "tests/fixtures/leaguepedia";
const FIXTURE_YEARS = [2026, 2013];
const FIXTURE_MATCHES = 4;
const TABLES = [
  "Tournaments",
  "MatchSchedule",
  "ScoreboardGames",
  "ScoreboardPlayers",
  "TeamRenames",
  "Teams",
];
// Fixture-only filter: names that exercise the SK Telecom T1 -> T1 rename chain.
const RENAME_NAME_PATTERNS = ["T1", "SK Telecom"];

/** Pretty JSON, LF line endings, trailing newline. */
async function saveFixture(relPath: string, data: unknown): Promise<void> {
  const file = `${FIXTURES_DIR}/${relPath}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

/** `cargofields` for each table, paced at the Cargo interval. Result: { table: { field: type } }. */
async function fetchFields(): Promise<Record<string, Record<string, string>>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [i, table] of TABLES.entries()) {
    if (i > 0) await sleep(CARGO_INTERVAL_MS);
    const url = `${LEAGUEPEDIA_API}?action=cargofields&table=${encodeURIComponent(table)}&format=json`;
    const res = await httpRequest(url);
    if (res.status !== 200) throw new Error(`cargofields ${table}: status ${res.status}`);
    const body = JSON.parse(res.text) as { cargofields?: Record<string, { type?: string }> };
    if (!body.cargofields) throw new Error(`cargofields ${table}: unexpected response`);
    result[table] = Object.fromEntries(
      Object.entries(body.cargofields).map(([field, def]) => [field, def.type ?? ""]),
    );
  }
  return result;
}

/** Groups tournament OverviewPages by the year of `DateStart`. */
function pagesByYear(tournaments: Row[]): Map<number, string[]> {
  const years = new Map<number, string[]>();
  for (const t of tournaments) {
    const year = Number((t.DateStart ?? "").slice(0, 4));
    if (!Number.isInteger(year) || year === 0) continue;
    years.set(year, [...(years.get(year) ?? []), t.OverviewPage!]);
  }
  return years;
}

interface EditionFixture {
  matches: Row[];
  games: Row[];
  players: Row[];
}

/** First matches by date, their games, and the player rows of those games. */
function reduce(matches: Row[], games: Row[], players: Row[]): EditionFixture {
  const keptMatches = matches.slice(0, FIXTURE_MATCHES);
  const matchIds = new Set(keptMatches.map((m) => m.MatchId));
  const keptGames = games.filter((g) => matchIds.has(g.MatchId));
  const gameIds = new Set(keptGames.map((g) => g.GameId));
  return { matches: keptMatches, games: keptGames, players: players.filter((p) => gameIds.has(p.GameId)) };
}

function teamNames(fixtures: EditionFixture[]): Set<string> {
  const names = new Set<string>();
  for (const f of fixtures) {
    for (const m of f.matches) [m.Team1, m.Team2].forEach((n) => n && names.add(n));
    for (const g of f.games) [g.Team1, g.Team2].forEach((n) => n && names.add(n));
    for (const p of f.players) if (p.Team) names.add(p.Team);
  }
  return names;
}

function selectRenames(renames: Row[], names: Set<string>): Row[] {
  const matchesPattern = (n: string | undefined) => RENAME_NAME_PATTERNS.some((p) => (n ?? "").includes(p));
  return renames.filter(
    (r) =>
      names.has(r.OriginalName ?? "") ||
      names.has(r.NewName ?? "") ||
      matchesPattern(r.OriginalName) ||
      matchesPattern(r.NewName),
  );
}

function countBy(rows: Row[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r[key] ?? ""] = (counts[r[key] ?? ""] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

async function runQuery(cargo: CargoClient, label: string, q: QueryDef, summary: string[]): Promise<Row[]> {
  const rows = await cargo.query(q);
  summary.push(`${label}: ${rows.length} rows`);
  return rows;
}

async function main(): Promise<void> {
  const summary: string[] = [];

  const fields = await fetchFields();
  await saveFixture("fields.json", fields);
  summary.push(`fields: ${TABLES.map((t) => `${t}=${Object.keys(fields[t]!).length}`).join(", ")}`);

  await sleep(CARGO_INTERVAL_MS);
  const cargo = await connectCargo({
    http: httpRequest,
    sleep,
    env: { user: process.env.LEAGUEPEDIA_BOT_USER, password: process.env.LEAGUEPEDIA_BOT_PASSWORD },
  });

  const tournaments = await runQuery(cargo, "tournaments", tournamentsQuery(), summary);
  await saveFixture("tournaments.json", tournaments);
  const years = pagesByYear(tournaments);

  const fixtures: EditionFixture[] = [];
  for (const year of FIXTURE_YEARS) {
    const pages = years.get(year);
    if (!pages) {
      summary.push(`year ${year}: not found among tournaments`);
      continue;
    }
    const matches = await runQuery(cargo, `matches ${year}`, matchesQuery(pages), summary);
    const games = await runQuery(cargo, `games ${year}`, gamesQuery(pages), summary);
    const players = await runQuery(cargo, `players ${year}`, playersQuery(pages), summary);
    const fixture = reduce(matches, games, players);
    fixtures.push(fixture);
    for (const [name, rows] of Object.entries(fixture)) await saveFixture(`worlds-${year}/${name}.json`, rows);
  }

  const renames = await runQuery(cargo, "renames", renamesQuery(), summary);
  const keptRenames = selectRenames(renames, teamNames(fixtures));
  await saveFixture("renames.json", keptRenames);
  const verbs = countBy(renames, "Verb");
  await saveFixture("rename-verbs.json", verbs);

  summary.push(`renames kept in fixture: ${keptRenames.length}`);
  summary.push(`years found: ${[...years.keys()].sort((a, b) => a - b).join(", ")}`);
  for (const year of FIXTURE_YEARS) summary.push(`pages ${year}: ${(years.get(year) ?? []).join(" | ")}`);
  summary.push(`distinct rename verbs: ${JSON.stringify(verbs)}`);
  console.log(summary.join("\n"));
}

// Run only when executed directly, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(reportFatal);
}
