import { access, readdir } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EditionSchema, GameTimelineSchema, TeamsFileSchema } from "../../src/data/schema/index.js";
import { httpRequest, sleep } from "../lib/http.js";
import { connectCargo } from "../lib/leaguepedia/client.js";
import { createLolesportsClient } from "../lib/lolesports/client.js";
import { ingestLivestats, parseLivestatsArgs, type LivestatsIO } from "./livestats/ingest.js";
import { loadLivestatsOverrides } from "./livestats/overrides.js";
import { writeIfChangedAtomic } from "./livestats/atomic-write.js";
import { DATA_DIR, editionPath, livestatsGamePath, livestatsIndexPath, readJson, TEAMS_PATH, writeIfChanged } from "./store.js";

/** Years of the editions stored in data/worlds/<year>.json. */
async function listEditionYears(): Promise<number[]> {
  const files = await readdir(posix.join(DATA_DIR, "worlds"));
  return files.flatMap((f) => (/^\d{4}\.json$/.test(f) ? [Number(f.slice(0, 4))] : [])).sort((a, b) => a - b);
}

const fileIo: LivestatsIO = {
  readEdition: (year) => readJson(editionPath(year), EditionSchema),
  readTeams: async () => (await readJson(TEAMS_PATH, TeamsFileSchema))?.teams ?? [],
  listEditionYears,
  gameExists: (year, gameId) => access(livestatsGamePath(year, gameId)).then(() => true, () => false),
  readGame: (year, gameId) => readJson(livestatsGamePath(year, gameId), GameTimelineSchema),
  writeGame: (year, timeline) => writeIfChangedAtomic(livestatsGamePath(year, timeline.gameId), timeline, { compactArrays: true }),
  writeIndex: (year, index) => writeIfChanged(livestatsIndexPath(year), index),
  log: (message) => console.log(message),
};

async function main(): Promise<void> {
  const args = parseLivestatsArgs(process.argv.slice(2));
  const lol = createLolesportsClient({ http: httpRequest, sleep });
  const cargo = await connectCargo({
    http: httpRequest,
    sleep,
    env: { user: process.env.LEAGUEPEDIA_BOT_USER, password: process.env.LEAGUEPEDIA_BOT_PASSWORD },
  });
  const result = await ingestLivestats(lol, cargo, await loadLivestatsOverrides(), args, fileIo);

  console.log(`Written: ${result.written.length > 0 ? result.written.join(", ") : "nothing"}`);
  console.log(`Already stored: ${result.skipped}, not linked: ${result.unlinked.length}, failed: ${result.failed.length}`);
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  // A run that lost games (failed or aborted) must not look green in a workflow.
  if (result.failed.length > 0 || result.aborted) process.exitCode = 1;
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
