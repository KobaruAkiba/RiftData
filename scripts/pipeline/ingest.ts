import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditionSchema, TeamsFileSchema, type Edition, type Team } from "../../src/data/schema/index.js";
import { httpRequest, sleep } from "../lib/http.js";
import { connectCargo, type CargoClient } from "../lib/leaguepedia/client.js";
import { parseIngestArgs } from "./ingest/args.js";
import { fetchEditionInput, fetchTeamRows, teamNamesOf } from "./ingest/fetch.js";
import { renamesQuery, tournamentsQuery, type RenameRow, type TournamentRow } from "./leaguepedia/queries.js";
import { loadOverrides, type Overrides } from "./overrides.js";
import { editionPath, readJson, TEAMS_PATH, writeIfChanged } from "./store.js";
import { buildTeamIdentity, type TeamIdentity } from "./teams/identity.js";
import { editionYear, normalizeEdition, orphanGameIds, type EditionInput } from "./worlds/normalize.js";
import { reportFatal } from "./cli.js";

export { parseIngestArgs };

export interface IngestOptions {
  full: boolean;
  years?: number[];
  now: Date;
}

export interface IngestIO {
  readEdition(year: number): Promise<Edition | null>;
  readTeams(): Promise<Team[]>;
  write(path: string, value: unknown): Promise<boolean>;
  log(message: string): void;
}

export interface IngestResult {
  written: string[];
  fetchedYears: number[];
  skippedYears: number[];
  warnings: string[];
}

/** True when a stored team's aliases no longer resolve to its stored id (rename after storage). */
export function needsFullRebuild(stored: Team[], identity: TeamIdentity): boolean {
  return stored.some((team) => team.aliases.some((alias) => identity.resolve(alias) !== team.id));
}

function groupByYear(tournaments: TournamentRow[]): Map<number, TournamentRow[]> {
  const byYear = new Map<number, TournamentRow[]>();
  for (const row of tournaments) {
    const year = editionYear(row);
    if (year === null) continue;
    byYear.set(year, [...(byYear.get(year) ?? []), row]);
  }
  return new Map([...byYear].sort(([a], [b]) => a - b));
}

/** Years to download: the requested ones, all with `full`, otherwise those not stored as completed. */
async function selectYears(known: number[], opts: Pick<IngestOptions, "full" | "years">, io: IngestIO): Promise<number[]> {
  if (opts.years) return known.filter((y) => opts.years!.includes(y));
  if (opts.full) return known;
  const pending: number[] = [];
  for (const year of known) {
    if ((await io.readEdition(year))?.status !== "completed") pending.push(year);
  }
  return pending;
}

/**
 * Fetches everything first and writes only at the end, so a failed request leaves the stored data untouched.
 * A rename that invalidates stored team ids restarts the run as a full rebuild.
 */
export async function ingest(client: CargoClient, overrides: Overrides, opts: IngestOptions, io: IngestIO): Promise<IngestResult> {
  const excluded = new Set(overrides.editions.exclude);
  const tournaments = (await client.query(tournamentsQuery())) as unknown as TournamentRow[];
  const byYear = groupByYear(tournaments.filter((t) => !excluded.has(t.OverviewPage)));
  const knownYears = [...byYear.keys()];
  const warnings = (opts.years ?? []).filter((y) => !byYear.has(y)).map((y) => `Requested year ${y} has no Worlds edition`);

  const renames = (await client.query(renamesQuery())) as unknown as RenameRow[];
  const storedTeams = await io.readTeams();
  const cache = new Map<number, EditionInput>(); // survives a rebuild: nothing is downloaded twice

  // `rebuilding`: every edition is fetched, so stored names would only drag stale teams into the identity.
  const gather = async (years: number[], rebuilding: boolean) => {
    for (const year of years) {
      if (!cache.has(year)) cache.set(year, await fetchEditionInput(client, year, byYear.get(year)!));
    }
    const inputs = years.map((y) => cache.get(y)!);
    const stored = rebuilding ? [] : storedTeams.flatMap((t) => t.aliases);
    const names = [...new Set([...teamNamesOf(inputs), ...stored])].sort();
    // Team rows are fetched for every alias on a chain, not only the names in use: the metadata (short name,
    // region) then comes out the same whether or not the stored aliases are part of the run.
    const chainNames = buildTeamIdentity(renames, [], names, overrides.teams).teams().flatMap((t) => t.aliases);
    const rows = await fetchTeamRows(client, [...new Set([...names, ...chainNames])].sort());
    return { inputs, identity: buildTeamIdentity(renames, rows, names, overrides.teams) };
  };

  let full = opts.full && !opts.years;
  let years = await selectYears(knownYears, opts, io);
  let { inputs, identity } = await gather(years, full);
  if (!full && needsFullRebuild(storedTeams, identity)) {
    io.log("A stored team was renamed: rebuilding every edition");
    full = true;
    years = knownYears;
    ({ inputs, identity } = await gather(years, true));
  }

  const editions = inputs.map((input) => normalizeEdition(input, identity, overrides.edition, opts.now));
  for (const input of inputs) {
    const orphans = orphanGameIds(input).length;
    if (orphans > 0) warnings.push(`${input.year}: ${orphans} game(s) discarded because their match is missing`);
    if (input.matches.length === 0) warnings.push(`${input.year}: no matches found`);
  }

  // A full rebuild re-resolves every team, so stored teams would only add stale ids; otherwise keep the unused ones.
  const current = identity.teams();
  const kept = full ? [] : storedTeams.filter((t) => !current.some((c) => c.id === t.id));
  const teams = [...current, ...kept].sort((a, b) => a.id.localeCompare(b.id));

  const written: string[] = [];
  for (const edition of editions) {
    const path = editionPath(edition.year);
    if (await io.write(path, edition)) written.push(path);
  }
  if (await io.write(TEAMS_PATH, { teams })) written.push(TEAMS_PATH);

  return { written, fetchedYears: years, skippedYears: knownYears.filter((y) => !years.includes(y)), warnings };
}

async function main(): Promise<void> {
  const args = parseIngestArgs(process.argv.slice(2));
  const cargo = await connectCargo({
    http: httpRequest,
    sleep,
    env: { user: process.env.LEAGUEPEDIA_BOT_USER, password: process.env.LEAGUEPEDIA_BOT_PASSWORD },
  });
  // Progress output: a full run takes minutes and would otherwise be silent.
  const client: CargoClient = {
    query: async (q) => {
      const rows = await cargo.query(q);
      console.log(`${q.tables}: ${rows.length} rows`);
      return rows;
    },
  };
  const io: IngestIO = {
    readEdition: (year) => readJson(editionPath(year), EditionSchema),
    readTeams: async () => (await readJson(TEAMS_PATH, TeamsFileSchema))?.teams ?? [],
    write: writeIfChanged,
    log: (message) => console.log(message),
  };
  const result = await ingest(client, await loadOverrides(), { ...args, now: new Date() }, io);
  console.log(`Fetched years: ${result.fetchedYears.join(", ") || "none"}`);
  console.log(`Skipped years: ${result.skippedYears.join(", ") || "none"}`);
  console.log(`Written: ${result.written.length > 0 ? result.written.join(", ") : "nothing"}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(reportFatal);
}
