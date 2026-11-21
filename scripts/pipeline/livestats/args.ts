import type { Edition } from "../../../src/data/schema/index.js";

export interface LivestatsArgs {
  year?: number;
  game?: string;
}

const USAGE = "Usage: ingest:livestats [--year <year>] [--game <lolesports game id>]";

/** `--year 2025` picks the edition; `--game 1156…` downloads that game again even if it is stored. */
export function parseLivestatsArgs(argv: string[]): LivestatsArgs {
  const args: LivestatsArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--year" && value !== undefined) {
      const year = Number(value);
      if (!Number.isInteger(year)) throw new Error(`Invalid --year value: "${value}"`);
      args.year = year;
      i++;
    } else if (flag === "--game" && value !== undefined) {
      if (!/^\d+$/.test(value)) throw new Error(`Invalid --game value: "${value}" (lolesports game ids are numeric)`);
      args.game = value;
      i++;
    } else {
      throw new Error(`Unknown or incomplete argument "${flag}". ${USAGE}`);
    }
  }
  return args;
}

/** The requested year, otherwise the newest edition that is ongoing or completed; null if there is none. */
export function selectEditionYear(editions: Edition[], year?: number): number | null {
  if (year !== undefined) return year;
  const current = editions.filter((e) => e.status === "ongoing" || e.status === "completed");
  return current.length > 0 ? Math.max(...current.map((e) => e.year)) : null;
}
