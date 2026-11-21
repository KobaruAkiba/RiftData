import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * games: lolesports game id -> Leaguepedia GameId, or null to ignore the game (e.g. a remake).
 * teams: lolesports team code -> team id (data/teams.json), for sponsored names the lookup cannot match.
 */
export interface LivestatsOverrides {
  games: Record<string, string | null>;
  teams: Record<string, string>;
}

const FILE = "livestats.json";

const OverridesSchema = z.object({
  games: z
    .record(z.string().regex(/^\d+$/, "keys must be numeric lolesports game ids"), z.string().min(1).nullable())
    .default({}),
  teams: z
    .record(
      z.string().min(1),
      z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "values must be team id slugs"),
    )
    .default({}),
});

/** Reads the manual livestats overrides; a missing file means no overrides. */
export async function loadLivestatsOverrides(path = `data/overrides/${FILE}`): Promise<LivestatsOverrides> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { games: {}, teams: {} };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid override file ${FILE}: ${(error as Error).message}`);
  }
  const result = OverridesSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid override file ${FILE}: ${z.prettifyError(result.error)}`);
  return result.data;
}
