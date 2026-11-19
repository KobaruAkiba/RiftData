import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { StageTypeSchema, TeamIdSchema } from "../../src/data/schema/index.js";
import type { EditionOverrides } from "./worlds/apply-overrides.js";
import type { TeamOverrides } from "./teams/identity.js";

export interface Overrides {
  editions: { exclude: string[] };
  teams: TeamOverrides;
  edition: EditionOverrides;
}

// Strict objects: a typo in a key must fail loudly instead of being ignored.
export const OverridesFilesSchema = {
  editions: z.strictObject({ exclude: z.array(z.string()) }),
  teams: z.strictObject({ merge: z.array(z.strictObject({ from: z.string(), into: z.string() })) }),
  stages: z.record(
    z.string(), // key "<year>/<stageId>"
    z.strictObject({ name: z.string().optional(), type: StageTypeSchema.optional() }),
  ),
  matches: z.record(
    z.string(), // key MatchId
    z.strictObject({
      score1: z.number().int().min(0).optional(),
      score2: z.number().int().min(0).optional(),
      winner: TeamIdSchema.nullable().optional(),
      date: z.iso.datetime().optional(),
    }),
  ),
};

type FileName = keyof typeof OverridesFilesSchema;

const EMPTY: { [K in FileName]: z.infer<(typeof OverridesFilesSchema)[K]> } = {
  editions: { exclude: [] },
  teams: { merge: [] },
  stages: {},
  matches: {},
};

async function loadFile<K extends FileName>(dir: string, name: K): Promise<z.infer<(typeof OverridesFilesSchema)[K]>> {
  const file = `${name}.json`;
  let text: string;
  try {
    text = await readFile(join(dir, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY[name];
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid override file ${file}: ${(error as Error).message}`);
  }
  const result = OverridesFilesSchema[name].safeParse(json);
  if (!result.success) throw new Error(`Invalid override file ${file}: ${z.prettifyError(result.error)}`);
  return result.data as z.infer<(typeof OverridesFilesSchema)[K]>;
}

/** Loads the manual override files; a missing directory or file means no overrides. */
export async function loadOverrides(dir = "data/overrides"): Promise<Overrides> {
  const [editions, teams, stages, matches] = await Promise.all([
    loadFile(dir, "editions"),
    loadFile(dir, "teams"),
    loadFile(dir, "stages"),
    loadFile(dir, "matches"),
  ]);
  return { editions, teams, edition: { stages, matches } };
}
