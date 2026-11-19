import type { Edition, Match, Stage, StageType } from "../../../src/data/schema/index.js";
import { compareMatches } from "./matches.js";

export interface EditionOverrides {
  /** Key `<year>/<stageId>`. */
  stages: Record<string, { name?: string; type?: StageType }>;
  /** Key MatchId; `winner` is a TeamId. */
  matches: Record<string, { score1?: number; score2?: number; winner?: string | null; date?: string }>;
}

function patchMatch(match: Match, patch: EditionOverrides["matches"][string] | undefined): Match {
  if (patch === undefined) return match;
  return {
    ...match,
    ...(patch.score1 !== undefined ? { score1: patch.score1 } : {}),
    ...(patch.score2 !== undefined ? { score2: patch.score2 } : {}),
    ...(patch.winner !== undefined ? { winner: patch.winner } : {}),
    ...(patch.date !== undefined ? { date: patch.date } : {}),
  };
}

function patchStage(year: number, stage: Stage, overrides: EditionOverrides): Stage {
  const patch = overrides.stages[`${year}/${stage.id}`];
  const matches = stage.matches.map((m) => patchMatch(m, overrides.matches[m.id]));
  const dateChanged = stage.matches.some((m) => overrides.matches[m.id]?.date !== undefined);
  return {
    ...stage, // `id` is never overridden
    ...(patch?.name !== undefined ? { name: patch.name } : {}),
    ...(patch?.type !== undefined ? { type: patch.type } : {}),
    matches: dateChanged ? [...matches].sort(compareMatches) : matches,
  };
}

/** Pure: returns a new edition. Keys without a matching stage or match are ignored. */
export function applyEditionOverrides(edition: Edition, overrides: EditionOverrides): Edition {
  return { ...edition, stages: edition.stages.map((stage) => patchStage(edition.year, stage, overrides)) };
}
