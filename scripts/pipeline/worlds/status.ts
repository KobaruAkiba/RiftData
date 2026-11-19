import type { Edition, EditionStatus, TeamId } from "../../../src/data/schema/index.js";

type StatusInput = Pick<Edition, "stages" | "startDate" | "endDate">;

/** `completed`: every match has a winner and the end date has passed; `ongoing`: some result or started; else `upcoming`. */
export function editionStatus(edition: StatusInput, now: Date): EditionStatus {
  const matches = edition.stages.flatMap((s) => s.matches);
  const allDecided = matches.length > 0 && matches.every((m) => m.winner !== null);
  const ended = edition.endDate === undefined || new Date(edition.endDate) < now;
  if (allDecided && ended) return "completed";
  const started = edition.startDate !== undefined && new Date(edition.startDate) <= now;
  if (matches.some((m) => m.winner !== null) || started) return "ongoing";
  return "upcoming";
}

/** Winner of the most recent dated match, only when the edition is completed. */
export function championOf(edition: Pick<Edition, "stages" | "status">): TeamId | null {
  if (edition.status !== "completed") return null;
  const dated = edition.stages.flatMap((s) => s.matches).filter((m) => m.date !== undefined);
  let last: (typeof dated)[number] | undefined;
  for (const m of dated) if (last === undefined || m.date! >= last.date!) last = m;
  return last?.winner ?? null;
}
