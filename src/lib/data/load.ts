import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z, type ZodType } from "zod";
import { EditionSchema, TeamsFileSchema, type Edition, type Team } from "../../data/schema/index.js";

/** Invalid or unreadable data file. `message` carries the file path and the field path of the error. */
export class DataValidationError extends Error {
  readonly file: string;

  constructor(file: string, detail: string, options?: ErrorOptions) {
    super(`Invalid data in ${file}:\n${detail}`, options);
    this.name = "DataValidationError";
    this.file = file;
  }
}

function readValidated<T>(file: string, schema: ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new DataValidationError(file, (err as Error).message, { cause: err });
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new DataValidationError(file, z.prettifyError(result.error), { cause: result.error });
  return result.data;
}

/** Reads every `*.json` edition file in `worldsDir`, validated, sorted by year ascending. */
export function loadEditions(worldsDir: string): Edition[] {
  return readdirSync(worldsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readValidated(join(worldsDir, name), EditionSchema))
    .sort((a, b) => a.year - b.year);
}

export function loadTeams(teamsFile: string): Team[] {
  return readValidated(teamsFile, TeamsFileSchema).teams;
}
