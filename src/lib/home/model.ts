import type { Edition } from "../../data/schema/index.js";
import { stageTypeLabel, statusLabel } from "../format/labels.js";
import type { TeamLookup } from "../format/team.js";
import { buildChampion } from "./champion.js";
import { groupRounds } from "./rounds.js";
import { computeStats } from "./stats.js";
import type { HomeModel } from "./types.js";

export type { ChampionView, HomeModel, RoundView, StageView } from "./types.js";

export function buildHomeModel(edition: Edition, lookup: TeamLookup): HomeModel {
  const allMatches = edition.stages.flatMap((stage) => stage.matches);
  return {
    year: edition.year,
    name: edition.name,
    statusLabel: statusLabel(edition.status),
    stats: computeStats(allMatches, lookup),
    champion: buildChampion(edition, allMatches, lookup),
    stages: [...edition.stages]
      .sort((a, b) => a.order - b.order)
      .filter((stage) => stage.matches.length > 0)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        typeLabel: stageTypeLabel(stage.type),
        rounds: groupRounds(stage.matches, lookup),
      })),
  };
}
