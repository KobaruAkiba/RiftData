import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { httpRequest, sleep } from "../../lib/http.js";
import { connectCargo } from "../../lib/leaguepedia/client.js";
import { createLolesportsClient, type LolesportsClient } from "../../lib/lolesports/client.js";
import { reportCargoFields, saveFinalPlayers } from "./discover-cargo.js";
import {
  fetchLeaguepediaGames,
  pairByOrder,
  surveyDurations,
  type DurationRow,
} from "./discover-durations.js";
import { describeRoster, checkRosterMatching } from "./discover-roster.js";
import { reduceCompletedEvents, saveFinalGameFixtures } from "./discover-fixtures.js";
import { writeFixture } from "./discover-io.js";
import { savePauseFixtures } from "./discover-pauses.js";
import { parseCompletedEvents, pickWorldsTournamentId } from "./parse.js";
import { reportFatal } from "../cli.js";

/*
 * Network discovery, run by hand (`npm run discover:livestats`, a few minutes). Checks the real
 * livestats shapes the plan assumed and saves reduced real responses as test fixtures.
 * Never touches data/. Findings are written up in docs/superpowers/spikes/2026-11-19-livestats-discovery.md.
 */

const YEAR = 2026;
const SCAN_GAMES = 10;
const PAUSE_DRIFT_SECONDS = 20;
const WORST_DRIFT_GAMES = 3;
const WORLDS_MAIN_EVENT_PAGE = `${YEAR} Season World Championship/Main Event`;

/** Evenly spaced picks across the list, first and last included. */
function spread<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]!);
}

const median = (values: number[]): number | undefined => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];

function describeDurations(rows: DurationRow[]): string[] {
  const measured = rows.filter((r) => r.driftSeconds !== null);
  const sorted = [...measured].sort((a, b) => b.driftSeconds! - a.driftSeconds!);
  const paused = sorted.filter((r) => r.driftSeconds! > PAUSE_DRIFT_SECONDS);
  const calm = measured.filter((r) => r.driftSeconds! <= PAUSE_DRIFT_SECONDS);
  const tailStates = [...new Set(rows.flatMap((r) => r.tailStates))].join(",");
  const startOffsets = calm.flatMap((r) => (r.startOffsetSeconds === null ? [] : [r.startOffsetSeconds]));
  const anchored = calm.flatMap((r) => (r.startOffsetSeconds === null ? [] : [r.driftSeconds! - r.startOffsetSeconds]));
  const metas = rows.flatMap((r) => (r.meta === null ? [] : [r.meta]));
  return [
    `durations: ${measured.length}/${rows.length} games measured; tail states seen: ${tailStates}`,
    `drift (real seconds, first frame to first finished frame, minus Leaguepedia length): min ${sorted.at(-1)?.driftSeconds?.toFixed(1)}, max ${sorted[0]?.driftSeconds?.toFixed(1)}`,
    `games without pauses (drift <= ${PAUSE_DRIFT_SECONDS}s): ${calm.length}; median drift ${median(calm.map((r) => r.driftSeconds!))?.toFixed(1)}s`,
    `first frame -> first frame with gold > 0 (game clock 0:00): median ${median(startOffsets)?.toFixed(1)}s, min ${Math.min(...startOffsets).toFixed(1)}, max ${Math.max(...startOffsets).toFixed(1)}`,
    `drift measured from the gold > 0 frame instead: median ${median(anchored)?.toFixed(1)}s, min ${Math.min(...anchored).toFixed(1)}, max ${Math.max(...anchored).toFixed(1)}`,
    `games with drift > ${PAUSE_DRIFT_SECONDS}s (pauses): ${paused.length}`,
    ...paused.map((r) => `  ${r.lolGameId} ${r.leaguepediaGameId}: +${r.driftSeconds!.toFixed(0)}s`),
    `metadata: ${metas.length}/${rows.length} games; roles seen: ${[...new Set(metas.flatMap((m) => m.roles))].join(",")}; well formed (10 participants, 5 roles per side, names): ${metas.filter((m) => m.wellFormed).length}`,
    `champion ids seen: ${[...new Set(metas.flatMap((m) => m.championIds))].sort().join(",")}`,
  ];
}

async function discoverLolesports(lol: LolesportsClient, summary: string[]) {
  const tournamentId = pickWorldsTournamentId(await lol.tournaments(), YEAR);
  if (tournamentId === null) throw new Error(`no Worlds ${YEAR} tournament in getTournamentsForLeague`);
  const eventsJson = await lol.completedEvents(tournamentId);
  const bytes = await writeFixture("completed-events-2026.json", reduceCompletedEvents(eventsJson), true);
  const matches = parseCompletedEvents(eventsJson);
  const played = matches.flatMap((m) => m.games.filter((g) => g.played).map((g) => g.id));
  summary.push(`tournament ${tournamentId}: ${matches.length} matches, ${played.length} played games; completed-events fixture ${bytes} bytes`);
  return { matches, played };
}

async function main(): Promise<void> {
  const summary: string[] = [];
  const lol = createLolesportsClient({ http: httpRequest, sleep });
  const cargo = await connectCargo({
    http: httpRequest,
    sleep,
    env: { user: process.env.LEAGUEPEDIA_BOT_USER, password: process.env.LEAGUEPEDIA_BOT_PASSWORD },
  });

  const { matches, played } = await discoverLolesports(lol, summary);
  const finalGame = matches.at(-1)?.games.find((g) => g.played);
  if (finalGame === undefined) throw new Error("the last match has no played game");

  const fixtures = await saveFinalGameFixtures(lol, finalGame.id);
  summary.push(
    `final game ${finalGame.id}: first frame ${fixtures.firstFrame}; window at ${fixtures.minuteStartingTime} has ${fixtures.framesAtMinute10} frames; saved with stride ${fixtures.stride}`,
    ...Object.entries(fixtures.files).map(([name, size]) => `  ${name}: ${size} bytes`),
  );

  const pairs = pairByOrder(matches, await fetchLeaguepediaGames(cargo, YEAR));
  summary.push(`lolesports <-> Leaguepedia games paired by order: ${pairs.length}/${played.length}`);
  const durations = await surveyDurations(lol, pairs);
  summary.push(...describeDurations(durations));

  const worst = [...durations]
    .filter((r) => r.driftSeconds !== null)
    .sort((a, b) => b.driftSeconds! - a.driftSeconds!)
    .slice(0, WORST_DRIFT_GAMES)
    .map((r) => r.lolGameId);
  const toScan = [...new Set([...worst, ...spread(played, SCAN_GAMES)])];
  summary.push(...(await savePauseFixtures(lol, toScan)));

  summary.push(...describeRoster(await checkRosterMatching(lol, cargo, YEAR, pairs)));

  summary.push(...(await reportCargoFields()));
  const finalPlayers = await saveFinalPlayers(cargo, WORLDS_MAIN_EVENT_PAGE);
  summary.push(`ScoreboardPlayers rows of the final: ${finalPlayers.length}`, JSON.stringify(finalPlayers[0]));
  console.log(summary.join("\n"));
}

// Run only when executed directly, not when imported.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(reportFatal);
}
